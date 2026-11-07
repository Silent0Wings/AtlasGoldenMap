#!/usr/bin/env node
/**
 * cli.mjs — Golden Map Atlas command line. The setup / deps / config / run wrappers in script/ call this.
 *
 *   node core/cli.mjs setup                 deps + scaffold atlas.config.ts if missing
 *   node core/cli.mjs deps                  npm install + Playwright Chromium
 *   node core/cli.mjs config [--force]      interactive atlas.config.ts generator
 *   node core/cli.mjs run [mode] [-- args]  atlas | capture | check | review | approve-new | approve-all
 *                                           | build | crawl | open | report | clean [--goldens]
 *                                           (no mode: interactive menu; args after -- go to Playwright)
 *
 * Shots are captured into review/ and never become goldens on their own: a person approves them in
 * the review UI (review), or in bulk with approve-new / approve-all.
 */
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import readline from 'readline/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'atlas.config.ts');
const [cmd, ...rest] = process.argv.slice(2);
const dd = rest.indexOf('--');
const args = dd >= 0 ? rest.slice(0, dd) : rest;
const passthrough = dd >= 0 ? rest.slice(dd + 1) : [];

const log = (s = '') => console.log(s);
const fail = s => { console.error(`[x] ${s}`); process.exit(1); };
const sh = (command, opts = {}) => spawnSync(command, { cwd: ROOT, stdio: 'inherit', shell: true, ...opts }).status ?? 1;
const quote = a => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const pw = (...a) => sh(['npx', 'playwright', ...a].map(quote).join(' '));

function openFile(f) {
  const cmd = process.platform === 'win32' ? `start "" "${f}"` : process.platform === 'darwin' ? `open "${f}"` : `xdg-open "${f}"`;
  sh(cmd, { stdio: 'ignore' });
}

/* ---------------------------------------------------------------- deps */

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) fail(`Node ${process.versions.node} is too old: install Node 18+ from https://nodejs.org`);
}

const store = () => import(pathToFileURL(path.join(ROOT, 'core', 'store.mjs')).href);

function deps({ browser = true } = {}) {
  checkNode();
  if (!fs.existsSync(path.join(ROOT, 'node_modules', '@playwright', 'test'))) {
    log('[*] Installing npm packages...');
    if (sh('npm install')) fail('npm install failed');
  }
  if (browser) {
    log('[*] Ensuring Playwright Chromium is installed...');
    if (pw('install', 'chromium')) fail('playwright install chromium failed');
  }
}

/* ---------------------------------------------------------------- config */

async function config({ force = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q, d = '') => ((await rl.question(d ? `  ${q} [${d}]: ` : `  ${q}: `)).trim() || d);
  const yes = async (q, d = true) => /^y/i.test(await ask(`${q} (y/n)`, d ? 'y' : 'n'));
  try {
    if (fs.existsSync(CONFIG) && !force) {
      if (!(await yes('atlas.config.ts already exists. Replace it (a backup is kept)?', false))) { log('Kept the existing config.'); return; }
    }
    log('\n  Golden Map Atlas config generator: answer a few questions, edit the file afterwards.\n');
    const title = await ask('App name', path.basename(path.resolve(ROOT, '..')));
    const kind = (await ask('How is the app served? (d)ev server command / (s)tatic folder / (r)unning already', 'd')).toLowerCase()[0];
    let server = '', baseURL;
    if (kind === 's') {
      const dir = (await ask('Static folder (relative to this folder)', '../dist')).replace(/\\/g, '/');
      const port = await ask('Port', '8091');
      baseURL = `http://127.0.0.1:${port}`;
      server = `server: { staticDir: ${JSON.stringify(dir)} },`;
    } else if (kind === 'r') {
      baseURL = await ask('App URL', 'http://localhost:3000');
    } else {
      const command = await ask('Dev server command', 'npm run dev');
      const cwd = (await ask('Run it in (relative to this folder)', '..')).replace(/\\/g, '/');
      baseURL = await ask('URL it serves', 'http://localhost:5173');
      server = `server: { command: ${JSON.stringify(command)}, cwd: ${JSON.stringify(cwd)} },`;
    }
    const start = await ask('Start page path', '/');
    const dark = await yes('Does the app have a dark mode (prefers-color-scheme or a setting)?');
    let themeKey = '';
    if (dark) themeKey = await ask('localStorage key that stores the theme (empty if it follows the OS)', '');
    const mobile = await yes('Also capture a mobile viewport?', false);
    const crawl = await yes('Auto-discover pages by following links (crawler)?');

    const theme = v => themeKey ? `, localStorage: { ${JSON.stringify(themeKey)}: '${v}' }` : '';
    const variants = [`    { name: 'light', label: 'Light', colorScheme: 'light'${theme('light')} },`];
    if (dark) variants.push(`    { name: 'dark', label: 'Dark', colorScheme: 'dark'${theme('dark')} },`);
    if (mobile) variants.push(`    { name: 'mobile', label: 'Mobile', colorScheme: 'light', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true${theme('light')} },`);

    const src = `/**
 * atlas.config.ts — the ONLY project-specific file for Golden Map Atlas (generated by \`config\`).
 * Add a node per page / modal / tab you want in the atlas. See README.md → "Config reference".
 */
import { defineAtlas, click, fill, seq, type UINode } from './core/atlas';

const nodes: UINode[] = [
  { id: 'home', label: 'Home', kind: 'page', url: ${JSON.stringify(start)}, ready: 'body',
    components: [
      // { name: 'header', label: 'Header', selector: 'header' },
    ] },
  // A state reached by interacting with its parent:
  // { id: 'home:menu', label: 'Menu open', kind: 'state', parent: 'home', steps: click('[data-testid=menu]'), ready: '[role=menu]' },
];

export default defineAtlas({
  title: ${JSON.stringify(title)},
  baseURL: ${JSON.stringify(baseURL)},
  ${server || '// server: { command: \'npm run dev\', cwd: \'..\' },   // app is expected to be running already'}

  variants: [
${variants.join('\n')}
  ],

  nodes,
  root: 'home',
  fixtures: {
    // 'signed-in': { localStorage: { token: 'test' } },   // nodes opt in with fixture: 'signed-in'
  },
  mask: [
    // '[data-testid=clock]',   // dynamic regions: clocks, avatars, counters
  ],
${crawl ? `  crawl: { start: [${JSON.stringify(start)}], maxPages: 100 },\n` : ''}});
`;
    if (fs.existsSync(CONFIG)) {
      const bak = path.join(ROOT, `atlas.config.backup-${Date.now()}.ts`);
      fs.copyFileSync(CONFIG, bak);
      log(`  Backed up the old config to ${path.basename(bak)}`);
    }
    fs.writeFileSync(CONFIG, src);
    log(`\n[OK] Wrote atlas.config.ts. Next: add nodes to it, then run the atlas${crawl ? ' (run crawl first to discover pages)' : ''}.`);
  } finally { rl.close(); }
}

/* ---------------------------------------------------------------- run */

const MODES = {
  atlas: 'Capture (no golden writes) + build + open the dashboard',
  capture: 'Capture into review/ and count new / changed shots',
  check: 'Capture, then exit 1 unless every shot matches its golden',
  review: 'Open the review UI to approve or deny shots (Ctrl+C stops)',
  'approve-new': 'Approve every new shot as a golden (bootstrap)',
  'approve-all': 'Approve every new or changed shot (asks first; --yes skips)',
  build: 'Rebuild dashboard.html from existing screenshots + open',
  crawl: 'Discover pages by following links (writes atlas.crawl.json)',
  open: 'Open the last built dashboard.html',
  report: 'Open the last Playwright report',
  clean: 'Delete review/, shots, reports and the dashboard (--goldens also deletes goldens)',
};

// modes that capture or build: they need Chromium and an atlas.config.ts
const NEEDS_BROWSER = ['atlas', 'capture', 'check', 'build', 'crawl'];

async function menu() {
  const keys = Object.keys(MODES);
  log('\n  ===============  Golden Map Atlas  ===============\n');
  keys.forEach((k, i) => log(`    ${i + 1}. ${k.padEnd(8)} ${MODES[k]}`));
  log('    Q. Quit\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`  Choose [1-${keys.length}, Q]: `)).trim();
  rl.close();
  return keys[Number(a) - 1] ?? (keys.includes(a) ? a : null);
}

function build(mode) {
  const r = sh(['node', 'core/build-dashboard.mjs', ...args.slice(1), ...(mode === 'build' ? passthrough : [])].map(quote).join(' '));
  if (r) fail('dashboard build failed');
}

/* ---------------------------------------------------------------- capture lock */

// review/.capture.lock holds {pid, startedAt} while a capture runs (from here or from the review server).
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

// One Playwright run under the capture lock. Playwright exits non-zero when shots changed: that is the
// review queue, not a crash. Returns what the run produced.
async function runCapture() {
  const s = await store();
  const lock = path.join(s.ROOT, 'review', '.capture.lock');
  const startedAt = new Date().toISOString();
  const held = takeLock(lock, startedAt);
  if (held) fail(`a capture is already running (pid ${held.pid}, started ${held.startedAt}). Wait for it to finish, or delete ${lock} if that process is gone.`);
  process.on('exit', () => releaseLock(lock));
  process.on('SIGINT', () => process.exit(130));
  const start = Date.now();
  // fragments of removed nodes would linger in the atlas: start from a clean slate,
  // unless Playwright args (-g, --project…) limit the run to a subset
  if (!passthrough.length) {
    fs.rmSync(path.join(ROOT, 'shots', 'nodes'), { recursive: true, force: true });
    s.cleanActual();
  }
  const pwFailed = pw('test', ...passthrough) !== 0;
  // a subset run leaves the records of earlier runs in place: only count what this run captured
  const records = s.listRecords().filter(r => !passthrough.length || Date.parse(r.capturedAt) >= start);
  return { pwFailed, records };
}

async function capture() {
  log('\n[*] Capturing every node in every variant (nothing becomes a golden until approved)...');
  const { pwFailed, records } = await runCapture();
  const count = s => records.filter(r => r.status === s).length;
  log(`\n[OK] ${records.length} shots captured: ${count('new')} new, ${count('changed')} changed — run review`);
  if (pwFailed) log('    (Some tests reported differences or failures: they are listed in the review queue.)');
  return records;
}

// the records that are not match/volatile: the ones a person has to look at
const isOpen = r => r.status !== 'match' && r.status !== 'volatile';

function table(rows, headers) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
  const line = cells => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  log(line(headers));
  log(widths.map(w => '-'.repeat(w)).join('  '));
  rows.forEach(r => log(line(r)));
}

async function run(mode) {
  if (!mode) mode = await menu();
  if (!mode) return;
  if (!MODES[mode]) fail(`Unknown mode "${mode}". Use: ${Object.keys(MODES).join(' | ')}`);
  if (NEEDS_BROWSER.includes(mode)) {
    deps();   // build needs Chromium too: it converts PNG -> WebP
    if (!fs.existsSync(CONFIG)) fail('No atlas.config.ts: run config first.');
  } else if (!['open', 'report', 'clean'].includes(mode)) {
    deps({ browser: false });   // review and approve import store.mjs (pixelmatch, pngjs)
  }
  const dash = path.join(ROOT, 'dashboard.html');
  switch (mode) {
    case 'atlas': await capture(); build(mode); openFile(dash); break;
    case 'capture': {
      const records = await capture();
      process.exitCode = records.length ? 0 : 1;
      break;
    }
    case 'build': build(mode); openFile(dash); break;
    case 'check': {
      log('\n[*] Comparing the app against the goldens (nothing is updated)...');
      const { pwFailed, records } = await runCapture();
      const bad = records.filter(isOpen);
      if (bad.length || pwFailed) {
        log('');
        table(bad.map(r => [r.key, r.status, (r.reasons ?? []).join(',') || '-', r.decision]), ['key', 'status', 'reasons', 'decision']);
        log(`\n[!] ${bad.length} shot(s) differ from their goldens. Run "review" to look at them, then approve or deny.`);
        process.exitCode = 1;
      } else log('\n[OK] No visual drift: every shot matches its golden.');
      break;
    }
    case 'review': {
      const child = spawn(process.execPath, [path.join(ROOT, 'core', 'review-server.mjs'), '--open', ...args.slice(1)], { cwd: ROOT, stdio: 'inherit' });
      // Ctrl+C reaches the server too: keep waiting so it can stop its capture and exit cleanly
      process.on('SIGINT', () => {});
      process.exitCode = await new Promise(res => child.on('exit', code => res(code ?? 0)));
      break;
    }
    case 'approve-new': {
      const n = (await store()).approveWhere(r => r.status === 'new');
      log(`[OK] Approved ${n} new shot(s) as goldens.`);
      break;
    }
    case 'approve-all': {
      const s = await store();
      const open = s.listRecords().filter(isOpen);
      if (!open.length) { log('[OK] Nothing to approve: every shot matches its golden.'); break; }
      table(open.map(r => [r.key, r.status]), ['key', 'status']);
      if (!args.includes('--yes')) {
        if (!process.stdin.isTTY) fail('approve-all needs a terminal to confirm: pass --yes to run it non-interactively.');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const a = (await rl.question(`\n  Approve ${open.length} shot(s) as the new goldens? Type "yes" to confirm: `)).trim();
        rl.close();
        if (a !== 'yes') { log('Aborted. Nothing was approved.'); break; }
      }
      const n = s.approveWhere(isOpen);
      log(`[OK] Approved ${n} shot(s). Goldens are updated; commit goldens/ when they are intended.`);
      break;
    }
    case 'crawl': {
      fs.rmSync(path.join(ROOT, 'atlas.crawl.json'), { force: true });
      if (sh(['npx', 'playwright', 'test', ...passthrough].map(quote).join(' '), { env: { ...process.env, ATLAS_CRAWL: '1' } })) fail('crawl failed');
      if (!fs.existsSync(path.join(ROOT, 'atlas.crawl.json'))) fail('Nothing crawled: add a `crawl` section to atlas.config.ts.');
      log('[OK] Crawled pages are added as nodes on the next capture.');
      break;
    }
    case 'open':
      if (!fs.existsSync(dash)) fail('dashboard.html not built yet: run "atlas" first.');
      openFile(dash); break;
    case 'report': {
      const rep = path.join(ROOT, 'report', 'index.html');
      if (!fs.existsSync(rep)) fail('No report yet: run "check" or "atlas" first.');
      openFile(rep); break;
    }
    case 'clean': {
      const targets = ['review', 'shots', 'report', 'test-results', 'dashboard.html', 'atlas.crawl.json'];
      if (args.includes('--goldens')) targets.push('goldens');   // approved goldens are the project's truth: explicit only
      for (const d of targets) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
      log(`[OK] Cleaned${args.includes('--goldens') ? ' (goldens included)' : ' (goldens kept)'}.`); break;
    }
  }
}

/* ---------------------------------------------------------------- main */

switch (cmd) {
  case 'deps': deps(); log('[OK] Dependencies ready.'); break;
  case 'config': await config({ force: args.includes('--force') }); break;
  case 'setup':
    deps();
    if (!fs.existsSync(CONFIG)) await config();
    log('\n[OK] Setup done. Next: script\\run.bat (Windows) or ./script/run.sh, then choose "atlas".');
    break;
  case 'run': await run(args[0]); break;
  default:
    log('Usage: node core/cli.mjs <setup | deps | config | run [mode] [--yes | --goldens] [-- playwright args]>');
    log(`Modes: ${Object.keys(MODES).join(' | ')}`);
    for (const k of Object.keys(MODES)) log(`  ${k.padEnd(12)} ${MODES[k]}`);
    process.exitCode = cmd ? 1 : 0;
}
