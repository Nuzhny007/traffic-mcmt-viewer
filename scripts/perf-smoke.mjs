#!/usr/bin/env node
// Performance smoke test for the viewer under synthetic load.
//
// Starts the mock feed, serves the production build and drives headless Edge
// over CDP, then reports frame-time percentiles. Fails when the renderer drops
// below the thresholds, so a change that quietly makes the map slow is caught
// before it lands.
//
//   npm run build && npm run perf
//   npm run perf -- --tracks 2000 --threshold-ms 25
//
// Requirements: Node >= 22 (global fetch/WebSocket), Python 3, Microsoft Edge.
// The bundle stores the WebSocket URL, so mock and app must agree on the port:
// rebuild with VITE_WS_URL=... if you change --ws-port.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const tracks = Number(flag('tracks', '1000'));
const tickHz = Number(flag('tick', '10'));
const wsPort = Number(flag('ws-port', '8080'));
const httpPort = Number(flag('http-port', '4173'));
const cdpPort = Number(flag('cdp-port', '9333'));
const settleMs = Number(flag('settle', '8000'));
// Budget for headless Edge with software WebGL (--disable-gpu), 1370x758:
// 1000 tracks with 40-point trails measure ~55 FPS / p95 20.5 ms, and the same
// load without trails is 60 FPS / p95 18 ms. A GPU-backed browser is faster, so
// these numbers are the regression gate, not the target.
const thresholdMs = Number(flag('threshold-ms', '22'));
const minFps = Number(flag('min-fps', '50'));
const query = flag('query', '');
const keep = has('keep');

const children = [];

function start(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'ignore', cwd: root, ...options });
  children.push(child);
  return child;
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function stopAll() {
  for (const child of children) stop(child);
  children.length = 0;
}

async function waitForUrl(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // not listening yet
    }
    await sleep(200);
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

async function profile(url) {
  const targets = await waitForUrl(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json());
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('no CDP page target');

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });

  const send = (method, params = {}) => {
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };

  await new Promise((resolve) => {
    if (socket.readyState === WebSocket.OPEN) resolve();
    else socket.addEventListener('open', resolve, { once: true });
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  await sleep(settleMs);

  const result = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const deltas = [];
      let last = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          const now = performance.now();
          deltas.push(now - last);
          last = now;
          if (deltas.length < 180) requestAnimationFrame(tick); else resolve();
        };
        requestAnimationFrame(tick);
      });
      deltas.sort((a, b) => a - b);
      const q = (p) => Math.round(deltas[Math.min(deltas.length - 1, Math.floor(p * deltas.length))] * 10) / 10;
      const metrics = [...document.querySelectorAll('.metric')];
      return {
        hud: metrics.map((node) => node.textContent.trim()),
        viewport: [window.innerWidth, window.innerHeight],
        tracks: Number((metrics.find((node) => node.textContent.includes('Треков'))?.textContent ?? '').replace(/\\D+/g, '')),
        frameMs: { p50: q(0.5), p95: q(0.95), max: Math.round(deltas.at(-1) * 10) / 10 },
        fps: Math.round(1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length)),
        heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      };
    })()`,
  });

  socket.close();
  return result.result.value;
}

async function main() {
  if (!existsSync(path.join(root, 'dist', 'index.html'))) {
    throw new Error('dist/ is missing; run "npm run build" first');
  }

  start('python', ['mock/mock_server.py'], {
    env: { ...process.env, MOCK_TRACKS: String(tracks), MOCK_TICK_HZ: String(tickHz), MOCK_PORT: String(wsPort) },
  });
  await waitForUrl(`http://127.0.0.1:${wsPort}/health`);

  start('python', ['-m', 'http.server', String(httpPort), '--bind', '127.0.0.1'], { cwd: path.join(root, 'dist') });
  await waitForUrl(`http://127.0.0.1:${httpPort}/`);

  const edge = findEdge();
  start(edge, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${path.join(root, 'node_modules', '.cache', 'perf-edge')}`,
    `--remote-debugging-port=${cdpPort}`,
    '--window-size=1400,900',
    'about:blank',
  ]);

  const profileResult = await profile(`http://127.0.0.1:${httpPort}/${query}`);
  const failures = [];

  if (profileResult.frameMs.p95 > thresholdMs) {
    failures.push(`p95 ${profileResult.frameMs.p95} ms > ${thresholdMs} ms`);
  }
  if (profileResult.fps < minFps) {
    failures.push(`fps ${profileResult.fps} < ${minFps}`);
  }
  if (profileResult.tracks < tracks * 0.9) {
    failures.push(`only ${profileResult.tracks} of ${tracks} tracks reached the buffer`);
  }

  console.log(JSON.stringify({ tracks, tickHz, ...profileResult, thresholdMs, minFps, failures }, null, 2));
  return failures.length === 0 ? 0 : 1;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  console.error(`perf-smoke: ${error.message}`);
  exitCode = 2;
} finally {
  if (keep) {
    console.error('perf-smoke: --keep, leaving helper processes running');
  } else {
    stopAll();
  }
}

process.exit(exitCode);
