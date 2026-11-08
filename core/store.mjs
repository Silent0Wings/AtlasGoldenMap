/**
 * store.mjs — review store. goldens/ holds approved PNGs (and markup) and denied.json;
 *   review/{actual,diff,records,collections,.visual-failures} are generated. evaluate() applies the status rules,
 *   approve()/deny() decide. ATLAS_ROOT env overrides the repo root (used by tests). Record paths are repo-relative,
 *   forward slashes.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pixelmatch = require('pixelmatch');
const { PNG } = require('pngjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.ATLAS_ROOT ? path.resolve(process.env.ATLAS_ROOT) : path.resolve(HERE, '..');
export const DIRS = {
  goldens: path.join(ROOT, 'goldens'),
  actual: path.join(ROOT, 'review', 'actual'),
  diff: path.join(ROOT, 'review', 'diff'),
  records: path.join(ROOT, 'review', 'records'),
  collections: path.join(ROOT, 'review', 'collections'),
  visualFailures: path.join(ROOT, 'review', '.visual-failures'),
  summary: path.join(ROOT, 'review', 'run-summary.json'),
  stabilize: path.join(ROOT, 'review', 'stabilize.json'),
};
const DENIED = path.join(DIRS.goldens, 'denied.json');
const DEFAULT_THRESHOLD = 0.0005, DEFAULT_PIXEL_THRESHOLD = 0.1;
const HTML_DIFF_MAX_LINES = 400, HTML_DIFF_MAX_CELLS = 4e6;
const SLEEP = new Int32Array(new SharedArrayBuffer(4));

export const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
const now = () => new Date().toISOString();
const rel = (...parts) => parts.join('/');
const splitKey = (key) => { const i = key.indexOf('/'); return { variant: key.slice(0, i), file: key.slice(i + 1) }; };

export function paths(variant, file) {
  const png = `${file}.png`;
  return {
    actual: path.join(DIRS.actual, variant, png),
    actualHtml: path.join(DIRS.actual, variant, `${file}.html`),
    approved: path.join(DIRS.goldens, variant, png),
    approvedHtml: path.join(DIRS.goldens, variant, `${file}.html`),
    meta: path.join(DIRS.goldens, variant, `${file}.meta.json`),
    diff: path.join(DIRS.diff, variant, png),
    record: path.join(DIRS.records, variant, `${file}.json`),
  };
}

// Repo-relative record paths for the same files.
const relPaths = (variant, file) => ({
  actual: rel('review', 'actual', variant, `${file}.png`),
  approved: rel('goldens', variant, `${file}.png`),
  diff: rel('review', 'diff', variant, `${file}.png`),
});

// tmp + rename; retries because Windows rename fails with EPERM/EBUSY while a reader holds the target.
export function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data);
  for (let i = 0; ; i++) {
    try { return fs.renameSync(tmp, file); }
    catch (e) {
      if (i >= 9 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { fs.rmSync(tmp, { force: true }); throw e; }
      Atomics.wait(SLEEP, 0, 0, 30 * (i + 1));
    }
  }
}
const readJson = (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
const rmFile = (file) => fs.rmSync(file, { force: true });
const json = (obj) => JSON.stringify(obj, null, 2) + '\n';

export function readMeta(variant, file) { return readJson(paths(variant, file).meta); }
export function readDenied() { return readJson(DENIED) ?? {}; }
export function writeDenied(obj) { writeAtomic(DENIED, json(obj)); }

// Inclusive box of the exact red (255,0,0) pixels in a pixelmatch diff image; null when there are none.
function redBox(img) {
  let x1 = Infinity, y1 = Infinity, x2 = -1, y2 = -1;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i] !== 255 || img.data[i + 1] !== 0 || img.data[i + 2] !== 0) continue;
    const p = i >> 2, x = p % img.width, y = (p - x) / img.width;
    if (x < x1) x1 = x; if (x > x2) x2 = x;
    if (y < y1) y1 = y; if (y > y2) y2 = y;
  }
  return x2 < 0 ? null : { x1, y1, x2, y2 };
}

export function compare(actualPng, approvedPng, { pixelThreshold = DEFAULT_PIXEL_THRESHOLD, ignoreAntialiasing = true } = {}) {
  const a = PNG.sync.read(actualPng), b = PNG.sync.read(approvedPng);
  const base = { width: a.width, height: a.height, approvedWidth: b.width, approvedHeight: b.height };
  if (a.width !== b.width || a.height !== b.height) return { ...base, diffPixels: null, diffRatio: null, diffPng: null, bbox: null };
  const diff = new PNG({ width: a.width, height: a.height });
  // diffColor is pure red so redBox() can find the differing pixels; anti-aliased pixels are drawn yellow and not counted
  const diffPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height,
    { threshold: pixelThreshold, includeAA: !ignoreAntialiasing, diffColor: [255, 0, 0] });
  // encoding a full-page PNG is the slow part: skip it when nothing differs
  return {
    ...base, diffPixels, diffRatio: diffPixels / (a.width * a.height),
    bbox: diffPixels ? redBox(diff) : null,
    diffPng: diffPixels ? PNG.sync.write(diff) : null,
  };
}

export function evaluate({ variant, file, actualPng, htmlHash, htmlText = null, configHash, volatile = false, info,
  settled = true, canvases = [], failOnHtml = false, ignoreAntialiasing = true,
  threshold = DEFAULT_THRESHOLD, pixelThreshold = DEFAULT_PIXEL_THRESHOLD }) {
  const p = paths(variant, file), rp = relPaths(variant, file), key = `${variant}/${file}`;
  writeAtomic(p.actual, actualPng);
  if (htmlText != null) writeAtomic(p.actualHtml, htmlText); else rmFile(p.actualHtml);
  const actualHash = sha256(actualPng);
  const meta = readMeta(variant, file);
  const approvedPng = fs.existsSync(p.approved) ? fs.readFileSync(p.approved) : null;
  const a = PNG.sync.read(actualPng);

  const rec = {
    key, variant, file,
    id: info.id, nodeId: info.nodeId, label: info.label, kind: info.kind,
    group: info.group ?? null, tags: info.tags ?? [],
    volatile: !!volatile,
    actual: rp.actual, approved: approvedPng ? rp.approved : null, diff: null,
    width: a.width, height: a.height,
    approvedWidth: meta?.width ?? null, approvedHeight: meta?.height ?? null,
    diffPixels: null, diffRatio: null, bbox: null, threshold,
    options: { pixelThreshold, ignoreAntialiasing, failOnHtml },
    htmlHash: htmlHash ?? null, approvedHtmlHash: meta?.htmlHash ?? null, htmlChanged: false,
    configHash, approvedConfigHash: meta?.configHash ?? null,
    actualHash, settled: settled !== false, canvases: canvases ?? [],
    status: 'new', reasons: [], htmlIdentical: !!meta && meta.htmlHash != null && htmlHash != null && meta.htmlHash === htmlHash,
    decision: 'pending', note: '', capturedAt: now(), decidedAt: null,
  };

  let diffPng = null;
  if (volatile) {
    rec.status = 'volatile'; rec.decision = 'approved';
  } else {
    if (approvedPng) {
      const c = compare(actualPng, approvedPng, { pixelThreshold, ignoreAntialiasing });
      Object.assign(rec, { approvedWidth: c.approvedWidth, approvedHeight: c.approvedHeight, diffPixels: c.diffPixels, diffRatio: c.diffRatio, bbox: c.bbox });
      diffPng = c.diffPng;
    }
    if (!rec.settled) {
      // still animating or loading: never a verdict on the page, and it needs a person either way
      rec.status = 'unsettled'; rec.reasons = ['unsettled'];
    } else if (approvedPng) {
      const reasons = [];
      if (rec.diffPixels === null) reasons.push('size');
      else if (rec.diffRatio > threshold) reasons.push('pixels');
      if (!meta) {
        // legacy golden without meta: html/config cannot be compared, so it must be re-approved once
        if (htmlHash != null) reasons.push('html');
        reasons.push('config');
      } else {
        if (rec.approvedHtmlHash != null && htmlHash != null && rec.approvedHtmlHash !== htmlHash) reasons.push('html');
        if (rec.approvedConfigHash != null && rec.approvedConfigHash !== configHash) reasons.push('config');
      }
      if (!failOnHtml && reasons.includes('html')) {
        reasons.splice(reasons.indexOf('html'), 1);
        rec.htmlChanged = true;
      }
      rec.reasons = reasons;
      if (reasons.length === 0) {
        rec.status = 'match'; rec.decision = 'approved';
        rec.note = meta?.note ?? ''; rec.decidedAt = meta?.approvedAt ?? null;
      } else {
        rec.status = reasons.length === 1 && reasons[0] === 'config' ? 'stale' : 'changed';
      }
    }
    // no golden and settled: stays new, pending
    if (rec.status !== 'match' && approvedPng) {
      const denial = readDenied()[key];
      if (denial && denial.actualHash === actualHash && denial.configHash === configHash) {
        rec.decision = 'denied'; rec.note = denial.note ?? ''; rec.decidedAt = denial.at ?? null;
      }
    }
  }

  if (diffPng) { writeAtomic(p.diff, diffPng); rec.diff = rp.diff; }
  else { rmFile(p.diff); }
  writeRecord(rec);
  return rec;
}

export function listRecords() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.json')) out.push(JSON.parse(fs.readFileSync(f, 'utf8')));
    }
  };
  walk(DIRS.records);
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

// Keys of every approved golden: goldens/<variant>/*.png (nested folders included).
export function listGoldens() {
  const out = [];
  if (!fs.existsSync(DIRS.goldens)) return out;
  for (const v of fs.readdirSync(DIRS.goldens, { withFileTypes: true })) {
    if (!v.isDirectory()) continue;
    const walk = (dir, prefix) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
        else if (e.name.endsWith('.png')) out.push(`${v.name}/${prefix}${e.name.slice(0, -4)}`);
      }
    };
    walk(path.join(DIRS.goldens, v.name), '');
  }
  return out.sort();
}

export function readRecord(key) {
  const { variant, file } = splitKey(key);
  return readJson(paths(variant, file).record);
}

export function writeRecord(rec) {
  writeAtomic(paths(rec.variant, rec.file).record, json(rec));
  return rec;
}

export function approve(key, note = '') {
  const rec = readRecord(key);
  if (!rec) throw new Error(`no record for ${key}`);
  const p = paths(rec.variant, rec.file);
  if (!fs.existsSync(p.actual)) throw new Error(`no actual png for ${key}`);
  const actualPng = fs.readFileSync(p.actual);
  if (sha256(actualPng) !== rec.actualHash) throw new Error(`actual changed since capture: re-capture ${key}`);
  writeAtomic(p.approved, actualPng);
  if (fs.existsSync(p.actualHtml)) writeAtomic(p.approvedHtml, fs.readFileSync(p.actualHtml));
  const at = now();
  writeAtomic(p.meta, json({ htmlHash: rec.htmlHash, configHash: rec.configHash, width: rec.width, height: rec.height, approvedAt: at, note }));
  const denied = readDenied();
  if (key in denied) { delete denied[key]; writeDenied(denied); }
  rmFile(p.diff);
  Object.assign(rec, {
    status: 'match', reasons: [], decision: 'approved',
    approved: relPaths(rec.variant, rec.file).approved, diff: null,
    approvedWidth: rec.width, approvedHeight: rec.height,
    approvedHtmlHash: rec.htmlHash, approvedConfigHash: rec.configHash,
    diffPixels: 0, diffRatio: 0, bbox: null, htmlChanged: false, settled: true,
    htmlIdentical: rec.htmlHash != null, decidedAt: at, note,
  });
  return writeRecord(rec);
}

export function deny(key, note = '') {
  const rec = readRecord(key);
  if (!rec) throw new Error(`no record for ${key}`);
  const at = now();
  const denied = readDenied();
  denied[key] = { actualHash: rec.actualHash, configHash: rec.configHash, note, at };
  writeDenied(denied);
  Object.assign(rec, { decision: 'denied', note, decidedAt: at });
  return writeRecord(rec);
}

export function approveWhere(predicate) {
  let n = 0;
  for (const r of listRecords()) if (predicate(r)) { approve(r.key); n++; }
  return n;
}

// Markup diff of the last capture against the approved markup. Lines are '-' (approved only) and '+' (actual only),
// with 2 lines of context around each change.
export function htmlDiff(key) {
  const { variant, file } = splitKey(key);
  const p = paths(variant, file);
  if (!fs.existsSync(p.actualHtml) || !fs.existsSync(p.approvedHtml)) return { available: false, lines: [], truncated: false };
  const split = (f) => fs.readFileSync(f, 'utf8').replace(/></g, '>\n<').split('\n');
  const a = split(p.approvedHtml), b = split(p.actualHtml);
  let truncated = false;

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const ma = a.slice(start, endA), mb = b.slice(start, endB);
  const n = ma.length, m = mb.length;

  const ops = [];   // [op, text] for the whole file, in order
  for (let i = 0; i < start; i++) ops.push([' ', a[i]]);
  if (n * m > HTML_DIFF_MAX_CELLS) {
    truncated = true;
    for (const t of ma) ops.push(['-', t]);
    for (const t of mb) ops.push(['+', t]);
  } else {
    // LCS table over the remainder, filled from the end so the walk below runs forward
    const W = m + 1, t = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        t[i * W + j] = ma[i] === mb[j] ? t[(i + 1) * W + j + 1] + 1 : Math.max(t[(i + 1) * W + j], t[i * W + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (ma[i] === mb[j]) { ops.push([' ', ma[i]]); i++; j++; }
      else if (t[(i + 1) * W + j] >= t[i * W + j + 1]) ops.push(['-', ma[i++]]);
      else ops.push(['+', mb[j++]]);
    }
    while (i < n) ops.push(['-', ma[i++]]);
    while (j < m) ops.push(['+', mb[j++]]);
  }
  for (let i = endA; i < a.length; i++) ops.push([' ', a[i]]);

  // keep changed lines and 2 lines of context either side
  const keep = new Uint8Array(ops.length);
  ops.forEach(([op], i) => {
    if (op === ' ') return;
    for (let k = Math.max(0, i - 2); k <= Math.min(ops.length - 1, i + 2); k++) keep[k] = 1;
  });
  const lines = [];
  for (let i = 0; i < ops.length; i++) {
    if (!keep[i]) continue;
    if (lines.length >= HTML_DIFF_MAX_LINES) { truncated = true; break; }
    lines.push({ op: ops[i][0], text: ops[i][1] });
  }
  return { available: true, lines, truncated };
}

export function cleanActual() {
  for (const d of [DIRS.actual, DIRS.diff, DIRS.records]) fs.rmSync(d, { recursive: true, force: true });
}

// Previous item count of a collection, or null. Persists the count for the next run.
export function noteCollection(variant, file, count) {
  const f = path.join(DIRS.collections, variant, `${file}.json`);
  const prev = readJson(f)?.count ?? null;
  writeAtomic(f, json({ count, at: now() }));
  return prev;
}

// A visual mismatch recorded by the first attempt, so a retry does not re-capture and pass on a lucky shot.
const visualFailureFile = (variant, file) => path.join(DIRS.visualFailures, variant, `${file}.txt`);
export function markVisualFailure(variant, file, message) { writeAtomic(visualFailureFile(variant, file), String(message)); }
export function readVisualFailure(variant, file) {
  const f = visualFailureFile(variant, file);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}
export function clearVisualFailure(variant, file) { rmFile(visualFailureFile(variant, file)); }

// Written by run-reporter.ts and stabilize; advisory, so an unreadable file reads as absent.
export function readRunSummary() { try { return readJson(DIRS.summary); } catch { return null; } }
export function readStabilize() { try { return readJson(DIRS.stabilize); } catch { return null; } }
