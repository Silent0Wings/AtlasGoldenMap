#!/usr/bin/env node
/**
 * control-server.mjs — local control panel for the atlas: set up, configure, capture, check, stabilize,
 * approve and explore from one page. It runs core/cli.mjs and core/review-server.mjs, nothing else.
 *
 *   node core/control-server.mjs [--port 8099] [--open]
 *
 * Binds 127.0.0.1 only. Node built-ins only, so it works before npm install.
 * The argv of every job is built here from an allowlist; the client never sends argv or a shell command.
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn, spawnSync, exec } from 'child_process';
import { randomUUID } from 'crypto';
import { StringDecoder } from 'string_decoder';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ATLAS_ROOT ? path.resolve(process.env.ATLAS_ROOT) : path.resolve(HERE, '..');
const CLI = path.join(ROOT, 'core', 'cli.mjs');
const REVIEW_SERVER = path.join(ROOT, 'core', 'review-server.mjs');
const PAGE = path.join(HERE, 'control.html');
const ICON = path.join(ROOT, 'assets', 'icon_transparent.png');
const CONFIG = path.join(ROOT, 'atlas.config.ts');
const GOLDENS = path.join(ROOT, 'goldens');
const META = path.join(ROOT, 'shots', 'meta.json');
const SUMMARY = path.join(ROOT, 'review', 'run-summary.json');
const STABILIZE = path.join(ROOT, 'review', 'stabilize.json');
const RECORDS = path.join(ROOT, 'review', 'records');
const LOCK = path.join(ROOT, 'review', '.capture.lock');
const DASHBOARD = path.join(ROOT, 'dashboard.html');
const REPORT = path.join(ROOT, 'report', 'index.html');
const PLAYWRIGHT = path.join(ROOT, 'node_modules', '@playwright', 'test');

const DEFAULT_PORT = 8099;
const DEFAULT_REVIEW_PORT = 8097;
const MAX_TRIES = 10;
const MAX_BODY = 1024 * 1024;       // 1 MB
const MAX_OUT = 2 * 1024 * 1024;    // 2 MB of job output kept
const SAFE_TEXT = /^[\w :.\/@-]*$/; // grep and project: cli.mjs runs them through a shell, so nothing else
const RECORD_STATUSES = ['new', 'match', 'changed', 'stale', 'unsettled', 'volatile'];
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b[@-Z\\^_]/g;
const ANSI_START = /^\x1b(?:\[[0-9;?]*[ -\/]*[@-~]|[@-Z\\^_])/;
const ANSWER_TEXT = ['title', 'command', 'cwd', 'staticDir', 'port', 'baseURL', 'start', 'themeKey'];
const ANSWER_BOOL = ['dark', 'mobile', 'crawl'];
const LABELS = {
  deps: 'Install dependencies', setup: 'Set up', config: 'Configure', atlas: 'Build atlas and open',
  capture: 'Capture', check: 'Check', stabilize: 'Stabilize', 'approve-new': 'Approve new',
  'approve-all': 'Approve all', build: 'Rebuild dashboard', crawl: 'Crawl links',
  discover: 'Discover navigation', open: 'Open dashboard', report: 'Open test report', clean: 'Clean',
};

const argv = process.argv.slice(2);
const die = msg => { console.error(`[x] ${msg}`); process.exit(1); };
const optValue = name => {
  const eq = argv.find(a => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

function parsePort() {
  const raw = optValue('--port');
  if (raw === undefined) return DEFAULT_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) die(`Bad --port "${raw}".`);
  return n;
}

const START_PORT = parsePort();
const OPEN = argv.includes('--open');
let PORT = 0;   // set once listening; the Host and Origin guards compare against it
const urlFor = port => `http://127.0.0.1:${port}/`;
const allowedHosts = () => new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const allowedOrigins = () => new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

/* ---------------------------------------------------------------- helpers */

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, extra });
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

function readJsonFile(file) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return isObj(v) ? v : null; }
  catch { return null; }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function sendFile(res, file, type, missing) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { throw httpError(404, missing); }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', c => {
      if (tooBig) return;
      size += c.length;
      if (size > MAX_BODY) { tooBig = true; reject(httpError(413, 'request body is over 1 MB')); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!tooBig) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

async function readJson(req) {
  const text = await readBody(req);
  let value;
  try { value = JSON.parse(text || '{}'); } catch { throw httpError(400, 'body is not valid JSON'); }
  if (!isObj(value)) throw httpError(400, 'body must be a JSON object');
  return value;
}

// every POST must be JSON: a cross-site form cannot send that without a preflight, which this server never grants
async function postJson(req) {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json'))
    throw httpError(415, 'content-type must be application/json');
  return readJson(req);
}

// GET a local JSON document; null on any failure or after `ms`
function getJson(port, p, ms = 800) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout: ms }, res => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; if (body.length > MAX_BODY) { req.destroy(); resolve(null); } });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

const probeAtlas = async port => (await getJson(port, '/api/state', 1500))?.app === 'atlas-control';

function openUrl(u) {
  const c = process.platform === 'win32' ? `start "" "${u}"` : process.platform === 'darwin' ? `open "${u}"` : `xdg-open "${u}"`;
  exec(c, () => {});
}

/* ---------------------------------------------------------------- state */

const configExists = () => fs.existsSync(CONFIG);

function configInfo() {
  let src = '';
  try { src = fs.readFileSync(CONFIG, 'utf8'); } catch {}
  const m = src.match(/\btitle:\s*(['"`])([^'"`\r\n]{1,200})\1/);
  return { configTitle: m ? m[2] : null, isDemo: src.includes('examples/demo-site') };
}

// PNG count under goldens/ (nested folders included)
function countPng(dir) {
  let n = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (e.isDirectory()) n += countPng(path.join(dir, e.name));
    else if (e.name.endsWith('.png')) n++;
  }
  return n;
}

function recordCounts() {
  const counts = { total: 0 };
  for (const s of RECORD_STATUSES) counts[s] = 0;
  const walk = dir => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      if (!e.name.endsWith('.json')) continue;
      const r = readJsonFile(f);
      if (!r) continue;
      counts.total++;
      if (RECORD_STATUSES.includes(r.status)) counts[r.status]++;
    }
  };
  walk(RECORDS);
  return counts;
}

function stabilizeInfo() {
  const s = readJsonFile(STABILIZE);
  return s ? { generatedAt: s.generatedAt ?? null, runs: s.runs ?? null, total: s.total ?? null, unstable: s.unstable ?? null } : null;
}

function variantNames() {
  const v = readJsonFile(META)?.variants;
  return Array.isArray(v) ? v.map(x => x?.name).filter(n => typeof n === 'string') : [];
}

function reviewPort() {
  const p = readJsonFile(META)?.reviewPort;
  return Number.isInteger(p) && p >= 1 && p <= 65535 ? p : DEFAULT_REVIEW_PORT;
}

// the review server this panel started (review.child) or one already running on the port (external)
const review = { child: null };

async function reviewState() {
  const port = reviewPort();
  if (review.child) return { running: true, port, external: false };
  const external = Array.isArray((await getJson(port, '/api/records'))?.records);
  return { running: external, port, external };
}

async function state() {
  const major = Number(process.versions.node.split('.')[0]);
  return {
    app: 'atlas-control',
    node: process.version,
    nodeOk: major >= 18,
    depsInstalled: fs.existsSync(PLAYWRIGHT),
    configExists: fs.existsSync(CONFIG),
    ...configInfo(),
    goldens: countPng(GOLDENS),
    records: recordCounts(),
    summary: readJsonFile(SUMMARY),
    stabilize: stabilizeInfo(),
    dashboardExists: fs.existsSync(DASHBOARD),
    reportExists: fs.existsSync(REPORT),
    captureLock: fs.existsSync(LOCK),
    job: publicJob(job),
    review: await reviewState(),
    variants: variantNames(),
  };
}

/* ---------------------------------------------------------------- allowlist */

// one line of text, max 500 characters, for each config answer
function answersOf(v) {
  if (!isObj(v)) throw httpError(400, 'answers must be an object');
  const allowed = ['kind', ...ANSWER_TEXT, ...ANSWER_BOOL];
  for (const k of Object.keys(v)) if (!allowed.includes(k)) throw httpError(400, `unknown answer "${k}"`);
  const out = {};
  if (v.kind !== undefined) {
    if (!['d', 's', 'r'].includes(v.kind)) throw httpError(400, 'kind must be d, s or r');
    out.kind = v.kind;
  }
  for (const k of ANSWER_TEXT) {
    if (v[k] === undefined) continue;
    if (typeof v[k] !== 'string' || v[k].length > 500 || /[\r\n\0]/.test(v[k]))
      throw httpError(400, `${k} must be one line of text, up to 500 characters`);
    out[k] = v[k];
  }
  for (const k of ANSWER_BOOL) {
    if (v[k] === undefined) continue;
    if (typeof v[k] !== 'boolean') throw httpError(400, `${k} must be true or false`);
    out[k] = v[k];
  }
  return out;
}

function safeText(v, name) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || v.length > 200 || v.startsWith('-') || !SAFE_TEXT.test(v))
    throw httpError(400, `${name} may only use letters, digits, spaces and : . / @ - (up to 200 characters, not starting with -)`);
  return v;
}

// action + options -> { argv for cli.mjs, label }. Unknown actions and unknown options are 400.
function plan(action, options) {
  const opts = allowed => {
    if (options === undefined || options === null) return {};
    if (!isObj(options)) throw httpError(400, 'options must be an object');
    for (const k of Object.keys(options)) if (!allowed.includes(k)) throw httpError(400, `option "${k}" is not allowed for ${action}`);
    return options;
  };
  const flag = (o, k) => {
    if (o[k] === undefined) return false;
    if (typeof o[k] !== 'boolean') throw httpError(400, `${k} must be true or false`);
    return o[k];
  };
  const pw = o => {
    const grep = safeText(o.grep, 'grep');
    const project = safeText(o.project, 'project');
    const args = [];
    if (grep) args.push('-g', grep);
    if (project) args.push(`--project=${project}`);
    return args.length ? ['--', ...args] : [];
  };
  const run = (...parts) => ({ argv: ['run', ...parts], label: LABELS[action] });

  switch (action) {
    case 'deps':
      opts([]);
      return { argv: ['deps'], label: LABELS.deps };
    case 'setup':
      opts([]);
      // setup would wait for keyboard input when there is no config, so it is only used once one exists
      return configExists() ? { argv: ['setup'], label: LABELS.setup } : { argv: ['deps'], label: LABELS.deps };
    case 'config': {
      const o = opts(['answers', 'replace']);
      const answers = answersOf(o.answers);
      const replace = flag(o, 'replace');
      if (configExists() && !replace)
        throw httpError(400, 'atlas.config.ts already exists: tick "Replace the existing config" to replace it (a backup is kept)');
      return { argv: ['config', '--answers', JSON.stringify(answers), ...(replace ? ['--force'] : [])], label: LABELS.config };
    }
    case 'atlas':
    case 'check': {
      const o = opts(['grep', 'project']);
      return run(action, ...pw(o));
    }
    case 'capture': {
      const o = opts(['grep', 'project', 'noStabilize']);
      return run('capture', ...(flag(o, 'noStabilize') ? ['--no-stabilize'] : []), ...pw(o));
    }
    case 'stabilize': {
      const o = opts(['runs', 'keep', 'all', 'grep', 'project']);
      const parts = ['stabilize'];
      if (o.runs !== undefined) {
        if (!Number.isInteger(o.runs) || o.runs < 2 || o.runs > 10) throw httpError(400, 'runs must be a whole number from 2 to 10');
        parts.push('--runs', String(o.runs));
      }
      if (flag(o, 'keep')) parts.push('--keep');
      if (flag(o, 'all')) parts.push('--all');
      return run(...parts, ...pw(o));
    }
    case 'approve-new': {
      const o = opts(['force']);
      return run('approve-new', ...(flag(o, 'force') ? ['--force'] : []));
    }
    case 'approve-all': {
      const o = opts(['confirm', 'force']);
      if (o.confirm !== true) throw httpError(400, 'approve-all changes goldens: send confirm: true');
      return run('approve-all', '--yes', ...(flag(o, 'force') ? ['--force'] : []));
    }
    case 'clean': {
      const o = opts(['goldens', 'confirm']);
      const goldens = flag(o, 'goldens');
      if (goldens && o.confirm !== 'delete goldens') throw httpError(400, 'deleting goldens needs confirm: "delete goldens"');
      return run('clean', ...(goldens ? ['--goldens'] : []));
    }
    case 'build':
    case 'crawl':
    case 'discover':
    case 'open':
    case 'report':
      opts([]);
      return run(action);
    default:
      throw httpError(400, `unknown action "${action}"`);
  }
}

/* ---------------------------------------------------------------- jobs */

// one job at a time. Output is kept as UTF-8 byte chunks; past MAX_OUT the oldest bytes are dropped.
let job = null;   // the current job, or the last one
const publicJob = j => j ? {
  id: j.id, action: j.action, label: j.label, argv: j.argv, status: j.status,
  exitCode: j.exitCode, startedAt: j.startedAt, endedAt: j.endedAt,
} : null;
const busy = () => !!job && !job.endedAt;

function append(j, text) {
  const clean = text.replace(ANSI, '').replace(/\r/g, '');
  if (!clean) return;
  const buf = Buffer.from(clean, 'utf8');
  j.chunks.push(buf);
  j.size += buf.length;
  j.total += buf.length;
  while (j.chunks.length > 1 && j.size > MAX_OUT) {
    const c = j.chunks.shift();
    j.size -= c.length;
    j.base += c.length;
    j.truncated = true;
  }
  if (j.size > MAX_OUT) {
    const over = j.size - MAX_OUT;
    j.chunks[0] = j.chunks[0].subarray(over);
    j.size -= over;
    j.base += over;
    j.truncated = true;
  }
}

// raw child bytes -> text: UTF-8 split safely across chunks, a partial ANSI escape held for the next chunk
function sink(j) {
  const dec = new StringDecoder('utf8');
  let held = '';
  return {
    write(buf) {
      const text = held + dec.write(buf);
      const esc = text.lastIndexOf('\x1b');
      const hold = esc >= 0 && text.length - esc < 32 && !ANSI_START.test(text.slice(esc));
      held = hold ? text.slice(esc) : '';
      append(j, hold ? text.slice(0, esc) : text);
    },
    flush() {
      const rest = held + dec.end();
      held = '';
      append(j, rest);
    },
  };
}

function outputSince(j, since) {
  if (!j) return { output: '', offset: 0, truncated: false };
  const all = Buffer.concat(j.chunks, j.size);
  const from = since <= j.base ? 0 : Math.min(since - j.base, all.length);
  return { output: all.subarray(from).toString('utf8'), offset: j.total, truncated: j.truncated };
}

// kill a child and everything it started: taskkill /T on Windows, the whole process group elsewhere (spawned detached)
function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} } }
}

function finish(j, code) {
  if (j.endedAt) return;
  for (const s of j.sinks) s.flush();
  j.endedAt = new Date().toISOString();
  j.exitCode = code ?? null;
  if (j.status !== 'stopped') j.status = code === 0 ? 'done' : 'failed';
  j.child = null;
}

function startJob(p, action) {
  const child = spawn(process.execPath, [CLI, ...p.argv], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' },
    windowsHide: true,
    detached: process.platform !== 'win32',   // own process group, so Stop takes the whole tree
  });
  const j = {
    id: randomUUID(), action, label: p.label, argv: p.argv, status: 'running', exitCode: null,
    startedAt: new Date().toISOString(), endedAt: null, child,
    chunks: [], size: 0, base: 0, total: 0, truncated: false, sinks: [],
  };
  j.sinks = [sink(j), sink(j)];
  const [out, err] = j.sinks;
  child.stdout.on('data', b => out.write(b));
  child.stderr.on('data', b => err.write(b));
  child.on('error', e => { append(j, `\n[x] ${e.message}\n`); finish(j, 1); });
  child.on('close', code => finish(j, code));
  job = j;
  return j;
}

function stopJob() {
  job.status = 'stopped';
  killTree(job.child);
}

/* ---------------------------------------------------------------- review server */

function setReview(start) {
  return start ? startReview() : stopReview();
}

async function startReview() {
  const st = await reviewState();
  if (st.running) return st;   // already running, started by this panel or outside it
  const port = st.port;
  const child = spawn(process.execPath, [REVIEW_SERVER, '--port', String(port)], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32',
  });
  review.child = child;
  const clear = () => { if (review.child === child) review.child = null; };
  child.on('exit', clear);
  child.on('error', clear);
  return { running: true, port, external: false };
}

async function stopReview() {
  const port = reviewPort();
  if (review.child) {
    killTree(review.child);
    review.child = null;
    return { running: false, port, external: false };
  }
  const st = await reviewState();
  if (st.external) throw httpError(409, `the review server on port ${port} was started outside this panel: stop it in its terminal`);
  return st;
}

function stopAll() {
  if (busy()) stopJob();
  if (review.child) { killTree(review.child); review.child = null; }
}
process.on('exit', stopAll);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

/* ---------------------------------------------------------------- routes */

async function handle(req, res) {
  // DNS-rebinding guard: only answer requests addressed to this server by name
  if (!allowedHosts().has(req.headers.host)) throw httpError(403, 'bad Host header');
  // a page from another site sends its own Origin on a POST: only this panel's own origins may POST
  if (req.method === 'POST' && req.headers.origin !== undefined && !allowedOrigins().has(req.headers.origin))
    throw httpError(403, 'bad Origin header');
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const { pathname } = url;
  const only = want => { if (req.method !== want) throw httpError(405, 'method not allowed'); };

  if (pathname === '/') {
    only('GET');
    return sendFile(res, PAGE, 'text/html; charset=utf-8', 'core/control.html is missing');
  }
  if (pathname === '/icon.png') {
    only('GET');
    return sendFile(res, ICON, 'image/png', 'not found');
  }
  if (pathname === '/api/state') {
    only('GET');
    return sendJson(res, 200, await state());
  }
  if (pathname === '/api/job') {
    only('GET');
    const since = Number(url.searchParams.get('since') ?? 0);
    if (!Number.isInteger(since) || since < 0) throw httpError(400, 'since must be a whole number');
    return sendJson(res, 200, { job: publicJob(job), ...outputSince(job, since) });
  }
  if (pathname === '/api/run') {
    only('POST');
    const body = await postJson(req);
    if (typeof body.action !== 'string') throw httpError(400, 'action is required');
    const p = plan(body.action, body.options);
    if (busy()) throw httpError(409, `"${job.label}" is still running`, { job: publicJob(job) });
    return sendJson(res, 202, { job: publicJob(startJob(p, body.action)) });
  }
  if (pathname === '/api/stop') {
    only('POST');
    await postJson(req);
    if (!busy()) throw httpError(409, 'no job is running');
    stopJob();
    return sendJson(res, 200, { job: publicJob(job) });
  }
  if (pathname === '/api/review') {
    only('POST');
    const body = await postJson(req);
    if (typeof body.start !== 'boolean') throw httpError(400, 'start must be true or false');
    return sendJson(res, 200, { review: await setReview(body.start) });
  }
  if (pathname === '/api/shutdown') {
    only('POST');
    await postJson(req);
    sendJson(res, 200, { ok: true });
    res.on('finish', () => process.exit(0));   // exit handler stops the job and the review server
    return;
  }
  throw httpError(404, 'not found');
}

function onRequest(req, res) {
  handle(req, res).catch(e => {
    if (res.headersSent) { res.end(); return; }
    const status = e.status ?? 500;
    if (status >= 500) console.error(`[x] ${req.method} ${req.url}: ${e.stack || e.message}`);
    if (status === 413) res.setHeader('Connection', 'close');
    sendJson(res, status, { error: e.message, ...e.extra });
  });
}

/* ---------------------------------------------------------------- server */

function listenFrom(port, tries) {
  const srv = http.createServer(onRequest);
  srv.once('error', async e => {
    if (e.code !== 'EADDRINUSE') die(e.message);
    // a panel is already running on this port: open it instead of starting a second one
    if (await probeAtlas(port)) {
      console.log(`Control panel already running: ${urlFor(port)}`);
      if (OPEN) openUrl(urlFor(port));
      process.exit(0);
    }
    if (tries + 1 >= MAX_TRIES || port >= 65535)
      die(`Ports ${START_PORT} to ${port} are busy. Stop the other process or pass --port <n>.`);
    listenFrom(port + 1, tries + 1);
  });
  srv.listen(port, '127.0.0.1', () => {
    PORT = port;
    console.log(`Golden Map Atlas control panel: ${urlFor(port)}`);
    console.log('Only this computer can reach it. Use "Shut down" in the page, or Ctrl+C here, to stop it.');
    if (OPEN) openUrl(urlFor(port));
  });
}

listenFrom(START_PORT, 0);
