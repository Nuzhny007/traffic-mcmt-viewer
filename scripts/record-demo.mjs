#!/usr/bin/env node
// Records the single-camera air-monitoring demo (`?demo=1`) into an mp4.
//
//   npm run build
//   npm run demo:record
//
// The script starts the C++ map gateway (replaying the long Aire export),
// serves the production build, opens Edge on `about:blank`, injects the
// `__demoWait` handshake before the page loads and navigates to the demo
// scene. The page arms itself once the WS feed holds data; the screencast
// starts first and only then the recorder flips `__demoGo`, so the in-page
// director (tracks -> NOx -> PM2.5 -> final) is captured from the very first
// frame. Frames are muxed into mp4 with ffmpeg.
//
// Flags: --duration <s> hard limit, --out <path>, --keep (keep temp frames),
// --skip-gateway (attach to a running gateway), --ws-port/--http-port/--cdp-port.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

const wsPort = Number(flag('ws-port', '8080'));
const httpPort = Number(flag('http-port', '4173'));
const cdpPort = Number(flag('cdp-port', '9333'));
const hardDurationS = Number(flag('duration', '240'));
const outPath = path.resolve(root, flag('out', 'demo/trafficmcmt-demo.mp4'));
const keep = has('keep');
const skipGateway = has('skip-gateway');

const gatewayExe = path.join(
  mttRoot,
  'build',
  'local-release',
  'Release',
  'trafficmcmt_map_gateway.exe',
);
const gatewayInput = path.resolve(
  mttRoot,
  flag('gateway-input', 'build/datasets/aire/cam-01-demo.jsonl'),
);
const gatewayConfig = flag('gateway-config', 'configs/map_feed_aire.yaml');

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

  // 1. Gateway replaying the long export.
  if (!skipGateway) {
    if (!existsSync(gatewayExe)) throw new Error(`gateway not found: ${gatewayExe}`);
    if (!existsSync(gatewayInput)) throw new Error(`dataset not found: ${gatewayInput}`);
    start(gatewayExe, [
      '--input', gatewayInput,
      '--config', gatewayConfig,
      '--port', String(wsPort),
      '--speed', '1',
      '--loop',
    ], { cwd: mttRoot });
    await waitForUrl(`http://localhost:${wsPort}/health`);
    console.log(`gateway up on :${wsPort}`);
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
  await send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/?demo=1` });
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
  const frames = [];
  let frameIndex = 0;
  setHandler('Page', (message) => {
    if (message.method !== 'Page.screencastFrame') {
      return;
    }
    const { data, sessionId, metadata } = message.params;
    send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    frameIndex += 1;
    const name = `${String(frameIndex).padStart(6, '0')}.jpg`;
    const ts = metadata?.timestamp ?? Date.now() / 1000;
    frames.push({ name, ts, at: Date.now() });
    writeFileSync(path.join(frameDir, name), Buffer.from(data, 'base64'));
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

  const startWall = Date.now();
  let nextProgress = startWall + 10_000;
  let done = false;
  while (!done) {
    await sleep(500);
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
  await sleep(2000); // hold the final frame for a clean outro
  await send('Page.stopScreencast');
  console.log(`captured ${frames.length} frames`);

  // 6. Mux with ffmpeg (concat demuxer + per-frame durations).
  const concatLines = [];
  for (let i = 0; i < frames.length; i += 1) {
    const duration =
      i + 1 < frames.length ? frames[i + 1].ts - frames[i].ts : 1 / 30;
    concatLines.push(`file '${frames[i].name}'`);
    concatLines.push(`duration ${Math.max(duration, 1 / 60).toFixed(6)}`);
  }
  concatLines.push(`file '${frames[frames.length - 1].name}'`);
  writeFileSync(path.join(frameDir, 'frames.txt'), concatLines.join('\n'));

  mkdirSync(path.dirname(outPath), { recursive: true });
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', path.join(frameDir, 'frames.txt'),
    '-vf', 'fps=30,format=yuv420p',
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
