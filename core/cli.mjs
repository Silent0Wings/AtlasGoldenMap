#!/usr/bin/env node
/**
 * cli.mjs — Golden Map Atlas command line. The setup / deps / config / run wrappers in script/ call this.
 *
 *   node core/cli.mjs setup                 deps + scaffold atlas.config.ts if missing
 *   node core/cli.mjs deps                  npm install + Playwright Chromium
 *   node core/cli.mjs config [--force]      interactive atlas.config.ts generator
 *   node core/cli.mjs config --answers <json> [--force]
 *                                           the same file from a JSON object of answers, no prompts
 *   node core/cli.mjs init --url <url> ...  non-interactive scaffold for an app (--crawl also crawls)
 *   node core/cli.mjs run [mode] [-- args]  atlas | capture | check | review | approve-new | approve-all
 *                                           | stabilize | discover | build | crawl | open | report | init | clean
 *                                           (no mode: interactive menu; args after -- go to Playwright)
 *
 * Shots are captured into review/ and never become goldens on their own: a person approves them in
 * the review UI (review), or in bulk with approve-new / approve-all. The first capture (no goldens yet)
 * runs stabilize too, so unstable shots are known before anything is approved.
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
// --name value or --name=value; dflt when absent
const opt = (name, dflt) => {
  const eq = args.find(a => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};

function openFile(f) {
  const cmd = process.platform === 'win32' ? `start "" "${f}"` : process.platform === 'darwin' ? `open "${f}"` : `xdg-open "${f}"`;
  sh(cmd, { stdio: 'ignore' });
}

// store.mjs, init.mjs and stabilize.mjs import npm packages: load them only when a mode needs them,
// so deps / setup / config / init work before node_modules exists
const store = () => import(pathToFileURL(path.join(ROOT, 'core', 'store.mjs')).href);
const mod = name => import(pathToFileURL(path.join(ROOT, 'core', name)).href);

/* ---------------------------------------------------------------- deps */

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) fail(`Node ${process.versions.node} is too old: install Node 18+ from https://nodejs.org`);
}

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

// goldens exist? store.mjs needs node_modules, so fall back to the folder when it cannot load
async function hasGoldens() {
  try { return (await store()).listGoldens().length > 0; }
  catch { return fs.existsSync(path.join(ROOT, 'goldens')); }
}

// the prompts' defaults. The answers of `config --answers <json>` use the same field names.
const DEFAULTS = {
  title: path.basename(path.resolve(ROOT, '..')), kind: 'd', command: 'npm run dev', cwd: '..', staticDir: '../dist',
  port: '8091', baseURL: '', start: '/', themeKey: '', dark: true, mobile: false, crawl: true,
};

// an empty or missing answer takes the default, as an empty answer at a prompt does
function withDefaults(given) {
  const a = { ...DEFAULTS };
  for (const [k, v] of Object.entries(given)) if (v !== undefined && v !== '') a[k] = v;
  if (!a.baseURL) a.baseURL = a.kind === 'r' ? 'http://localhost:3000' : 'http://localhost:5173';
  return a;
}

// kind: d = dev server command, s = static folder, r = already running
async function writeConfig(given) {
  const a = withDefaults(given);
  const dir = a.staticDir.replace(/\\/g, '/');
  const cwd = a.cwd.replace(/\\/g, '/');
  let server = '', baseURL = a.baseURL;
  if (a.kind === 's') {
    baseURL = `http://127.0.0.1:${a.port}`;
    server = `server: { staticDir: ${JSON.stringify(dir)} },`;
  } else if (a.kind === 'd') {
    server = `server: { command: ${JSON.stringify(a.command)}, cwd: ${JSON.stringify(cwd)} },`;
  }

  const themeKey = a.dark ? a.themeKey : '';
  const theme = v => themeKey ? `, localStorage: { ${JSON.stringify(themeKey)}: '${v}' }` : '';
  const variants = [`    { name: 'light', label: 'Light', colorScheme: 'light'${theme('light')} },`];
  if (a.dark) variants.push(`    { name: 'dark', label: 'Dark', colorScheme: 'dark'${theme('dark')} },`);
  if (a.mobile) variants.push(`    { name: 'mobile', label: 'Mobile', colorScheme: 'light', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true${theme('light')} },`);

  const { renderConfig } = await mod('init.mjs');
  const src = renderConfig({ title: a.title, baseURL, server, start: a.start, variants, crawl: a.crawl });
  if (fs.existsSync(CONFIG)) {
    const bak = path.join(ROOT, `atlas.config.backup-${Date.now()}.ts`);
    fs.copyFileSync(CONFIG, bak);
    log(`  Backed up the old config to ${path.basename(bak)}`);
  }
  fs.writeFileSync(CONFIG, src);
  log(`\n[OK] Wrote atlas.config.ts. Next: add nodes to it, then run the atlas${a.crawl ? ' (run crawl first to discover pages)' : ''}.`);
  if (await hasGoldens()) log('[!] goldens/ already has approved shots. If the app or this config changed what they show, run "run clean --goldens" and capture again.');
}

// the questions, in the order the generator always asked them. Returns the answers.
async function askAnswers(ask, yes) {
  const a = { title: await ask('App name', DEFAULTS.title) };
  const kind = (await ask('How is the app served? (d)ev server command / (s)tatic folder / (r)unning already', 'd')).toLowerCase()[0];
  a.kind = kind === 's' || kind === 'r' ? kind : 'd';
  if (a.kind === 's') {
    a.staticDir = await ask('Static folder (relative to this folder)', DEFAULTS.staticDir);
    a.port = await ask('Port', DEFAULTS.port);
  } else if (a.kind === 'r') {
    a.baseURL = await ask('App URL', 'http://localhost:3000');
  } else {
    a.command = await ask('Dev server command', DEFAULTS.command);
    a.cwd = await ask('Run it in (relative to this folder)', DEFAULTS.cwd);
    a.baseURL = await ask('URL it serves', 'http://localhost:5173');
  }
  a.start = await ask('Start page path', DEFAULTS.start);
  a.dark = await yes('Does the app have a dark mode (prefers-color-scheme or a setting)?');
  a.themeKey = a.dark ? await ask('localStorage key that stores the theme (empty if it follows the OS)', '') : '';
  a.mobile = await yes('Also capture a mobile viewport?', false);
  a.crawl = await yes('Auto-discover pages by following links (crawler)?');
  return a;
}

async function config({ force = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q, d = '') => ((await rl.question(d ? `  ${q} [${d}]: ` : `  ${q}: `)).trim() || d);
  const yes = async (q, d = true) => /^y/i.test(await ask(`${q} (y/n)`, d ? 'y' : 'n'));
  try {
    if (fs.existsSync(CONFIG) && !force) {
      if (!(await yes('atlas.config.ts already exists. Replace it (a backup is kept)?', false))) { log('Kept the existing config.'); return; }
    }
    log('\n  Golden Map Atlas config generator: answer a few questions, edit the file afterwards.\n');
    await writeConfig(await askAnswers(ask, yes));
  } finally { rl.close(); }
}

const ANSWER_TYPES = {
  title: 'string', kind: 'string', command: 'string', cwd: 'string', staticDir: 'string', port: 'string',
  baseURL: 'string', start: 'string', themeKey: 'string', dark: 'boolean', mobile: 'boolean', crawl: 'boolean',
};

// the JSON after --answers (or --answers=<json>); null when the flag is absent
function answersArg() {
  const eq = args.find(a => a.startsWith('--answers='));
  if (eq) return eq.slice('--answers='.length);
  const i = args.indexOf('--answers');
  if (i < 0) return null;
  if (args[i + 1] === undefined || args[i + 1].startsWith('--')) fail('--answers needs the JSON object after it.');
  return args[i + 1];
}

// refuses unknown fields, wrong types and multi-line values before anything is written
function checkAnswers(given) {
  if (!given || typeof given !== 'object' || Array.isArray(given)) fail('--answers must be a JSON object.');
  for (const [k, v] of Object.entries(given)) {
    if (!Object.hasOwn(ANSWER_TYPES, k)) fail(`--answers: unknown field "${k}".`);
    if (typeof v !== ANSWER_TYPES[k]) fail(`--answers: ${k} must be a ${ANSWER_TYPES[k]}.`);
    if (typeof v === 'string' && (v.length > 500 || /[\r\n]/.test(v))) fail(`--answers: ${k} must be one line, at most 500 characters.`);
  }
  const a = withDefaults(given);
  if (!['d', 's', 'r'].includes(a.kind)) fail('--answers: kind must be "d" (dev server), "s" (static folder) or "r" (already running).');
  if (a.kind === 's' && !(/^\d{1,5}$/.test(a.port) && Number(a.port) >= 1 && Number(a.port) <= 65535)) fail('--answers: port must be a number from 1 to 65535.');
}

// config --answers <json>: the same file without prompts. Does not replace an existing config without --force.
async function configFromAnswers(json, force) {
  if (fs.existsSync(CONFIG) && !force) fail('atlas.config.ts already exists. Pass --force to replace it (a backup is kept).');
  let given;
  try { given = JSON.parse(json); }
  catch (e) { fail(`--answers is not valid JSON: ${e.message}`); }
  checkAnswers(given);
  await writeConfig(given);
}

// non-interactive atlas.config.ts scaffold (init.mjs). --crawl also crawls straight after.
async function initCmd(argv) {
  try {
    const { runInit } = await mod('init.mjs');
    const { crawl: doCrawl } = await runInit(argv, { root: ROOT, log });
    if (doCrawl) { deps(); crawl(); }
  } catch (e) { fail(e.message); }
}

/* ---------------------------------------------------------------- run */

const MODES = {
  atlas: 'Capture (no golden writes) + build + open the dashboard',
  capture: 'Capture into review/ and count new / changed shots',
  check: 'Capture, then exit 1 unless every shot matches its golden',
  review: 'Open the review UI to approve or deny shots (Ctrl+C stops)',
  'approve-new': 'Approve every new shot as a golden (bootstrap)',
  'approve-all': 'Approve every new or changed shot (asks first; --yes skips)',
  stabilize: 'Capture N extra times (--runs, default 3) and list shots that differ between runs',
  build: 'Rebuild dashboard.html from existing screenshots + open',
  crawl: 'Discover pages by following links (writes atlas.crawl.json)',
  discover: 'List tabs, nav links and buttons not yet in the atlas (writes atlas.discovered.txt)',
  open: 'Open the last built dashboard.html',
  report: 'Open the last Playwright report',
  init: 'Scaffold atlas.config.ts for an app, no questions (init --url <url> ...)',
  clean: 'Delete review/, shots, reports and the dashboard (--goldens also deletes goldens)',
};

// modes that capture or build: they need Chromium and an atlas.config.ts
const NEEDS_BROWSER = ['atlas', 'capture', 'check', 'build', 'crawl', 'stabilize', 'discover'];

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

// Takes the capture lock and keeps it until this process exits. Exits when another capture holds it.
async function acquireLock() {
  const s = await store();
  const lock = path.join(s.ROOT, 'review', '.capture.lock');
  const startedAt = new Date().toISOString();
  const held = takeLock(lock, startedAt);
  if (held) fail(`a capture is already running (pid ${held.pid}, started ${held.startedAt}). Wait for it to finish, or delete ${lock} if that process is gone.`);
  process.on('exit', () => releaseLock(lock));
  process.on('SIGINT', () => process.exit(130));
  return s;
}

// One Playwright run under the capture lock. Playwright exits non-zero when shots changed: that is the
// review queue, not a crash. Returns what the run produced.
async function runCapture() {
  const s = await acquireLock();
  const start = Date.now();
  // fragments of removed nodes would linger in the atlas: start from a clean slate,
  // unless Playwright args (-g, --project…) limit the run to a subset
  if (!passthrough.length) {
    fs.rmSync(path.join(ROOT, 'shots', 'nodes'), { recursive: true, force: true });
    s.cleanActual();
    fs.rmSync(s.DIRS.stabilize, { force: true });   // that report described the previous capture
  }
  const pwFailed = pw('test', ...passthrough) !== 0;
  // a subset run leaves the records of earlier runs in place: only count what this run captured
  const records = s.listRecords().filter(r => !passthrough.length || Date.parse(r.capturedAt) >= start);
  return { pwFailed, records };
}

// stabilize.mjs: runs the atlas N more times under a scratch root and lists the shots that differ.
// Takes no lock itself: the caller holds the capture lock.
async function runStabilize({ runs = 2, keep = false, all = false } = {}) {
  const { stabilize } = await mod('stabilize.mjs');
  return stabilize({ root: ROOT, runs, passthrough, keep, all, log });
}

async function capture() {
  // the first capture (no goldens yet, full run, not opted out) is followed by stabilize
  const bootstrap = !passthrough.length && !args.includes('--no-stabilize') && (await store()).listGoldens().length === 0;
  log('\n[*] Capturing every node in every variant (nothing becomes a golden until approved)...');
  const { pwFailed, records } = await runCapture();
  const count = s => records.filter(r => r.status === s).length;
  log(`\n[OK] ${records.length} shots captured: ${count('new')} new, ${count('changed')} changed — run review`);
  if (pwFailed) log('    (Some tests reported differences or failures: they are listed in the review queue.)');
  await summary(records);
  if (bootstrap) {
    log('\n[*] No goldens yet: running stabilize (2 more runs) to find shots that never settle...');
    await runStabilize({ runs: 2 });
  }
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

const bboxText = b => (b ? `(${b.x1},${b.y1})-(${b.x2},${b.y2})` : '-');
const pct = r => (r.diffRatio == null ? '-' : `${(r.diffRatio * 100).toFixed(2)}%`);

// after a run: one line per kind of problem (non-zero only), then every failure, flaky test and warning.
// Returns the run summary (or {}) for the caller.
async function summary(records) {
  const sum = (await store()).readRunSummary() ?? {};
  const n = st => records.filter(r => r.status === st).length;
  const rows = [];
  const line = (label, count, text) => { if (count) rows.push(`${label.padEnd(11)}${count}  ${text}`); };
  line('VISUAL', n('changed'), 'changed (needs review)');
  line('STALE', n('stale'), 'golden predates a config change: re-capture and approve');
  line('UNSETTLED', n('unsettled'), 'never stopped changing: run stabilize');
  for (const f of sum.failures ?? []) {
    if (f.class !== 'visual') line(f.class === 'infra' ? 'INFRA' : 'ERROR', 1, `${f.message} (retried ${f.retries}x, still failing) [${f.variant}] ${f.id}`);
  }
  for (const f of sum.flaky ?? []) line('FLAKY', 1, `[${f.variant}] ${f.id} passed on retry (retried ${f.retries}x)`);
  for (const w of sum.warnings ?? []) line('WARN', 1, `[${w.variant}] ${w.id}: ${w.message}`);
  if (rows.length) { log(''); rows.forEach(r => log(r)); }
  return sum;
}

// why approve-* must not run: a run with non-visual failures, unsettled shots (approve-all) or
// unstable shots (approve-new, from stabilize). --force overrides; --yes does not.
function blockers(s, { unsettled = false } = {}) {
  const why = [];
  const broken = (s.readRunSummary()?.failures ?? []).filter(f => f.class !== 'visual');
  if (broken.length) why.push(`${broken.length} test(s) failed without a visual diff (${[...new Set(broken.map(f => f.class))].join(', ')}): fix them and capture again`);
  if (unsettled) {
    const n = s.listRecords().filter(r => r.status === 'unsettled').length;
    if (n) why.push(`${n} shot(s) never settled: run stabilize first`);
  }
  return why;
}

// prints the refusal (or the --force override); true when approval may go ahead
function gate(why) {
  if (!why.length) return true;
  if (args.includes('--force')) { why.forEach(w => log(`[!] --force: ${w}`)); return true; }
  why.forEach(w => console.error(`[x] ${w}`));
  console.error('[x] Refused: nothing was approved. Pass --force to approve anyway.');
  process.exitCode = 1;
  return false;
}

// goldens with no record in the last run: removed or renamed in the app, or not captured by a partial run
function orphans(s) {
  const seen = new Set(s.listRecords().map(r => r.key));
  const gone = s.listGoldens().filter(k => !seen.has(k));
  if (!gone.length) return;
  log(`[!] ${gone.length} golden(s) were not captured by the last run (removed from the app, or a partial run):`);
  gone.forEach(k => log(`    ${k}`));
}

async function stabilizeMode() {
  await acquireLock();
  const runs = Number(opt('--runs', 3));
  if (!Number.isInteger(runs) || runs < 2) fail('--runs needs a whole number, 2 or more.');
  const report = await runStabilize({ runs, keep: args.includes('--keep'), all: args.includes('--all') });
  if (report.unstable > 0) process.exitCode = 1;
}

// discover pages by following links: writes atlas.crawl.json
function crawl() {
  fs.rmSync(path.join(ROOT, 'atlas.crawl.json'), { force: true });
  if (sh(['npx', 'playwright', 'test', ...passthrough].map(quote).join(' '), { env: { ...process.env, ATLAS_CRAWL: '1' } })) fail('crawl failed');
  if (!fs.existsSync(path.join(ROOT, 'atlas.crawl.json'))) fail('Nothing crawled: add a `crawl` section to atlas.config.ts.');
  log('[OK] Crawled pages are added as nodes on the next capture.');
}

// interactive candidates for new nodes: writes atlas.discovered.txt (commented out, copy what you need)
function discover() {
  const out = path.join(ROOT, 'atlas.discovered.txt');
  fs.rmSync(out, { force: true });
  if (sh(['npx', 'playwright', 'test', ...passthrough].map(quote).join(' '), { env: { ...process.env, ATLAS_DISCOVER: '1' } })) fail('discover failed');
  if (!fs.existsSync(out)) fail('Nothing discovered: the start page has no tabs, nav links, data-* buttons or # links.');
  log(`[OK] Candidates are in ${out}: copy the ones you need into atlas.config.ts.`);
}

async function run(mode) {
  if (!mode) mode = await menu();
  if (!mode) return;
  if (!MODES[mode]) fail(`Unknown mode "${mode}". Use: ${Object.keys(MODES).join(' | ')}`);
  if (NEEDS_BROWSER.includes(mode)) {
    deps();   // build needs Chromium too: it converts PNG -> WebP
    if (!fs.existsSync(CONFIG)) fail('No atlas.config.ts: run config first.');
  } else if (!['open', 'report', 'clean', 'init'].includes(mode)) {
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
      const sum = await summary(records);
      const failures = sum.failures ?? [];
      const bad = records.filter(isOpen);
      const markup = records.filter(r => r.htmlChanged);
      if (markup.length) {
        log(`\n[i] Markup changed (informational, not a failure):`);
        markup.forEach(r => log(`    markup changed${r.status === 'match' ? ', pixels identical' : ' (pixels changed too)'}: ${r.key}`));
      }
      if (bad.length || pwFailed || failures.length) {
        if (bad.length) {
          log('');
          table(bad.map(r => [r.key, r.status, (r.reasons ?? []).join(',') || '-', r.diffPixels ?? '-', pct(r), bboxText(r.bbox), r.threshold ?? '-', r.decision]),
            ['key', 'status', 'reasons', 'diff px', 'diff %', 'bbox', 'threshold', 'decision']);
          log(`\n[!] ${bad.length} shot(s) differ from their goldens. Run "review" to look at them, then approve or deny.`);
        } else log('\n[!] Check failed: see the summary above.');
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
      const s = await store();
      const why = blockers(s);
      const st = s.readStabilize();
      if (st?.unstable > 0) why.push(`stabilize found ${st.unstable} unstable shot(s): fix them, or capture and stabilize again`);
      if (!gate(why)) break;
      orphans(s);
      const n = s.approveWhere(r => r.status === 'new');
      log(`[OK] Approved ${n} new shot(s) as goldens.`);
      break;
    }
    case 'approve-all': {
      const s = await store();
      const open = s.listRecords().filter(isOpen);
      if (!open.length) { log('[OK] Nothing to approve: every shot matches its golden.'); break; }
      if (!gate(blockers(s, { unsettled: true }))) break;
      table(open.map(r => [r.key, r.status]), ['key', 'status']);
      orphans(s);
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
    case 'stabilize': await stabilizeMode(); break;
    case 'crawl': crawl(); break;
    case 'discover': discover(); break;
    case 'init': await initCmd(args.slice(1)); break;
    case 'open':
      if (!fs.existsSync(dash)) fail('dashboard.html not built yet: run "atlas" first.');
      openFile(dash); break;
    case 'report': {
      const rep = path.join(ROOT, 'report', 'index.html');
      if (!fs.existsSync(rep)) fail('No report yet: run "check" or "atlas" first.');
      openFile(rep); break;
    }
    case 'clean': {
      const targets = ['review', 'shots', 'report', 'test-results', 'dashboard.html', 'atlas.crawl.json', 'atlas.discovered.txt', '.stabilize'];
      if (args.includes('--goldens')) targets.push('goldens');   // approved goldens are the project's truth: explicit only
      for (const d of targets) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
      log(`[OK] Cleaned${args.includes('--goldens') ? ' (goldens included)' : ' (goldens kept)'}.`); break;
    }
  }
}

/* ---------------------------------------------------------------- main */

switch (cmd) {
  case 'deps': deps(); log('[OK] Dependencies ready.'); break;
  case 'config': {
    const json = answersArg();
    if (json !== null) await configFromAnswers(json, args.includes('--force'));
    else await config({ force: args.includes('--force') });
    break;
  }
  case 'init': await initCmd(args); break;
  case 'setup':
    deps();
    if (!fs.existsSync(CONFIG)) await config();
    log('\n[OK] Setup done. Next: script\\run.bat (Windows) or ./script/run.sh, then choose "atlas".');
    break;
  case 'run': await run(args[0]); break;
  default:
    log('Usage: node core/cli.mjs <setup | deps | config [--force | --answers <json> [--force]] | init --url <url> [...] | run [mode] [--yes | --goldens | --force | --runs N | --keep | --all | --no-stabilize] [-- playwright args]>');
    log(`Modes: ${Object.keys(MODES).join(' | ')}`);
    for (const k of Object.keys(MODES)) log(`  ${k.padEnd(12)} ${MODES[k]}`);
    process.exitCode = cmd ? 1 : 0;
}
