/**
 * store.mjs — review store. goldens/ holds approved PNGs (only approve() writes them) and denied.json;
 *   review/{actual,diff,records} are generated. evaluate() applies the status rules, approve()/deny() decide.
 *   ATLAS_ROOT env overrides the repo root (used by tests). Record paths are repo-relative, forward slashes.
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
};
const DENIED = path.join(DIRS.goldens, 'denied.json');
const DEFAULT_THRESHOLD = 0.0005, DEFAULT_PIXEL_THRESHOLD = 0.1;
const SLEEP = new Int32Array(new SharedArrayBuffer(4));

export const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
const now = () => new Date().toISOString();
const rel = (...parts) => parts.join('/');
const splitKey = (key) => { const i = key.indexOf('/'); return { variant: key.slice(0, i), file: key.slice(i + 1) }; };

export function paths(variant, file) {
  const png = `${file}.png`;
  return {
    actual: path.join(DIRS.actual, variant, png),
    approved: path.join(DIRS.goldens, variant, png),
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

export function compare(actualPng, approvedPng, { pixelThreshold = DEFAULT_PIXEL_THRESHOLD } = {}) {
  const a = PNG.sync.read(actualPng), b = PNG.sync.read(approvedPng);
  const base = { width: a.width, height: a.height, approvedWidth: b.width, approvedHeight: b.height };
  if (a.width !== b.width || a.height !== b.height) return { ...base, diffPixels: null, diffRatio: null, diffPng: null };
  const diff = new PNG({ width: a.width, height: a.height });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: pixelThreshold, includeAA: false });
  // encoding a full-page PNG is the slow part: skip it when nothing differs
  return { ...base, diffPixels, diffRatio: diffPixels / (a.width * a.height), diffPng: diffPixels ? PNG.sync.write(diff) : null };
}

export function evaluate({ variant, file, actualPng, htmlHash, configHash, volatile = false, info,
  threshold = DEFAULT_THRESHOLD, pixelThreshold = DEFAULT_PIXEL_THRESHOLD }) {
  const p = paths(variant, file), rp = relPaths(variant, file), key = `${variant}/${file}`;
  writeAtomic(p.actual, actualPng);
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
    diffPixels: null, diffRatio: null,
    htmlHash: htmlHash ?? null, approvedHtmlHash: meta?.htmlHash ?? null,
    configHash, approvedConfigHash: meta?.configHash ?? null,
    actualHash,
    status: 'new', reasons: [], htmlIdentical: !!meta && meta.htmlHash != null && htmlHash != null && meta.htmlHash === htmlHash,
    decision: 'pending', note: '', capturedAt: now(), decidedAt: null,
  };

  let diffPng = null;
  if (volatile) {
    rec.status = 'volatile'; rec.decision = 'approved';
  } else if (!approvedPng) {
    // new: stays pending
  } else {
    const c = compare(actualPng, approvedPng, { pixelThreshold });
    Object.assign(rec, { approvedWidth: c.approvedWidth, approvedHeight: c.approvedHeight, diffPixels: c.diffPixels, diffRatio: c.diffRatio });
    diffPng = c.diffPng;
    const reasons = [];
    if (c.diffPixels === null) reasons.push('size');
    else if (c.diffRatio > threshold) reasons.push('pixels');
    if (!meta) {
      // legacy golden without meta: html/config cannot be compared, so it must be re-approved once
      if (htmlHash != null) reasons.push('html');
      reasons.push('config');
    } else {
      if (rec.approvedHtmlHash != null && htmlHash != null && rec.approvedHtmlHash !== htmlHash) reasons.push('html');
      if (rec.approvedConfigHash != null && rec.approvedConfigHash !== configHash) reasons.push('config');
    }
    rec.reasons = reasons;
    if (reasons.length === 0) {
      rec.status = 'match'; rec.decision = 'approved';
      rec.note = meta?.note ?? ''; rec.decidedAt = meta?.approvedAt ?? null;
    } else {
      rec.status = 'changed';
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
    diffPixels: 0, diffRatio: 0, htmlIdentical: rec.htmlHash != null, decidedAt: at, note,
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

export function cleanActual() {
  for (const d of [DIRS.actual, DIRS.diff, DIRS.records]) fs.rmSync(d, { recursive: true, force: true });
}
