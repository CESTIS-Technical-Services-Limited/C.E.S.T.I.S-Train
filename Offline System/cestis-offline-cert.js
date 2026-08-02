/* ============================================================================
   cestis-offline-cert.js — the certificate that lets video classes run on the
   Centre's own network.

   WHY THIS EXISTS
   ---------------
   Browsers hand out the camera, the microphone and the video connection only to
   pages they consider to be on a trusted address: https://, or the machine you
   are sitting at (localhost). A page fetched over the network as
   http://192.168.1.20:8080 is refused all three by every browser — Chrome keeps
   the connection API and withholds the camera, Safari and Firefox withhold the
   lot, at which point the video library reports "browser-incompatible" and the
   room says it cannot connect. Nothing is wrong with the browser; the address
   is simply not one it will trust.

   So the offline server has to speak https://, and to speak https:// it needs a
   certificate. There is no internet here to get one from a certificate
   authority, and no authority would issue one for a private address like
   192.168.1.20 anyway. The server therefore makes its own, once, and keeps it
   in the "cert" folder beside the pages.

   WHAT PEOPLE AT THE CENTRE WILL SEE
   ----------------------------------
   A certificate nobody famous vouched for makes browsers show a warning the
   first time each device opens the system — "Your connection is not private" or
   similar. That warning is about who vouched for the certificate, not about
   whether the connection is encrypted (it is). Click Advanced, then Proceed.
   The browser remembers, and that device never asks again.

   NO INSTALLATION
   ---------------
   Node ships no way to CREATE a certificate, so this uses the openssl command,
   which macOS and Linux already have and which Git for Windows installs. When
   it is not there the server says so and carries on over http:// — everything
   except video classes works exactly as before.
   ============================================================================ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DAYS = 825;               // ~2¼ years; comfortably inside what browsers accept
const RENEW_WITHIN_DAYS = 30;   // remake it before it lapses, not after

/* Everywhere this computer can be called by name or number. All of them go in
   the certificate, because a device typing the wifi address and a device typing
   "localhost" have to be answered by the same certificate. */
function subjectNames() {
  const dns = ['localhost'];
  const ips = ['127.0.0.1', '::1'];
  try {
    const h = os.hostname();
    if (h && dns.indexOf(h) === -1) {
      dns.push(h);
      if (h.indexOf('.') === -1) dns.push(h + '.local');
    }
  } catch (e) {}
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(name => {
    (ifaces[name] || []).forEach(i => {
      if (i.family === 'IPv4' && !i.internal && ips.indexOf(i.address) === -1) ips.push(i.address);
    });
  });
  return { dns, ips };
}

/* openssl is normally on PATH. On Windows it usually is not, but Git for
   Windows puts one where we can find it. */
function opensslPath() {
  const candidates = ['openssl'];
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
      'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
      'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe'
    );
  }
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['version'], { encoding: 'utf8' });
      if (!r.error && r.status === 0) return c;
    } catch (e) {}
  }
  return null;
}

/* Written to a file rather than passed as -addext, because the openssl macOS
   ships (LibreSSL) does not accept -addext. A config file works on both. */
function opensslConfig(names) {
  const alt = []
    .concat(names.dns.map((d, i) => 'DNS.' + (i + 1) + ' = ' + d))
    .concat(names.ips.map((ip, i) => 'IP.' + (i + 1) + ' = ' + ip))
    .join('\n');
  return [
    '[req]',
    'distinguished_name = dn',
    'x509_extensions = v3',
    'prompt = no',
    '',
    '[dn]',
    'CN = C.E.S.T.I.S Offline System',
    'O = C.E.S.T.I.S',
    '',
    '[v3]',
    'basicConstraints = critical,CA:TRUE',
    'keyUsage = critical,digitalSignature,keyEncipherment,keyCertSign',
    'extendedKeyUsage = serverAuth',
    'subjectAltName = @alt',
    '',
    '[alt]',
    alt,
    ''
  ].join('\n');
}

/* Is the certificate on disk still the right one for this machine today?
   It stops being right when it has run out, when it is about to, or when the
   computer has picked up a network address it does not cover (a new wifi, or a
   router handing out a different number after a restart). */
function stillGood(certPem, names) {
  let x;
  try {
    const { X509Certificate } = require('crypto');
    if (!X509Certificate) return null;          // older Node: cannot tell, leave it alone
    x = new X509Certificate(certPem);
  } catch (e) {
    return null;                                 // cannot read it; do not churn
  }
  const until = Date.parse(x.validTo);
  if (!isFinite(until)) return false;
  if (until - Date.now() < RENEW_WITHIN_DAYS * 86400000) return false;
  const san = String(x.subjectAltName || '');
  for (const ip of names.ips) {
    if (ip === '::1') continue;                  // spelt several ways; not worth failing on
    if (san.indexOf('IP Address:' + ip) === -1) return false;
  }
  return true;
}

/* Make sure <dir> holds a usable certificate and key, and hand them back.
   Returns { key, cert, dir, created, names } — or null, with the reason logged,
   when this computer has no openssl to make one with. */
function ensure(dir, log) {
  const say = typeof log === 'function' ? log : function () {};
  const certFile = path.join(dir, 'cestis-lan-cert.pem');
  const keyFile = path.join(dir, 'cestis-lan-key.pem');
  const names = subjectNames();

  let haveBoth = false;
  try { haveBoth = fs.existsSync(certFile) && fs.existsSync(keyFile); } catch (e) {}

  if (haveBoth) {
    let good = null;
    try { good = stillGood(fs.readFileSync(certFile), names); } catch (e) { good = false; }
    if (good !== false) {
      try {
        return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile),
                 dir: dir, created: false, names: names };
      } catch (e) {}
    } else {
      say('The network address changed (or the certificate ran out) — making a new one.');
    }
  }

  const ssl = opensslPath();
  if (!ssl) return null;

  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  const cnfFile = path.join(dir, 'cestis-lan-openssl.cnf');
  try { fs.writeFileSync(cnfFile, opensslConfig(names)); } catch (e) { return null; }

  const r = spawnSync(ssl, [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes',
    '-days', String(DAYS),
    '-keyout', keyFile, '-out', certFile,
    '-config', cnfFile
  ], { encoding: 'utf8' });

  if (r.error || r.status !== 0) {
    say('openssl could not make the certificate: ' + ((r.stderr || (r.error && r.error.message) || '').split('\n')[0]));
    return null;
  }
  // The key is the one secret in this folder; keep it to the account that made it.
  try { fs.chmodSync(keyFile, 0o600); } catch (e) {}

  try {
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile),
             dir: dir, created: true, names: names };
  } catch (e) {
    return null;
  }
}

module.exports = { ensure, subjectNames, opensslPath };
