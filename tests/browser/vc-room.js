/* Video classes — the built-in room, in real browsers.
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/vc-room.js

   What Node cannot show: real PeerJS, real WebRTC, real (fake) cameras. Several
   copies of the real index.html are opened in headless Chromium with fake
   camera and microphone devices, introduced to each other by the Offline
   System's own signalling module on localhost — no internet involved.

   It pins what used to go wrong:
     - a trainee whose instructor's picture arrived before the room was drawn
       (any signalling delay at all) never saw or heard the instructor;
     - a trainee with no camera, or who switched it off in the lobby, received
       no picture (or nothing at all) from the instructor;
     - every pair of trainees held two connections and sent each other video
       nobody displays;
     - any trainee could end the class for everyone;
     - anyone who knew the code received the class's media without joining;
     - a trainee turned away from a full room stayed, and was turned away
       again every ten seconds;
     - Exit left the room id registered, so the instructor could not rejoin.
   Kept OUT of the default npm test chain because it needs a browser. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const signalling = require(path.join(ROOT, 'Offline System', 'cestis-offline-signalling.js'));

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ FAIL: ' + msg); } }
function section(t) { console.log(t); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      // Present as a Centre server that runs its own introduction service.
      if (p === '/_cestis/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, mode: 'offline-lan' })); }
      if (p.startsWith('/peerjs/id')) { res.writeHead(200); return res.end('x' + Date.now()); }
      if (p.startsWith('/_cestis/')) { res.writeHead(404); return res.end('{}'); }
      const file = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    signalling.attach(srv, () => {});
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async function main() {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const pageErrors = [];

  // devices: 'av' (camera + mic), 'audio' (no camera), 'none' (neither)
  async function open(label, devices) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
    page.on('dialog', d => d.dismiss().catch(() => {}));
    page.on('pageerror', e => pageErrors.push(label + ': ' + e.message));
    if (devices && devices !== 'av') {
      await page.addInitScript((mode) => {
        const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = function (c) {
          if (mode === 'none') return Promise.reject(new DOMException('Requested device not found', 'NotFoundError'));
          if (c && c.video) return Promise.reject(new DOMException('Requested device not found', 'NotFoundError'));
          return orig(c);
        };
      }, devices);
    }
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    await page.evaluate(() => { window.__alerts = []; window.alert = function (m) { window.__alerts.push(String(m)); }; window.confirm = function () { return true; }; });
    return page;
  }
  async function asInstructor(page, name, code) {
    await page.evaluate(([nm, code]) => {
      if (!document.getElementById('iVideoRoom')) { const d = document.createElement('div'); d.id = 'iVideoRoom'; document.body.appendChild(d); }
      currentInstructor = { id: 'INS1', name: nm };
      enterVideoRoom('Welding 101', 'instructor', code);
    }, [name, code]);
    await page.waitForTimeout(1500);
  }
  async function asStudent(page, name, code) {
    await page.evaluate(([nm, code]) => {
      if (!document.getElementById('sVideoRoom')) { const d = document.createElement('div'); d.id = 'sVideoRoom'; document.body.appendChild(d); }
      currentStudent = { id: 'STU-' + nm.replace(/\W/g, ''), name: nm };
      enterVideoRoom('Welding 101', 'student', code);
    }, [name, code]);
    await page.waitForTimeout(1500);
  }
  // What a page receives from, and sends to, one peer.
  async function linkStats(page, peerId) {
    return page.evaluate(async (pid) => {
      const conns = (rtcPeer && rtcPeer.connections && rtcPeer.connections[pid]) || [];
      const media = conns.filter(c => c.type === 'media' && c.open !== false && c.peerConnection && c.peerConnection.connectionState !== 'closed');
      const data = conns.filter(c => c.type === 'data' && c.open);
      const out = { media: media.length, data: data.length, inbound: [], outboundVideo: 0, ice: '' };
      for (const mc of media) {
        const pc = mc.peerConnection;
        out.ice = pc.iceConnectionState;
        const st = await pc.getStats();
        st.forEach(x => {
          if (x.type === 'inbound-rtp' && x.bytesReceived > 0) out.inbound.push(x.kind);
          if (x.type === 'outbound-rtp' && x.kind === 'video' && x.bytesSent > 0) out.outboundVideo++;
        });
      }
      out.inbound = Array.from(new Set(out.inbound)).sort();
      return out;
    }, peerId);
  }
  const roomState = page => page.evaluate(() => ({
    inRoom: !!document.querySelector('#vc-video-grid') && Array.from(document.querySelectorAll('#iVideoRoom, #sVideoRoom')).some(r => r.style.display !== 'none' && r.contains(document.querySelector('#vc-video-grid'))),
    rtcPeer: !!rtcPeer, code: currentRoomCode, host: isRoomHost,
    hostTile: !!document.querySelector('#vc-video-grid .host-tile video'),
    tiles: Array.from(document.querySelectorAll('#vc-video-grid .video-tile')).map(t => t.id),
    peers: Object.keys(peerNames), alerts: (window.__alerts || []).slice()
  }));

  const CODE = 'VCTEST2345';
  const HOST_ID = 'cestis-' + CODE + '-host';

  section('The instructor opens a room');
  const host = await open('host', 'av');
  await asInstructor(host, 'Teacher T', CODE);
  await host.evaluate((code) => vcCreateRoom('Welding 101', 'instructor', code), CODE);
  await host.waitForTimeout(2500);
  let h = await roomState(host);
  ok(h.inRoom && h.host && h.code === CODE, 'the host is in its room');

  section('A trainee with no camera or microphone, over a slow link, sees and hears the instructor');
  const s1 = await open('s1', 'none');
  {
    const cdp = await s1.context().newCDPSession(s1);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: -1, uploadThroughput: -1 });
  }
  await asStudent(s1, 'Student One', CODE);
  await s1.evaluate(() => {
    window.__order = [];
    const add = vcAddVideo;
    vcAddVideo = function (pid) { window.__order.push('stream' + (document.getElementById('vc-video-grid') ? '' : '(before room)')); return add.apply(this, arguments); };
    const show = vcShowConference;
    vcShowConference = function () { window.__order.push('room-drawn'); return show.apply(this, arguments); };
  });
  await s1.evaluate((code) => vcJoinRoom('Welding 101', 'student', code), CODE);
  await s1.waitForTimeout(9000);
  let r1 = await roomState(s1);
  let l1 = await linkStats(s1, HOST_ID);
  const order = await s1.evaluate(() => window.__order);
  ok(r1.inRoom, 'the trainee is in the room');
  ok(r1.hostTile, 'the instructor\'s tile is shown (stream order: ' + order.join(', ') + ')');
  ok(l1.inbound.indexOf('audio') !== -1 && l1.inbound.indexOf('video') !== -1,
    'with no devices of its own the trainee still receives the instructor\'s sound and picture (got ' + JSON.stringify(l1) + ')');

  section('A trainee who switches the camera off in the lobby still sees the instructor');
  const s2 = await open('s2', 'av');
  await asStudent(s2, 'Student Two', CODE);
  await s2.waitForTimeout(1500);
  await s2.evaluate(() => toggleLobbyDevice('video'));
  await s2.waitForTimeout(500);
  const s2tracks = await s2.evaluate(() => localStream ? localStream.getTracks().map(t => t.kind) : null);
  ok(JSON.stringify(s2tracks) === '["audio"]', 'the lobby camera is really off (tracks: ' + JSON.stringify(s2tracks) + ')');
  await s2.evaluate((code) => vcJoinRoom('Welding 101', 'student', code), CODE);
  await s2.waitForTimeout(8000);
  let r2 = await roomState(s2);
  let l2 = await linkStats(s2, HOST_ID);
  ok(r2.inRoom && r2.hostTile, 'the trainee is in the room with the instructor\'s tile');
  ok(l2.inbound.indexOf('video') !== -1 && l2.inbound.indexOf('audio') !== -1, 'and receives the instructor\'s picture and sound (got ' + JSON.stringify(l2) + ')');

  section('Two trainees hold one connection between them, and send each other no video');
  const s1id = await s1.evaluate(() => rtcPeer.id);
  const s2id = await s2.evaluate(() => rtcPeer.id);
  const a = await linkStats(s1, s2id), b = await linkStats(s2, s1id);
  ok(a.data === 1 && b.data === 1, 'exactly one data connection between the trainees (got ' + a.data + '/' + b.data + ')');
  ok(a.media === 1 && b.media === 1, 'exactly one media connection between the trainees (got ' + a.media + '/' + b.media + ')');
  ok(a.outboundVideo === 0 && b.outboundVideo === 0, 'no trainee uploads video to another trainee');
  // Turn Student Two's camera back on: the picture goes to the instructor only.
  await s2.evaluate(() => vcToggleCam());
  await s2.waitForTimeout(6000);
  const toHost = await linkStats(s2, HOST_ID), toPeer = await linkStats(s2, s1id);
  ok(toHost.outboundVideo === 1, 'a camera switched on mid-class reaches the instructor (' + JSON.stringify(toHost) + ')');
  ok(toPeer.outboundVideo === 0, 'and still not the other trainee');
  h = await roomState(host);
  ok(h.peers.length === 2, 'the host sees both trainees in the participant list (' + h.peers.length + ')');

  section('A trainee cannot end the class, remove anyone, or mute the instructor');
  await s1.evaluate(() => {
    vcBroadcastData({ type: 'end-meeting' });
    vcBroadcastData({ type: 'kick' });
    vcBroadcastData({ type: 'mute-all' });
  });
  await host.waitForTimeout(2500);
  h = await roomState(host);
  r2 = await roomState(s2);
  const hostMic = await host.evaluate(() => localStream.getAudioTracks().every(t => t.enabled));
  ok(h.inRoom && h.rtcPeer && h.code === CODE, 'the host is still in its room');
  ok(r2.inRoom && r2.rtcPeer, 'the other trainee is still in the room');
  ok(hostMic, 'the instructor\'s microphone is still on');

  section('Somebody who only knows the code receives nothing from the instructor');
  const spy = await open('spy', 'none');
  const spyGot = await spy.evaluate(async (hostId) => {
    const p = new Peer('cestis-VCTEST2345-spy' + Math.random().toString(36).slice(2, 6),
      { host: location.hostname, port: Number(location.port), path: '/peerjs', secure: false });
    await new Promise(r => p.on('open', r));
    const call = p.call(hostId, new MediaStream(), { constraints: { offerToReceiveAudio: true, offerToReceiveVideo: true } });
    const kinds = [];
    call.on('stream', s => s.getTracks().forEach(t => kinds.push(t.kind)));
    await new Promise(r => setTimeout(r, 13000));
    let flowing = [];
    try {
      const st = await call.peerConnection.getStats();
      st.forEach(x => { if (x.type === 'inbound-rtp' && x.bytesReceived > 0) flowing.push(x.kind); });
    } catch (e) {}
    return { kinds, flowing, state: call.peerConnection ? call.peerConnection.connectionState : 'none' };
  }, HOST_ID);
  ok(spyGot.flowing.length === 0, 'no sound or picture reaches a caller that never joined (' + JSON.stringify(spyGot) + ')');
  h = await roomState(host);
  ok(h.peers.length === 2, 'and the host\'s list is unchanged');
  await spy.context().close();

  section('A trainee turned away from a full room leaves, and is not turned away again and again');
  await host.evaluate(() => {
    window.__cap = CESTISCore.vcCapacity.canJoinMesh;
    CESTISCore.vcCapacity.canJoinMesh = function (n) { return n < 3 ? { allowed: true, cap: 3 } : { allowed: false, cap: 3, reason: 'This room is full.' }; };
  });
  const s3 = await open('s3', 'av');
  await asStudent(s3, 'Student Three', CODE);
  await s3.evaluate((code) => vcJoinRoom('Welding 101', 'student', code), CODE);
  await s3.waitForTimeout(16000);
  const r3 = await roomState(s3);
  ok(!r3.inRoom && !r3.rtcPeer, 'the refused trainee is out of the room (' + JSON.stringify({ inRoom: r3.inRoom, rtcPeer: r3.rtcPeer }) + ')');
  ok(r3.alerts.filter(x => /full/i.test(x)).length === 1, 'and was told once (' + r3.alerts.length + ' alerts)');
  h = await roomState(host);
  // (Student One has no camera or microphone, so has no tile on the host.)
  const known = ['vc-tile-local', 'vc-tile-' + s1id, 'vc-tile-' + s2id];
  ok(h.peers.length === 2 && h.tiles.every(t => known.indexOf(t) !== -1), 'the host shows no tile or name for the refused trainee (' + h.tiles.join(',') + ')');
  await host.evaluate(() => { CESTISCore.vcCapacity.canJoinMesh = window.__cap; });
  await s3.context().close();

  section('The instructor can leave and rejoin straight away');
  await host.evaluate(() => exitVideoRoom('instructor'));
  await host.waitForTimeout(800);
  // Back through the class's Join button to the lobby, then Rejoin Room.
  await asInstructor(host, 'Teacher T', CODE);
  await host.evaluate(() => vcRejoinRoom('Welding 101', 'instructor'));
  await host.waitForTimeout(3500);
  h = await roomState(host);
  ok(h.inRoom && h.rtcPeer && h.host, 'Rejoin opens the room again (the old id was released)');
  await s1.waitForTimeout(13000);
  r1 = await roomState(s1);
  ok(r1.hostTile, 'a trainee who waited sees the instructor again after the rejoin');

  section('Ending the class sends everyone out');
  await host.evaluate(() => vcEndMeetingForAll());
  await host.waitForTimeout(2500);
  r1 = await roomState(s1); r2 = await roomState(s2); h = await roomState(host);
  ok(!r1.inRoom && !r1.rtcPeer && !r2.inRoom && !r2.rtcPeer, 'both trainees left when the host ended the class');
  ok(!h.rtcPeer, 'the host left too');

  ok(pageErrors.length === 0, 'no page errors (' + pageErrors.slice(0, 3).join(' | ') + ')');

  await browser.close();
  srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
