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

  section('The instructor\'s start screen: Large Class first above 6 trainees only with the Centre\'s own video server');
  const host = await open('host', 'av');
  async function startScreen(n, largeBase) {
    return host.evaluate(([n, largeBase]) => {
      if (!document.getElementById('iVideoRoom')) { const d = document.createElement('div'); d.id = 'iVideoRoom'; document.body.appendChild(d); }
      currentInstructor = { id: 'INS1', name: 'Teacher T' };
      const keep = systemSettings.vcLargeRoomBase;
      systemSettings.vcLargeRoomBase = largeBase;
      students = [];
      for (let i = 0; i < n; i++) students.push({ id: 'STU-B' + i, name: 'Trainee ' + i, course: 'Welding 101', stage: 'training' });
      classSessions = [{ id: 'CS-B', name: 'Welding 101', course: 'Welding 101', date: localDateStr(), roomCode: 'BIGCLASS23', status: 'scheduled' }];
      enterVideoRoom('Welding 101', 'instructor', 'BIGCLASS23');
      const box = document.getElementById('vc-large-suggest');
      const later = document.getElementById('vc-large-later');
      const large = document.getElementById('vc-start-large');
      const small = Array.from(document.querySelectorAll('#iVideoRoom button')).filter(b => /Start Session/.test(b.textContent))[0];
      const out = { box: box ? box.textContent.replace(/\s+/g, ' ').trim() : '', later: later ? later.textContent.trim() : '',
        largePrimary: !!large && large.classList.contains('btn-primary'), smallPrimary: !!small && small.classList.contains('btn-primary'),
        builtIn: !!small, largeThere: !!large,
        largeAbove: !!(large && small && (large.compareDocumentPosition(small) & Node.DOCUMENT_POSITION_FOLLOWING)) };
      exitVideoRoom('instructor');
      students = []; classSessions = []; systemSettings.vcLargeRoomBase = keep;
      return out;
    }, [n, largeBase]);
  }
  const own = await startScreen(9, 'video.centre-example.org'), ownSmall = await startScreen(6, 'video.centre-example.org');
  ok(/^Large Class is suggested for 9 trainees: /.test(own.box) && own.largePrimary && !own.smallPrimary && own.largeAbove, 'own video server, a class of 9: Large Class first, with the reason (' + own.box.slice(0, 90) + '…)');
  ok(own.builtIn && !own.later, 'and the built-in room can still be chosen');
  ok(!ownSmall.box && !ownSmall.later && !ownSmall.largePrimary && ownSmall.smallPrimary, 'own video server, a class of 6: the built-in room first, no suggestion');
  const pub = await startScreen(9, ''), pubSmall = await startScreen(6, '');
  ok(!pub.box && pub.smallPrimary && !pub.largePrimary && !pub.largeAbove, 'no Centre video server, a class of 9: the built-in room stays the main button (the public fallback cuts embedded meetings off)');
  ok(pub.later === 'For more than 6 trainees, Large Class saves everyone data once the Centre’s own video server is added in Settings → Video Conference.', 'with one plain line under it (' + pub.later + ')');
  ok(pub.largeThere, 'and Large Class is still the second choice');
  ok(!pubSmall.box && !pubSmall.later && pubSmall.smallPrimary, 'no Centre video server, a class of 6: nothing more said');
  await host.waitForTimeout(500);

  section('The instructor opens a room');
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

  section('A trainee starts with the camera off and the microphone muted, and still sees and hears the instructor');
  const s2 = await open('s2', 'av');
  await asStudent(s2, 'Student Two', CODE);
  await s2.waitForTimeout(1500);
  const s2lobby = await s2.evaluate(() => ({
    tracks: localStream ? localStream.getTracks().map(t => t.kind + ':' + t.enabled) : null,
    micBtn: document.getElementById('vc-lobby-mic').textContent, camBtn: document.getElementById('vc-lobby-cam').textContent,
    micOff: document.getElementById('vc-lobby-mic').classList.contains('vc-off'), camOff: document.getElementById('vc-lobby-cam').classList.contains('vc-off'),
    note: (document.getElementById('vc-lobby-note') || {}).textContent || ''
  }));
  ok(JSON.stringify(s2lobby.tracks) === '["audio:false"]', 'the camera is not even opened, and the microphone is muted (tracks: ' + JSON.stringify(s2lobby.tracks) + ')');
  ok(s2lobby.micOff && s2lobby.camOff && /Microphone off/.test(s2lobby.micBtn) && /Camera off/.test(s2lobby.camBtn), 'the lobby buttons say so in words (' + s2lobby.micBtn + ' / ' + s2lobby.camBtn + ')');
  ok(/save mobile data/.test(s2lobby.note), 'and why, in one line');
  // The lobby camera can be tried and switched off again.
  await s2.evaluate(() => toggleLobbyDevice('video'));
  await s2.waitForTimeout(800);
  const s2on = await s2.evaluate(() => localStream.getVideoTracks().length);
  await s2.evaluate(() => toggleLobbyDevice('video'));
  await s2.waitForTimeout(500);
  const s2tracks = await s2.evaluate(() => localStream ? localStream.getTracks().map(t => t.kind) : null);
  ok(s2on === 1 && JSON.stringify(s2tracks) === '["audio"]', 'the lobby camera turns on, and off again for real (tracks: ' + JSON.stringify(s2tracks) + ')');
  await s2.evaluate((code) => vcJoinRoom('Welding 101', 'student', code), CODE);
  await s2.waitForTimeout(8000);
  let r2 = await roomState(s2);
  let l2 = await linkStats(s2, HOST_ID);
  ok(r2.inRoom && r2.hostTile, 'the trainee is in the room with the instructor\'s tile');
  ok(l2.inbound.indexOf('video') !== -1 && l2.inbound.indexOf('audio') !== -1, 'and receives the instructor\'s picture and sound (got ' + JSON.stringify(l2) + ')');
  const s2room = await s2.evaluate(() => ({
    mic: document.getElementById('vc-mic-btn').classList.contains('vc-off'), cam: document.getElementById('vc-cam-btn').classList.contains('vc-off'),
    micTitle: document.getElementById('vc-mic-btn').title, own: document.getElementById('vc-tile-local').textContent
  }));
  ok(s2room.mic && s2room.cam && s2room.micTitle === 'Turn microphone on', 'in the room the microphone and camera buttons show OFF, and say what a tap does');
  ok(/muted/.test(s2room.own) && /Camera off/.test(s2room.own), 'the trainee\'s own tile says muted, camera off (' + s2room.own.replace(/\s+/g, ' ').trim() + ')');

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

  section('A muted trainee sends no sound at all; unmuted, the instructor and classmates hear them');
  // Audio packets a page sends to one peer over `ms`.
  async function audioPacketsOut(page, peerId, ms) {
    const read = () => page.evaluate(async (pid) => {
      const conns = (rtcPeer && rtcPeer.connections && rtcPeer.connections[pid]) || [];
      let pk = 0;
      for (const mc of conns.filter(c => c.type === 'media' && c.peerConnection && c.peerConnection.connectionState !== 'closed')) {
        const st = await mc.peerConnection.getStats();
        st.forEach(x => { if (x.type === 'outbound-rtp' && x.kind === 'audio') pk += x.packetsSent || 0; });
      }
      return pk;
    }, peerId);
    const a = await read(); await page.waitForTimeout(ms); return (await read()) - a;
  }
  let mutedToHost = await audioPacketsOut(s2, HOST_ID, 3000), mutedToPeer = await audioPacketsOut(s2, s1id, 3000);
  ok(mutedToHost <= 2 && mutedToPeer <= 2, 'muted: no sound packets to the instructor or the classmate (' + mutedToHost + ' / ' + mutedToPeer + ' in 3 s; a switched-off track used to send ~150)');
  ok(await host.evaluate((id) => !!mutedPeers[id], s2id), 'the instructor\'s list shows the trainee as muted');
  ok(await host.evaluate((id) => !!document.querySelector('#vc-tile-' + sanitizePeerId(id) + ' .vc-tile-muted'), s2id), 'and their tile carries the muted sign');
  await s2.evaluate(() => vcToggleMic());
  await s2.waitForTimeout(1500);
  const openToHost = await audioPacketsOut(s2, HOST_ID, 3000), openToPeer = await audioPacketsOut(s2, s1id, 3000);
  ok(openToHost > 100 && openToPeer > 100, 'unmuted: the instructor and the classmate hear them (' + openToHost + ' / ' + openToPeer + ' packets in 3 s)');
  ok(await host.evaluate((id) => !mutedPeers[id] && !document.querySelector('#vc-tile-' + sanitizePeerId(id) + ' .vc-tile-muted'), s2id), 'and the instructor\'s list and their tile show them unmuted');
  await s2.evaluate(() => vcToggleMic());
  await s2.waitForTimeout(1500);
  mutedToHost = await audioPacketsOut(s2, HOST_ID, 3000);
  ok(mutedToHost <= 2, 'muted again: silent again (' + mutedToHost + ')');
  // The instructor's mute-all reaches a trainee who had unmuted.
  await s2.evaluate(() => vcToggleMic());
  await s2.waitForTimeout(800);
  await host.evaluate(() => vcMuteAll());
  await s2.waitForTimeout(1500);
  const afterMuteAll = await s2.evaluate(() => vcMicIsOn());
  mutedToHost = await audioPacketsOut(s2, HOST_ID, 3000);
  ok(!afterMuteAll && mutedToHost <= 2, 'the instructor\'s Mute All mutes them, and they send nothing (' + mutedToHost + ')');

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
