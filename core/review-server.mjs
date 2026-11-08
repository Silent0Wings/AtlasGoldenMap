#!/usr/bin/env node
/**
 * review-server.mjs — local review UI for the atlas: look at every captured shot next to its golden,
 * approve or deny it, and start a capture run from the browser.
 *
 *   node core/review-server.mjs [--port 8097] [--open]
 *
 * Binds 127.0.0.1 only. Writes goldens only through store.approve() (and only on an explicit approve).
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn, spawnSync, exec } from 'child_process';
import { fileURLToPath } from 'url';
import { ROOT, DIRS, listRecords, approve, deny, paths, htmlDiff, readRunSummary } from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REVIEW_HTML = path.join(HERE, 'review.html');
const TOOLTIP_JS = path.join(HERE, 'tooltip.js');
const META = path.join(ROOT, 'shots', 'meta.json');
const RUN_LOG = path.join(ROOT, 'review', 'run.log');
const LOCK_FILE = path.join(ROOT, 'review', '.capture.lock');
const MAX_BODY = 1024 * 1024;   // 1 MB
const LOG_TAIL = 200;
const DEFAULT_PORT = 8097;
const ALLOWED_DIRS = [DIRS.goldens, DIRS.actual, DIRS.diff].map(d => path.resolve(d));
// characters allowed in --grep / --project values (they are quoted for the shell, so no quotes, %, ^ or &)
const SAFE_GREP = /^[\w .:@/()|[\]+*?-]{1,200}$/;
const SAFE_PROJECT = /^[\w-]{1,64}$/;

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
  if (raw !== undefined) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) die(`Bad --port "${raw}".`);
    return n;
  }
  const meta = readMeta();
  if (Number.isInteger(meta.reviewPort)) return meta.reviewPort;
  return DEFAULT_PORT;
}

const PORT = parsePort();
const URL_BASE = `http://127.0.0.1:${PORT}`;
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

function readMeta() {
  try { return JSON.parse(fs.readFileSync(META, 'utf8')); } catch { return {}; }
}

/* ---------------------------------------------------------------- helpers */

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, extra });

// capture lock shared with cli.mjs: review/.capture.lock holds {pid, startedAt} while a capture runs.
// A lock whose pid is no longer alive is stale and gets overwritten.
function lockHolder(file) {
  let info;
  try { info = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  const pid = Number(info?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); return info; }
  catch (e) { return e.code === 'EPERM' ? info : null; }   // EPERM: alive, but owned by another user
}

// null when this process now holds the lock, otherwise the info of the live holder
function takeLock(file, startedAt) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let i = 0; i < 3; i++) {
    const held = lockHolder(file);
    if (held) return held;
    try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt }) + '\n', { flag: 'wx' }); return null; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (!lockHolder(file)) fs.rmSync(file, { force: true });   // stale: clear it and try again
    }
  }
  return lockHolder(file) ?? { pid: 'unknown', startedAt: '' };
}

function releaseLock(file) {
  try { if (JSON.parse(fs.readFileSync(file, 'utf8')).pid === process.pid) fs.rmSync(file, { force: true }); } catch {}
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'body must be a JSON object');
  return value;
}

function keysOf(body) {
  const { keys } = body;
  if (!Array.isArray(keys) || keys.length === 0 || !keys.every(k => typeof k === 'string'))
    throw httpError(400, 'keys must be a non-empty array of record keys');
  // every key is checked before any is decided: one bad key fails the whole request
  const byKey = new Map(listRecords().map(r => [r.key, r]));
  const bad = keys.filter(k => {
    const r = byKey.get(k);
    return !r || !fs.existsSync(paths(r.variant, r.file).actual);
  });
  if (bad.length) throw httpError(400, `no record or actual PNG for: ${bad.join(', ')}. Nothing was changed.`, { badKeys: bad });
  return keys;
}

// decide the keys one by one; if one throws, the records already changed go back with the 500 so the UI can merge them
function decideAll(keys, decide) {
  const changed = [];
  for (const key of keys) {
    try { changed.push(decide(key)); }
    catch (e) { throw httpError(500, e.message, { records: changed }); }
  }
  return changed;
}

function noteOf(body, { required = false } = {}) {
  if (body.note === undefined || body.note === null) {
    if (required) throw httpError(400, 'note is required');
    return '';
  }
  if (typeof body.note !== 'string') throw httpError(400, 'note must be a string');
  return body.note.slice(0, 1000);
}

const norm = p => (process.platform === 'win32' ? p.toLowerCase() : p);
function isInside(file, dir) {
  const d = norm(dir);
  return norm(file).startsWith(d.endsWith(path.sep) ? d : d + path.sep);
}

function openUrl(u) {
  const c = process.platform === 'win32' ? `start "" "${u}"` : process.platform === 'darwin' ? `open "${u}"` : `xdg-open "${u}"`;
  exec(c, () => {});
}

/* ---------------------------------------------------------------- routes */

function serveHtml(res) {
  let html;
  try { html = fs.readFileSync(REVIEW_HTML); } catch { throw httpError(500, 'core/review.html is missing'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function serveTooltip(res) {
  let js;
  try { js = fs.readFileSync(TOOLTIP_JS); } catch { throw httpError(500, 'core/tooltip.js is missing'); }
  res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(js);
}

function serveFile(res, p) {
  if (typeof p !== 'string' || !p || p.includes('\0')) throw httpError(400, 'missing p');
  const abs = path.resolve(ROOT, p);
  // containment first: anything outside goldens/, review/actual/, review/diff/ is 403, whatever its extension
  if (!ALLOWED_DIRS.some(d => isInside(abs, d))) throw httpError(403, 'path is outside the review folders');
  if (path.extname(abs).toLowerCase() !== '.png') throw httpError(415, 'only PNG files are served');
  // resolve symlinks too, then check containment again against the real directories
  let real;
  try { real = fs.realpathSync(abs); } catch { throw httpError(404, 'not found'); }
  const realDirs = ALLOWED_DIRS.map(d => { try { return fs.realpathSync(d); } catch { return d; } });
  if (!realDirs.some(d => isInside(real, d))) throw httpError(403, 'path is outside the review folders');
  if (!fs.statSync(real).isFile()) throw httpError(404, 'not found');
  const buf = fs.readFileSync(real);
  res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
  res.end(buf);
}

// the one run started from the UI (playwright test); at most one at a time
const run = { child: null, command: '', startedAt: null, exitCode: null };

function finishRun(child, code) {
  if (run.child !== child) return;
  run.child = null;
  run.exitCode = code;
  releaseLock(LOCK_FILE);
  try { fs.appendFileSync(RUN_LOG, `\n[done] exit code ${code}\n`); } catch {}
}

function startRun(body) {
  if (run.child) throw httpError(409, 'a run is already in progress');
  const parts = ['npx', 'playwright', 'test'];
  if (body.grep !== undefined && body.grep !== null && body.grep !== '') {
    if (typeof body.grep !== 'string' || !SAFE_GREP.test(body.grep)) throw httpError(400, 'grep has characters that are not allowed');
    parts.push('--grep', `"${body.grep}"`);
  }
  if (body.variant !== undefined && body.variant !== null && body.variant !== '') {
    if (typeof body.variant !== 'string' || !SAFE_PROJECT.test(body.variant)) throw httpError(400, 'variant must be a plain name');
    parts.push('--project', `"${body.variant}"`);
  }
  const command = parts.join(' ');
  // a capture from the CLI (or another review server) may be running: the lock says so
  const held = takeLock(LOCK_FILE, new Date().toISOString());
  if (held) throw httpError(409, `a capture is already running (pid ${held.pid}, started ${held.startedAt})`);
  let child;
  try {
    fs.mkdirSync(path.dirname(RUN_LOG), { recursive: true });
    const fd = fs.openSync(RUN_LOG, 'w');
    fs.writeSync(fd, `$ ${command}\n`);
    child = spawn(command, { cwd: ROOT, shell: true, stdio: ['ignore', fd, fd], windowsHide: true });
    fs.closeSync(fd);
  } catch (e) {
    releaseLock(LOCK_FILE);
    throw e;
  }
  run.child = child;
  run.command = command;
  run.startedAt = new Date().toISOString();
  run.exitCode = null;
  child.on('error', e => {
    try { fs.appendFileSync(RUN_LOG, `\n[x] ${e.message}\n`); } catch {}
    finishRun(child, 1);
  });
  child.on('close', code => finishRun(child, code ?? 1));
  return { running: true, command };
}

function runStatus() {
  let log = '';
  try { log = fs.readFileSync(RUN_LOG, 'utf8').split(/\r?\n/).slice(-LOG_TAIL).join('\n'); } catch {}
  return { running: !!run.child, exitCode: run.exitCode, command: run.command, startedAt: run.startedAt, log };
}

function killRun() {
  const child = run.child;
  if (!child) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function handle(req, res) {
  // DNS-rebinding guard: only answer requests addressed to this server by name
  if (!ALLOWED_HOSTS.has(req.headers.host)) throw httpError(403, 'bad Host header');
  const url = new URL(req.url, URL_BASE);
  const { pathname } = url;
  const method = req.method;
  const json = (needsJson) => {
    // a JSON content-type cannot be sent cross-site without a CORS preflight, which this server never grants
    if (needsJson && !(req.headers['content-type'] ?? '').startsWith('application/json'))
      throw httpError(415, 'content-type must be application/json');
  };

  if (pathname === '/') {
    if (method !== 'GET') throw httpError(405, 'method not allowed');
    return serveHtml(res);
  }
  if (pathname === '/tooltip.js') {
    if (method !== 'GET') throw httpError(405, 'method not allowed');
    return serveTooltip(res);
  }
  if (pathname === '/file') {
    if (method !== 'GET') throw httpError(405, 'method not allowed');
    return serveFile(res, url.searchParams.get('p'));
  }
  if (pathname === '/api/records') {
    if (method !== 'GET') throw httpError(405, 'method not allowed');
    return sendJson(res, 200, { records: listRecords(), meta: readMeta(), running: !!run.child });
  }
  if (pathname === '/api/approve') {
    if (method !== 'POST') throw httpError(405, 'method not allowed');
    json(true);
    const body = await readJson(req);
    const keys = keysOf(body);
    const note = noteOf(body);
    decideAll(keys, key => approve(key, note));
    return sendJson(res, 200, { records: listRecords() });
  }
  if (pathname === '/api/deny') {
    if (method !== 'POST') throw httpError(405, 'method not allowed');
    json(true);
    const body = await readJson(req);
    const keys = keysOf(body);
    const note = noteOf(body, { required: true });
    decideAll(keys, key => deny(key, note));
    return sendJson(res, 200, { records: listRecords() });
  }
  if (pathname === '/api/run') {
    if (method === 'GET') return sendJson(res, 200, runStatus());
    if (method !== 'POST') throw httpError(405, 'method not allowed');
    json(true);
    const body = await readJson(req);
    return sendJson(res, 202, startRun(body));
  }
  if (pathname === '/api/html-diff') {
    if (method !== 'GET') throw httpError(405, 'method not allowed');
    // same key rule as keysOf: the key must name a record
    const key = url.searchParams.get('key');
    if (!key || !listRecords().some(r => r.key === key)) throw httpError(404, 'unknown record key');
    return sendJson(res, 200, htmlDiff(key));
  }
  if (pathname === '/api/summary') {
    if (method !== 'GET') throw httpError(405, 'method not allowed');
    return sendJson(res, 200, readRunSummary() ?? null);
  }
  throw httpError(404, 'not found');
}

/* ---------------------------------------------------------------- server */

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    if (res.headersSent) { res.end(); return; }
    const status = e.status ?? 500;
    if (status >= 500) console.error(`[x] ${req.method} ${req.url}: ${e.stack || e.message}`);
    if (status === 413) res.setHeader('Connection', 'close');
    sendJson(res, status, { error: e.message, ...e.extra });
  });
});

let closing = false;
function shutdown() {
  if (closing) process.exit(130);
  closing = true;
  if (run.child) {
    console.log('\nStopping the running capture...');
    killRun();
    releaseLock(LOCK_FILE);
  }
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('error', e => {
  if (e.code === 'EADDRINUSE') die(`Port ${PORT} is busy. Stop the other process or pass --port <n>.`);
  die(e.message);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Review server: ${URL_BASE}/`);
  console.log('Approve or deny shots in the browser. Ctrl+C stops the server.');
  if (argv.includes('--open')) openUrl(`${URL_BASE}/`);
});
