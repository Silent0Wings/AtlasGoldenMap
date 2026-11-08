/**
 * stabilize.mjs — flake detector. Captures every node N times into <root>/.stabilize/run-<i> (no goldens
 *   involved), then compares the shots across runs. A shot that differs between runs cannot be approved
 *   safely: this prints where it differs (bbox) and the likely cause. Writes review/stabilize.json.
 *   Call it from a process without ATLAS_ROOT set (store.mjs reads it at import).
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { compare, DIRS, writeAtomic } from './store.mjs';

const quote = a => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const readJson = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;

// every record a run wrote: <run>/review/records/<variant>/<file>.json
function runRecords(runDir) {
  const out = [];
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.json')) out.push(JSON.parse(fs.readFileSync(f, 'utf8')));
    }
  };
  walk(path.join(runDir, 'review', 'records'));
  return out;
}

// bbox is inclusive: {x1,y1,x2,y2}. Returns null when there is no pixel difference to explain.
export function likelyCause({ bbox, width, height, sameSize, canvases = [] }) {
  if (!sameSize) return 'size changes: content loaded late';
  if (!bbox) return null;
  const bw = bbox.x2 - bbox.x1 + 1, bh = bbox.y2 - bbox.y1 + 1;
  if (bw <= 2 || bh <= 2) return 'thin line: border / loading bar';
  const onCanvas = canvases.some(c => c.x < bbox.x2 + 1 && c.x + c.width > bbox.x1 && c.y < bbox.y2 + 1 && c.y + c.height > bbox.y1);
  if (onCanvas) return 'canvas animation';
  if (bw * bh >= 0.4 * width * height) return 'large area: late render or shifted content';
  return 'small region: animation or late content';
}

export async function stabilize({ root, runs = 3, passthrough = [], keep = false, all = false, log = console.log }) {
  if (runs < 2) throw new Error('stabilize needs at least 2 runs to compare');
  const scratch = path.join(root, '.stabilize');
  fs.rmSync(scratch, { recursive: true, force: true });
  const runDirs = [];
  for (let i = 1; i <= runs; i++) {
    const dir = path.join(scratch, `run-${i}`);
    runDirs.push(dir);
    log(`\n[*] Stabilize run ${i} of ${runs}...`);
    // a non-zero exit is expected: every shot is new or unsettled on the first pass
    const r = spawnSync(['npx', 'playwright', 'test', ...passthrough].map(quote).join(' '), {
      cwd: root, stdio: 'inherit', shell: true,
      env: { ...process.env, ATLAS_ROOT: dir, ATLAS_STABILIZE: '1' },
    });
    if (r.error) throw r.error;
  }

  // group records by key across runs; collect infra/error failures (visual ones are covered by the records)
  const byKey = new Map(), errors = new Map();
  runDirs.forEach((dir, i) => {
    const recs = runRecords(dir);
    const sum = readJson(path.join(dir, 'review', 'run-summary.json'));
    if (!recs.length && !sum) log(`[!] run ${i + 1} wrote nothing under review/: see its playwright output above`);
    for (const rec of recs) {
      if (!byKey.has(rec.key)) byKey.set(rec.key, []);
      byKey.get(rec.key).push({ dir, rec });
    }
    for (const f of sum?.failures ?? []) {
      if (f.class === 'visual') continue;
      const k = [f.variant, f.id, f.message].join('\n');
      if (!errors.has(k)) errors.set(k, { node: f.id, variant: f.variant, key: null, stable: 'error', diffPixels: null, bbox: null, cause: f.message });
    }
  });
  if (!byKey.size && !errors.size) throw new Error('no run produced any shot: see the playwright output above');

  const rows = [];
  for (const key of [...byKey.keys()].sort()) {
    const entries = byKey.get(key), first = entries[0].rec;
    const row = { node: first.id, variant: first.variant, key, stable: 'yes', diffPixels: 0, bbox: null, cause: null };
    if (entries.length < runs) {
      Object.assign(row, { stable: 'no', diffPixels: null, cause: 'appears in only some runs: collection or conditional content not ready' });
    } else if (entries.some(e => e.rec.status === 'unsettled')) {
      Object.assign(row, { stable: 'no', diffPixels: null, cause: 'never settled: still animating' });
    } else if (first.options?.failOnHtml && new Set(entries.map(e => e.rec.htmlHash)).size > 1) {
      Object.assign(row, { stable: 'no', diffPixels: null, cause: 'markup differs between runs: review.ignoreAttributes or review.htmlHash: false' });
    } else {
      // each later run against the first; keep the worst (a size change beats any pixel count)
      const refPng = fs.readFileSync(path.join(entries[0].dir, entries[0].rec.actual));
      let worst = null, worstScore = -1;
      for (const e of entries.slice(1)) {
        const c = compare(refPng, fs.readFileSync(path.join(e.dir, e.rec.actual)), first.options);
        const score = c.diffPixels === null ? Infinity : c.diffPixels;
        if (score > worstScore) { worst = c; worstScore = score; }
      }
      // same rule as check: a difference within the shot's threshold cannot fail it
      if (worst.diffPixels !== null && worst.diffRatio <= first.threshold) {
        row.diffPixels = worst.diffPixels;
      } else {
        const canvases = entries.flatMap(e => e.rec.canvases ?? []);
        const sameSize = worst.diffPixels !== null;
        const bbox = worst.bbox ?? null;
        Object.assign(row, {
          stable: 'no', diffPixels: worst.diffPixels, bbox,
          cause: likelyCause({ bbox, width: first.width, height: first.height, sameSize, canvases }),
        });
      }
    }
    rows.push(row);
  }

  const every = [...rows, ...errors.values()];
  const nonStable = every.filter(r => r.stable !== 'yes');
  const report = { generatedAt: new Date().toISOString(), runs, total: every.length, unstable: nonStable.length, rows: nonStable };
  writeAtomic(DIRS.stabilize, JSON.stringify(report, null, 2) + '\n');
  if (!keep) fs.rmSync(scratch, { recursive: true, force: true });

  // table in the same style as cli.mjs
  const shown = all ? every : nonStable;
  const cells = shown.map(r => [
    r.node, r.variant, r.stable,
    r.diffPixels === null || r.diffPixels === undefined ? '-' : r.diffPixels.toLocaleString('en-US'),
    r.bbox ? `(${r.bbox.x1},${r.bbox.y1})-(${r.bbox.x2},${r.bbox.y2})` : '-',
    r.cause ?? '-',
  ]);
  if (cells.length) {
    const headers = ['node', 'variant', 'stable', 'diff px', 'bbox', 'likely cause'];
    const widths = headers.map((h, i) => Math.max(h.length, ...cells.map(c => String(c[i]).length)));
    const line = c => c.map((x, i) => String(x).padEnd(widths[i])).join('  ');
    log('');
    log(line(headers));
    log(widths.map(w => '-'.repeat(w)).join('  '));
    cells.forEach(c => log(line(c)));
  }
  log(nonStable.length
    ? `\n[!] ${nonStable.length} of ${every.length} shots unstable. Fix the cause, then run stabilize again before approve-new.`
    : `\n[OK] ${every.length} shots stable across ${runs} runs`);
  return report;
}
