/* MegaData — operator upload: pushes a committed bootstrap run (out.json)
   into the LIVE broker, verifies it end-to-end, and seals the gate.

     node megadata/bootstrap-upload.js --url <…/exec> [--out <staging>]
                                       [--batch 200] [--seal]

   The secret comes from the MEGADATA_SECRET environment variable, or an
   interactive prompt — NEVER from argv (shell history) and never committed.

   Safe to re-run at any point: every event id is deterministic and the
   broker answers replayed ids with their original acks, so a crashed or
   repeated upload converges instead of double-importing (P10). Verification
   pulls the whole log back, checks the id set matches out.json exactly, and
   recomputes the hash chain locally against the broker's head. --seal flips
   the bootstrap gate to 'sealed' ONLY after verification passes — from that
   moment, connected pages switch to shadow mode on their next open. */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const MD = require('./schemas.js');
const { createBrokerClient } = require('./broker-client.js');

/* ---------------- core (exported for tests) ---------------- */

function uploadRun(opts) {
  const client = opts.client, events = opts.events, batchSize = opts.batchSize || 200;
  const log = opts.log || function () {};
  let appended = 0, replayed = 0;
  const before = { seq: 0 };
  return client.headq().then(function (h0) {
    before.seq = h0.seq;
    log('broker head before upload: seq ' + h0.seq);
    return client.gate({ op: 'setBootstrap', value: 'running' });
  }).then(function () {
    let chain = Promise.resolve();
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      chain = chain.then(function () {
        return client.append({ events: batch }).then(function (res) {
          if (!res.ok) {
            const sample = Object.keys(res.errors || {}).slice(0, 3).map(id => id + ': ' + res.errors[id].join('; '));
            throw new Error('broker refused a batch: ' + sample.join(' | '));
          }
          appended += batch.length;
          log('uploaded ' + Math.min(appended, events.length) + '/' + events.length + ' (head seq ' + res.head.seq + ')');
        });
      });
    }
    return chain;
  }).then(function () {
    return client.headq();
  }).then(function (h1) {
    replayed = appended - (h1.seq - before.seq);
    // Verify: pull EVERYTHING back, match the id set, recompute the chain.
    const pulled = [];
    function pullFrom(after) {
      return client.pull({ after: after }).then(function (res) {
        (res.events || []).forEach(function (e) { pulled.push(e); });
        if (res.events && res.events.length && pulled[pulled.length - 1].seq < res.head.seq) {
          return pullFrom(pulled[pulled.length - 1].seq);
        }
        return res.head;
      });
    }
    return pullFrom(0).then(function (head) {
      const wantIds = new Set(events.map(e => e.id));
      const gotIds = new Set(pulled.map(e => e.id));
      const missing = [...wantIds].filter(id => !gotIds.has(id));
      let chain = Promise.resolve('genesis');
      pulled.forEach(function (evt) {
        chain = chain.then(function (c) {
          return MD.verifyEventHash(evt).then(function (good) {
            if (!good) throw new Error('event ' + evt.id + ' fails its content hash');
            return MD.sha256Hex(c + '|' + evt.hash);
          });
        });
      });
      return chain.then(function (finalChain) {
        return {
          uploaded: events.length, newOnBroker: h1.seq - before.seq, replayed: replayed,
          headSeq: head.seq, missing: missing,
          chainOk: finalChain === head.chain,
          idsOk: missing.length === 0
        };
      });
    });
  });
}

function sealGate(client) {
  return client.gate({ op: 'setBootstrap', value: 'sealed' });
}

module.exports = { uploadRun, sealGate };

/* ---------------- CLI ---------------- */

if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
  const url = arg('--url', null);
  const outDir = arg('--out', './megadata-bootstrap-staging');
  const batchSize = parseInt(arg('--batch', '200'), 10);
  const seal = args.includes('--seal');
  if (!url) { console.error('usage: bootstrap-upload --url <…/exec> [--out <staging>] [--batch 200] [--seal]'); process.exit(2); }

  const outFile = path.join(outDir, 'out.json');
  if (!fs.existsSync(outFile)) {
    console.error('No ' + outFile + ' — run the bootstrap with --commit first (docs/04).');
    process.exit(2);
  }
  const out = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const events = out.events;
  if (!Array.isArray(events) || !events.length) { console.error(outFile + ' holds no events.'); process.exit(2); }

  function withSecret(fn) {
    if (process.env.MEGADATA_SECRET) return fn(process.env.MEGADATA_SECRET.trim());
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Paste the HMAC secret (input is visible — use a private screen): ', function (s) {
      rl.close(); fn(s.trim());
    });
  }

  withSecret(function (secret) {
    const client = createBrokerClient({ url: url, secret: secret });
    console.log('Uploading ' + events.length + ' event(s) from ' + outFile + ' in batches of ' + batchSize + '…');
    uploadRun({ client: client, events: events, batchSize: batchSize, log: console.log })
      .then(function (rep) {
        console.log('');
        console.log('Uploaded:            ' + rep.uploaded + ' event(s) (' + rep.newOnBroker + ' new, ' + rep.replayed + ' already on the broker)');
        console.log('Broker head:         seq ' + rep.headSeq);
        console.log('Every event id back: ' + (rep.idsOk ? 'YES' : 'NO — MISSING ' + rep.missing.length + ': ' + rep.missing.slice(0, 5).join(', ')));
        console.log('Hash chain verifies: ' + (rep.chainOk ? 'YES' : 'NO'));
        if (!rep.idsOk || !rep.chainOk) {
          console.error('\nVerification FAILED — the gate stays open. Re-run this command (it is safe); if it fails again, stop and investigate.');
          process.exit(1);
        }
        if (!seal) {
          console.log('\nVerified. The gate is still "running" — re-run with --seal to open the system to the pages.');
          return null;
        }
        return sealGate(client).then(function (g) {
          console.log('\nGate: bootstrap = ' + g.gates.bootstrap + '. DONE.');
          console.log('Connected pages switch to shadow mode the next time they are opened.');
        });
      })
      .catch(function (e) { console.error('\nUpload failed: ' + e.message + '\nRe-running is safe — completed batches are never duplicated.'); process.exit(1); });
  });
}
