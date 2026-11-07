#!/usr/bin/env node
/**
 * cli.mjs — Golden Map Atlas command line. The setup / deps / config / run wrappers in script/ call this.
 *
 *   node core/cli.mjs setup                 deps + scaffold atlas.config.ts if missing
 *   node core/cli.mjs deps                  npm install + Playwright Chromium
 *   node core/cli.mjs config [--force]      interactive atlas.config.ts generator
 *   node core/cli.mjs run [mode] [-- args]  atlas | capture | build | check | crawl | open | report | clean
 *                                           (no mode: interactive menu; args after -- go to Playwright)
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
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
  atlas: 'Capture + accept goldens + build + open',
  capture: 'Capture + accept goldens only',
  build: 'Rebuild dashboard.html from existing screenshots + open',
  check: 'Compare the app against the goldens (report on drift)',
  crawl: 'Discover pages by following links (writes atlas.crawl.json)',
  open: 'Open the last built dashboard.html',
  report: 'Open the last Playwright report',
  clean: 'Delete goldens, shots, reports and the dashboard',
};

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

function capture() {
  log('\n[*] Capturing every node in every variant (accepting new goldens)...');
  // fragments of removed nodes would linger in the atlas: start from a clean slate,
  // unless Playwright args (-g, --project…) limit the run to a subset
  if (!passthrough.length) fs.rmSync(path.join(ROOT, 'shots', 'nodes'), { recursive: true, force: true });
  const r = pw('test', '--update-snapshots', ...passthrough);
  if (r) log('\n[!] Some nodes failed to capture (see above). The dashboard is still built from everything that succeeded.');
  return r;
}

async function run(mode) {
  if (!mode) mode = await menu();
  if (!mode) return;
  if (!MODES[mode]) fail(`Unknown mode "${mode}". Use: ${Object.keys(MODES).join(' | ')}`);
  if (!['open', 'report', 'clean'].includes(mode)) {
    deps();   // build needs Chromium too: it converts PNG -> WebP
    if (!fs.existsSync(CONFIG)) fail('No atlas.config.ts: run config first.');
  }
  const dash = path.join(ROOT, 'dashboard.html');
  switch (mode) {
    case 'atlas': capture(); build(mode); openFile(dash); break;
    case 'capture': process.exitCode = capture() ? 1 : 0; break;
    case 'build': build(mode); openFile(dash); break;
    case 'check': {
      log('\n[*] Comparing the app against the goldens (nothing is updated)...');
      if (pw('test', ...passthrough)) {
        log('\n[!] Visual differences or failures found. Opening the diff report...');
        log('    If the change is intended, run "atlas" to accept it.');
        const rep = path.join(ROOT, 'report', 'index.html');
        if (fs.existsSync(rep)) openFile(rep);
        process.exitCode = 1;
      } else log('\n[OK] No visual drift: every node matches its golden.');
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
    case 'clean':
      for (const d of ['goldens', 'shots', 'report', 'test-results', 'dashboard.html', 'atlas.crawl.json'])
        fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
      log('[OK] Cleaned.'); break;
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
    log('Usage: node core/cli.mjs <setup | deps | config | run [mode]>');
    log(`Modes: ${Object.keys(MODES).join(' | ')}`);
    process.exitCode = cmd ? 1 : 0;
}
