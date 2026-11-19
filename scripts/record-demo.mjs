#!/usr/bin/env node
// Records a demo scene into an mp4.
//
//   npm run build
//   npm run demo:record                         # single-camera Aire (?demo=1)
//   node scripts/record-demo.mjs --scene auburn # two-camera Auburn (?demo=auburn)
//
// The script starts the C++ map gateway (replaying the long export), serves the
// production build, opens Edge on `about:blank`, injects the `__demoWait`
// handshake before the page loads and navigates to the demo scene. The page
// arms itself once the WS feed holds data; the screencast starts first and only
// then the recorder flips `__demoGo`, so the in-page director (tracks -> NOx ->
// PM2.5 -> final) is captured from the very first frame. The captured frames
// are then resampled to a constant 30 fps grid and encoded into an mp4 with
// ffmpeg; resampling (instead of a variable-framerate concat list) keeps the
// clip exactly as long as the scenario, because Chrome's screencast frame
// timestamps arrive in bursts far denser than 60 fps.
//
// Flags: --scene aire|auburn, --duration <s> stop deadline for the screencast
// (the director scenario is 125 s; the cap keeps a starved poll from recording
// past the end of the replayed data), --out <path>, --keep (keep temp frames),
// --skip-gateway (attach to a running gateway), --gateway-input (single file
// override), --gateway-config, --ws-port/--http-port/--cdp-port.
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  rmSync,
  writeFile,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mttRoot = path.resolve(root, '..', 'TrafficMCMT');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

/** Scene presets: page query, replay inputs, feed config and output. */
const SCENES = {
  aire: {
    query: '?demo=1',
    inputs: [path.resolve(mttRoot, 'build/datasets/aire/cam-01-demo.jsonl')],
    config: 'configs/map_feed_aire.yaml',
    out: 'demo/trafficmcmt-demo.mp4',
  },
  auburn: {
    query: '?demo=auburn',
    inputs: [
      path.resolve(mttRoot, 'build/datasets/auburn_toomer/cam-01-demo.jsonl'),
      path.resolve(mttRoot, 'build/datasets/auburn_toomer/cam-02-demo.jsonl'),
    ],
    config: 'configs/map_feed_auburn_demo.yaml',
    out: 'demo/auburn-dual-demo.mp4',
  },
};

const sceneName = flag('scene', 'aire');
const scene = SCENES[sceneName];
if (!scene) {
  throw new Error(`unknown --scene ${sceneName}; expected ${Object.keys(SCENES).join('|')}`);
}

const wsPort = Number(flag('ws-port', '8080'));
const httpPort = Number(flag('http-port', '4173'));
const cdpPort = Number(flag('cdp-port', '9333'));
const hardDurationS = Number(flag('duration', '132'));
const outPath = path.resolve(root, flag('out', scene.out));
const keep = has('keep');
const skipGateway = has('skip-gateway');

const gatewayExe = path.join(
  mttRoot,
  'build',
  'local-release',
  'Release',
  'trafficmcmt_map_gateway.exe',
);
const gatewayInputs = has('gateway-input')
  ? [path.resolve(mttRoot, flag('gateway-input'))]
  : scene.inputs;
const gatewayConfig = flag('gateway-config', scene.config);

const children = [];

function start(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'ignore', ...options });
  children.push(child);
  return child;
}

function stopAll() {
  for (const child of children) {
    if (child.exitCode === null) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    }
  }
  children.length = 0;
}

for (const signal of ['exit', 'SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopAll();
    process.exit(signal === 'exit' ? 0 : 1);
  });
}

// Keep the recorder observable when something dies mid-run: log the reason
// instead of exiting silently.
process.on('unhandledRejection', (reason) => {
  console.error('unhandled rejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('uncaught exception:', error);
});

async function waitForUrl(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function findEdge() {
  if (process.env.EDGE_PATH) return process.env.EDGE_PATH;
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error('Edge not found; set EDGE_PATH to a Chromium-based browser');
  }
  return found;
}

async function connectCdp(port) {
  const targets = await waitForUrl(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('no CDP page target');

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP socket error')), { once: true });
  });

  const pending = new Map();
  const handlers = new Map();
  let nextId = 1;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
        else waiter.resolve(message.result);
      }
      return;
    }
    if (message.method) {
      handlers.get(message.method.split('.')[0])?.(message);
    }
  });

  const send = (method, params = {}) => {
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const setHandler = (prefix, handler) => handlers.set(prefix, handler);

  return { socket, send, setHandler };
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  return result?.result?.value;
}

async function main() {
  if (!existsSync(path.join(root, 'dist', 'index.html'))) {
    throw new Error('dist/ not found — run `npm run build` first');
  }

  const frameDir = path.join(os.tmpdir(), `trafficmcmt-demo-frames-${Date.now()}`);
  mkdirSync(frameDir, { recursive: true });

  // 1. Gateway replaying the long export. Several `--input` flags are merged
  //    onto one timeline, which is what keeps the two cameras in sync.
  if (!skipGateway) {
    if (!existsSync(gatewayExe)) throw new Error(`gateway not found: ${gatewayExe}`);
    for (const input of gatewayInputs) {
      if (!existsSync(input)) throw new Error(`dataset not found: ${input}`);
    }
    start(gatewayExe, [
      ...gatewayInputs.flatMap((input) => ['--input', input]),
      '--config', gatewayConfig,
      '--port', String(wsPort),
      '--speed', '1',
      '--loop',
    ], { cwd: mttRoot });
    await waitForUrl(`http://localhost:${wsPort}/health`);
    console.log(`gateway up on :${wsPort} (${gatewayInputs.length} input(s))`);
  }

  // 2. Production preview server.
  start(process.execPath, [
    path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
    'preview',
    '--port', String(httpPort),
    '--strictPort',
  ], { cwd: root });
  await waitForUrl(`http://127.0.0.1:${httpPort}/`);
  console.log(`preview up on :${httpPort}`);

  // 3. Headed Edge, opened on `about:blank`: the demo page is loaded only
  //    after the recorder init script is installed, so the scenario can never
  //    start before the screencast does.
  const profileDir = path.join(os.tmpdir(), `trafficmcmt-demo-profile-${Date.now()}`);
  start(findEdge(), [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1920,1200',
    // Keep rendering while the window is covered by other windows: Windows
    // native occlusion otherwise pauses the compositor and the screencast
    // never receives a frame.
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    'about:blank',
  ]);
  const cdp = await connectCdp(cdpPort);
  const { send, setHandler } = cdp;
  await send('Page.enable');
  await send('Runtime.enable');
  // Force an exact 1920x1080 viewport regardless of window chrome.
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  // Deterministic start handshake: the page reads `__demoWait` on load, arms
  // itself (`__demoArmed`) once the WS feed holds data and starts the director
  // only after we flip `__demoGo` with the screencast already running.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.__demoWait = true;',
  });
  await send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/${scene.query}` });
  console.log('browser up, waiting for the demo page to arm…');

  // 4. Wait until the page is connected, holds track data and waits for `go`.
  const readyDeadline = Date.now() + 120_000;
  while (Date.now() < readyDeadline) {
    if ((await evaluate(send, 'window.__demoArmed === true')) === true) {
      break;
    }
    await sleep(500);
  }
  if ((await evaluate(send, 'window.__demoArmed === true')) !== true) {
    throw new Error('demo page did not arm in time');
  }
  await sleep(1500); // let the first emission frames settle

  // 5. Screencast; the scenario starts only once frames are being captured.
  //
  // Frames are written asynchronously: a synchronous write here (plus the
  // antivirus scan of every new 150 KB file) blocks the CDP socket, so frame
  // acks fall behind, Chrome buffers frames, and the muxed timeline runs
  // longer than the scenario. The stop deadline is checked per frame and is a
  // wall-clock backstop for a late `__demoDone` poll.
  const frames = [];
  let frameIndex = 0;
  let stopAt = 0;
  let stopping = false;
  let pendingWrites = 0;
  let lastTs = 0;
  let timestampFixes = 0;
  setHandler('Page', (message) => {
    if (message.method !== 'Page.screencastFrame') {
      return;
    }
    const { data, sessionId, metadata } = message.params;
    send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    frameIndex += 1;
    const name = `${String(frameIndex).padStart(6, '0')}.jpg`;
    const rawTs = metadata?.timestamp ?? Date.now() / 1000;
    // Chrome occasionally repeats or rewinds `metadata.timestamp`; the mux
    // clamps every non-positive delta to 1/60 s, which silently stretches the
    // clip. Keep the timeline strictly monotonic instead.
    let ts = rawTs;
    if (lastTs > 0 && ts <= lastTs) {
      ts = lastTs + 0.001;
      timestampFixes += 1;
    }
    lastTs = ts;
    frames.push({ name, ts, at: Date.now() });
    pendingWrites += 1;
    writeFile(path.join(frameDir, name), Buffer.from(data, 'base64'), () => {
      pendingWrites -= 1;
    });
    if (stopAt > 0 && !stopping && Date.now() >= stopAt) {
      stopping = true;
      send('Page.stopScreencast').catch(() => {});
    }
  });
  await send('Page.startScreencast', {
    format: 'jpeg',
    quality: 80,
    maxWidth: 1920,
    maxHeight: 1080,
    everyNthFrame: 1,
  });
  await sleep(1000); // make sure the first screencast frames are flowing
  await evaluate(send, 'window.__demoGo = true');
  console.log('recording…');
  {
    const layout = await evaluate(send, `JSON.stringify({
      inner: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      shells: [...document.querySelectorAll('.video-shell')].map((s) => {
        const r = s.getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.right), Math.round(r.width), Math.round(r.height)];
      }),
      canvases: [...document.querySelectorAll('.video-overlay')].map((c) => {
        const r = c.getBoundingClientRect();
        return [c.clientWidth, c.clientHeight, c.width, c.height, Math.round(r.left), Math.round(r.right)];
      }),
    })`);
    console.log(`layout: ${layout}`);
  }

  const startWall = Date.now();
  stopAt = startWall + hardDurationS * 1000;
  let nextProgress = startWall + 10_000;
  let done = false;
  while (!done) {
    await sleep(500);
    if (stopping) {
      done = true;
    }
    if ((await evaluate(send, 'window.__demoDone === true')) === true) {
      done = true;
    }
    if (Date.now() > nextProgress) {
      nextProgress = Date.now() + 10_000;
      console.log(`  … ${((Date.now() - startWall) / 1000).toFixed(0)}s, ${frames.length} frames`);
    }
    if (frames.length === 0 && (Date.now() - startWall) / 1000 > 15) {
      // The tab never produced a frame (crash/occlusion) — fail loudly
      // instead of waiting for the hard limit.
      throw new Error('screencast produced no frames');
    }
    if (frames.length > 0 && Date.now() - frames[frames.length - 1].at > 8000) {
      // The tab stopped producing frames (crash/occlusion) — fail loudly
      // instead of muxing a truncated video.
      throw new Error('screencast stalled: no frames for 8 s');
    }
    if ((Date.now() - startWall) / 1000 > hardDurationS) {
      console.warn('hard duration limit reached, stopping');
      break;
    }
  }
  await sleep(stopping ? 500 : 2000); // hold the final frame for a clean outro
  await send('Page.stopScreencast').catch(() => {});
  while (pendingWrites > 0) {
    await sleep(100); // let the queued JPEG writes land before muxing
  }
  console.log(`captured ${frames.length} frames`);
  {
    const first = frames[0];
    const last = frames[frames.length - 1];
    const span = last.ts - first.ts;
    const wall = (Date.now() - startWall) / 1000;
    console.log(
      `timeline: ${span.toFixed(2)}s from frame timestamps, ${wall.toFixed(2)}s wall, ` +
        `${((frames.length - 1) / span).toFixed(1)} fps, ${timestampFixes} ts fixes`,
    );
  }

  // 6. Resample to a constant 30 fps grid, then mux the numbered sequence.
  //
  // Chrome delivers screencast frames unevenly: bursts of two frames with
  // almost the same timestamp, then a gap of 50-70 ms. A concat list with a
  // `duration` per frame cannot express that (every delta below 1/60 s has to
  // be clamped up), and the clamped deltas alone stretched a 125 s scenario to
  // 150 s. Picking the newest frame at each 1/30 s tick keeps both the length
  // and the speed of the recorded scenario.
  const FPS = 30;
  const firstTs = frames[0].ts;
  const spanS = frames[frames.length - 1].ts - firstTs;
  const outFrames = Math.max(1, Math.round(spanS * FPS));
  const seqDir = path.join(frameDir, 'seq');
  mkdirSync(seqDir, { recursive: true });
  let pick = 0;
  for (let k = 0; k < outFrames; k += 1) {
    const target = firstTs + k / FPS;
    while (pick + 1 < frames.length && frames[pick + 1].ts <= target) {
      pick += 1;
    }
    const dst = path.join(seqDir, `${String(k + 1).padStart(6, '0')}.jpg`);
    try {
      linkSync(path.join(frameDir, frames[pick].name), dst);
    } catch {
      // Hard links can fail (different volume, FAT, some network shares).
      copyFileSync(path.join(frameDir, frames[pick].name), dst);
    }
  }
  console.log(`timeline: ${outFrames} frames at ${FPS} fps = ${(outFrames / FPS).toFixed(2)}s`);

  mkdirSync(path.dirname(outPath), { recursive: true });
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-framerate', String(FPS),
    '-i', path.join(seqDir, '%06d.jpg'),
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-crf', '19',
    '-preset', 'medium',
    '-movflags', '+faststart',
    outPath,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  await new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });
  console.log(`written: ${outPath}`);

  if (!keep) {
    rmSync(frameDir, { recursive: true, force: true });
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch (error) {
      // Edge releases the profile files a moment after taskkill; a leftover
      // temp dir is harmless.
      console.warn(`profile cleanup skipped: ${error?.code ?? error}`);
    }
  }
}

try {
  await main();
} finally {
  stopAll();
}
