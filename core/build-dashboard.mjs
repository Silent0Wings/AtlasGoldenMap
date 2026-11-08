/**
 * build-dashboard.mjs — shots/meta.json + shots/nodes/<variant>/*.json + goldens/<variant>/*.png
 *   -> dashboard.html (single offline file: libs, data and WebP images inlined).
 *   Images come from review/actual/<variant>/<file> (latest capture), else goldens/<variant>/<file>.
 *
 *   node core/build-dashboard.mjs [--thumb 320] [--full 1000] [--q 0.72] [--out dashboard.html]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argS = (k, d) => { const i = process.argv.indexOf(`--${k}`); const v = i > 0 ? process.argv[i + 1] : undefined; return v && !v.startsWith('--') ? v : d; };
const arg = (k, d) => { const n = Number(argS(k, d)); return Number.isFinite(n) && n > 0 ? n : d; };
const THUMB_W = arg('thumb', 320), FULL_W = arg('full', 1000), Q = arg('q', 0.72);
const OUT_FILE = path.resolve(ROOT, argS('out', 'dashboard.html'));

const metaFile = path.join(ROOT, 'shots', 'meta.json');
if (!fs.existsSync(metaFile)) { console.error('No shots/meta.json — run the capture first (script\\run.bat atlas / npm run atlas).'); process.exit(1); }
const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
const VARIANTS = meta.variants.map(v => v.name);

/* ---------- merge fragments ---------- */
const nodes = new Map();
for (const theme of VARIANTS) {
  const dir = path.join(ROOT, 'shots', 'nodes', theme);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    for (const rec of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      // status: fragment's rec.status is a string per variant -> n.status = { [variant]: status }
      const n = nodes.get(rec.id) ?? { ...rec, shots: {}, components: [], errors: [], status: {} };
      n.shots[theme] = rec.img;
      if (rec.status) n.status[theme] = rec.status;
      n.errors = [...new Set([...n.errors, ...(rec.errors ?? [])])];
      if (!n.text && rec.text) n.text = rec.text;
      if (rec.tags) n.tags = [...new Set([...(n.tags ?? []), ...rec.tags])];
      for (const c of rec.components ?? []) {
        let nc = n.components.find(x => x.id === c.id);
        if (!nc) n.components.push(nc = { id: c.id, label: c.label, selector: c.selector, shots: {}, status: {} });
        nc.shots[theme] = c.img;
        if (c.status) nc.status[theme] = c.status;
      }
      delete n.img; delete n.theme;
      nodes.set(rec.id, n);
    }
  }
}
if (!nodes.size) { console.error('No fragments in shots/nodes — run the capture first (script\\run.bat atlas / npm run atlas).'); process.exit(1); }

for (const n of nodes.values())   // e.g. a node hanging off a collection item whose label (and so id) changed
  if (n.parent && !nodes.has(n.parent)) console.warn(`  warning: "${n.id}" has parent "${n.parent}", which was not captured: shown under the root`);

/* ---------- PNG -> WebP (thumb + full) via headless Chromium canvas ---------- */
const jobs = [];   // { theme, file, set }
for (const n of nodes.values())
  for (const owner of [n, ...n.components])
    for (const [theme, file] of Object.entries(owner.shots)) jobs.push({ theme, file, owner });
// latest capture (review/actual, git-ignored) wins over the approved golden
const shotFile = (theme, file) => ['review/actual', 'goldens']
  .map(dir => path.join(ROOT, dir, theme, file)).find(p => fs.existsSync(p)) ?? null;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const cache = new Map();
let missing = 0;
for (let i = 0; i < jobs.length; i += 24) {
  const batch = jobs.slice(i, i + 24).map(j => {
    const p = shotFile(j.theme, j.file);
    if (!p) { missing++; return null; }
    return { key: `${j.theme}/${j.file}`, src: 'data:image/png;base64,' + fs.readFileSync(p).toString('base64') };
  }).filter(b => b && !cache.has(b.key));
  const out = await page.evaluate(async ({ batch, THUMB_W, FULL_W, Q }) => {
    const enc = (img, w) => {
      const s = Math.min(1, w / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/webp', Q);
    };
    return Promise.all(batch.map(b => new Promise(res => {
      const img = new Image();
      img.onload = () => res({ key: b.key, w: img.naturalWidth, h: img.naturalHeight, thumb: enc(img, THUMB_W), full: enc(img, FULL_W) });
      img.onerror = () => res({ key: b.key, error: true });
      img.src = b.src;
    })));
  }, { batch, THUMB_W, FULL_W, Q });
  for (const o of out) if (!o.error) cache.set(o.key, o);
  process.stdout.write(`\r  images ${Math.min(i + 24, jobs.length)}/${jobs.length}`);
}
// brand icon for the favicon / header, shrunk and inlined like the screenshots
const iconPath = path.join(ROOT, 'assets', 'icon_transparent.png');
const icon = fs.existsSync(iconPath) ? await page.evaluate(src => new Promise(res => {
  const img = new Image();
  img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 64;
    c.getContext('2d').drawImage(img, 0, 0, 64, 64); res(c.toDataURL('image/webp', .9)); };
  img.onerror = () => res('');
  img.src = src;
}), 'data:image/png;base64,' + fs.readFileSync(iconPath).toString('base64')) : '';
await browser.close();
console.log(missing ? `\n  ${missing} golden(s) missing` : '');

/* ---------- emit ---------- */
const images = {};   // dedup store: key -> {thumb, full, w, h}
for (const j of jobs) {
  const k = `${j.theme}/${j.file}`, im = cache.get(k);
  if (im) images[k] = { thumb: im.thumb, full: im.full, w: im.w, h: im.h };
  j.owner.shots[j.theme] = im ? k : null;
}
const data = {
  generated: new Date().toISOString(),
  ...meta,
  nodes: [...nodes.values()].map(n => ({ ...n, tags: [...new Set(n.tags ?? [])] })),
  images,
};

// libs read by file path (package "exports" maps hide dist files from require.resolve)
const lib = rel => fs.readFileSync(path.join(ROOT, 'node_modules', rel), 'utf8');
// fuse.js v7 ships CommonJS only -> run it against a local module object, expose window.Fuse
const cjs = (rel, global) =>
  `(function(){var module={exports:{}},exports=module.exports;\n${lib(rel)}\n;window.${global}=module.exports.default||module.exports;})();`;
const libs = [
  lib('cytoscape/dist/cytoscape.min.js'),
  lib('dagre/dist/dagre.min.js'),
  lib('cytoscape-dagre/dist/cytoscape-dagre.js'),
  cjs('fuse.js/dist/fuse.min.cjs', 'Fuse'),
].join('\n;\n').replace(/<\/script/gi, '<\\/script');

const json = JSON.stringify(data).replace(/</g, '\\u003c');
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// tooltip.js is inlined (not linked) so dashboard.html stays one offline file
const tooltipSource = fs.readFileSync(path.join(HERE, 'tooltip.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync(path.join(HERE, 'template.html'), 'utf8')
  .replaceAll('__TITLE__', () => escHtml(meta.title ?? 'Golden Map Atlas'))
  .replaceAll('__ICON__', () => icon)
  .replaceAll('__PANEL_URL__', () => escHtml(process.env.ATLAS_PANEL_URL ?? 'http://127.0.0.1:8099/'))
  .replaceAll('__TOOLTIP__', () => tooltipSource)
  .replace('/*__LIBS__*/', () => libs)
  .replace('__DATA__', () => json);
fs.writeFileSync(OUT_FILE, html);
console.log(`${path.relative(ROOT, OUT_FILE)}: ${data.nodes.length} nodes, ${Object.keys(images).length} images, ${(html.length / 1048576).toFixed(1)} MB`);
