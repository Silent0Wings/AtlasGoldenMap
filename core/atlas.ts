/**
 * atlas.ts — the public API of Golden Map Atlas: config types, `defineAtlas`, step helpers and
 * node-chain resolution. Nothing here knows about any particular app; everything
 * app-specific lives in the project's atlas.config.ts.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Page } from '@playwright/test';
export type { Page };

export const ATLAS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------------------------------------------------------- types */

/** Built-in kinds get their own colour in the viewer; any other string is allowed too. */
export type Kind = 'page' | 'state' | 'item' | 'component' | (string & {});
export type Step = (page: Page) => Promise<void>;

export type Component = { name: string; label: string; selector: string };

/** Screenshot every element matching `selector` as its own child node (cards, rows, tiles…). */
export type Collection = {
  selector: string;
  /** Selector inside each element whose text is the item's label (default: the element's own text). */
  label?: string;
  /** Selectors inside each element whose text becomes a search tag (badges, categories…). */
  tags?: string[];
  /** Child-node id prefix (default: `<node id>:item`). Items are `<prefix>:<n>` or `<prefix>:<slug of label>`. */
  idPrefix?: string;
  /** Use the label slug in the id instead of the index, so ids survive reordering (default true). */
  idFromLabel?: boolean;
  /** Stop after this many items. */
  max?: number;
  /** Kind of the emitted nodes (default 'item'). */
  kind?: Kind;
};

export type UINode = {
  /** Unique; also the deep-link id and (sanitised) the golden file name. */
  id: string;
  label: string;
  kind: Kind;
  /** Parent node id: this is what draws the graph edges. */
  parent?: string;
  /** Free-form group (section, feature, tenant…); the viewer can filter by it. Inherited by descendants. */
  group?: string;
  tags?: string[];
  /** Starts a new chain: the node is reached by opening this URL (relative to baseURL). */
  url?: string;
  /** Without `url`: replayed after the parent is ready to reach this node. */
  steps?: Step;
  /** Selector that must be visible before the screenshot (default 'body'). */
  ready?: string;
  /** Name of a `fixtures` entry applied before the chain root loads. */
  fixture?: string;
  /** Captured for the atlas but never compared (live canvas, video, maps…). */
  volatile?: boolean;
  /** Extra masks for this node only. */
  mask?: string[];
  components?: Component[];
  collection?: Collection;
  /** Per-node test timeout in ms. */
  timeout?: number;
};

export type Variant = {
  /** Playwright project name and golden folder: goldens/<name>/. */
  name: string;
  label?: string;
  /** Emulated prefers-color-scheme. Also decides the viewer's own theme for this variant. */
  colorScheme?: 'light' | 'dark';
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  locale?: string;
  timezoneId?: string;
  /** localStorage entries set before the app loads (e.g. a theme key). */
  localStorage?: Record<string, string>;
  /** Attributes set on <html> as soon as the document exists (e.g. { class: 'dark' }). */
  htmlAttributes?: Record<string, string>;
  /** Anything else: cookies, page.route() mocks, init scripts… */
  prepare?: (page: Page) => Promise<void>;
};

export type Fixture = {
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  cookies?: Parameters<import('@playwright/test').BrowserContext['addCookies']>[0];
  prepare?: (page: Page) => Promise<void>;
};

export type Server =
  /** Start your own dev server. */
  | { command: string; url?: string; cwd?: string; timeout?: number; reuseExisting?: boolean }
  /** Serve a folder of static files with the bundled no-cache server. */
  | { staticDir: string; port?: number; url?: string };

export type Crawl = {
  /** Start URLs (relative to baseURL). */
  start: string[];
  maxPages?: number;
  maxDepth?: number;
  include?: RegExp;
  exclude?: RegExp;
  /** Strip query strings / hashes when deduplicating (default: drop hash only). */
  ignoreQuery?: boolean;
  ready?: string;
};

export type AtlasConfig = {
  /** Shown in the dashboard header and tab title. */
  title: string;
  baseURL: string;
  server?: Server;
  variants: Variant[];
  nodes: UINode[] | (() => UINode[] | Promise<UINode[]>);
  /** Root node id of the graph (default: first node without a parent). */
  root?: string;
  fixtures?: Record<string, Fixture>;
  /** Selectors masked in every screenshot (clocks, avatars, live counters…). */
  mask?: string[];
  /** Extra CSS injected before shooting (hide overlays, confetti canvases…). */
  freezeCss?: string;
  /** Fixed clock for Date / timers; false to leave real time. */
  clock?: string | false;
  /** Seed Math.random deterministically (default true). */
  seedRandom?: boolean;
  /** Elements whose visible text is recorded for search. */
  textSelectors?: string[];
  /** Extra waits after `ready`, e.g. MathJax / chart libraries finishing. */
  settle?: (page: Page) => Promise<void>;
  /** Group labels for the viewer's filter: { billing: 'Billing' }. */
  groups?: Record<string, string>;
  /** Wording for the viewer. */
  labels?: { item?: string; items?: string };
  /** Optional link crawler that adds every reachable page as a node (`npm run crawl`). */
  crawl?: Crawl;
  /** Playwright knobs. */
  workers?: number;
  timeout?: number;
  actionTimeout?: number;
  maxDiffPixelRatio?: number;
};

export const defineAtlas = (c: AtlasConfig) => c;

/* ---------------------------------------------------------------- step helpers */

export const click = (sel: string): Step => async p => { await p.locator(sel).first().click(); };
export const hover = (sel: string): Step => async p => { await p.locator(sel).first().hover(); };
export const fill = (sel: string, value: string): Step => async p => { await p.locator(sel).first().fill(value); };
export const press = (key: string, sel?: string): Step => async p => {
  if (sel) await p.locator(sel).first().press(key); else await p.keyboard.press(key);
};
export const check = (sel: string, on = true): Step => async p => { await p.locator(sel).first().setChecked(on, { force: true }); };
export const select = (sel: string, value: string): Step => async p => { await p.locator(sel).first().selectOption(value); };
export const wait = (sel: string): Step => async p => { await p.locator(sel).first().waitFor(); };
/** Run several steps in order. */
export const seq = (...steps: Step[]): Step => async p => { for (const s of steps) await s(p); };
/** Click `sel` until `until` is visible: for controls that are wired up late. */
export const clickUntil = (sel: string, until: string, tries = 10): Step => async p => {
  for (let i = 0; i < tries && !(await p.locator(until).first().isVisible()); i++) {
    await p.locator(sel).first().click(); await p.waitForTimeout(300);
  }
};

/* ---------------------------------------------------------------- resolution */

/** Mirror Playwright's snapshot-name sanitising so manifest paths match goldens/. */
export const fileOf = (id: string) => id.replace(/[\x00-\x2C\x2E-\x2F\x3A-\x40\x5B-\x60\x7B-\x7F]+/g, '-');
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'x';

export const CRAWL_FILE = path.join(ATLAS_ROOT, 'atlas.crawl.json');

/** Hand-written nodes + crawled pages whose URL no hand-written node already covers. */
export async function loadNodes(config: AtlasConfig): Promise<UINode[]> {
  const nodes = typeof config.nodes === 'function' ? await config.nodes() : [...config.nodes];
  if (fs.existsSync(CRAWL_FILE)) {
    const seen = new Set(nodes.map(n => n.url).filter(Boolean));
    const ids = new Set(nodes.map(n => n.id));
    const crawled: UINode[] = JSON.parse(fs.readFileSync(CRAWL_FILE, 'utf8'));
    const urlToId = new Map<string, string>();   // first node with a url wins (the page, not its states)
    for (const n of [...nodes, ...crawled]) if (n.url && !urlToId.has(n.url)) urlToId.set(n.url, n.id);
    for (const c of crawled) {
      if (seen.has(c.url) || ids.has(c.id)) continue;
      const parentUrl = (c as any).parentUrl as string | undefined;
      nodes.push({ ...c, parent: parentUrl ? urlToId.get(parentUrl) : c.parent });
    }
  }
  const err = (m: string) => new Error(`Golden Map Atlas: ${m}`);
  const ids = new Set<string>();
  const files = new Map<string, string>();   // golden file name -> id; case-insensitive filesystems collide too
  for (const n of nodes) {
    if (ids.has(n.id)) throw err(`duplicate node id "${n.id}"`);
    ids.add(n.id);
    const f = fileOf(n.id).toLowerCase();
    if (files.has(f)) throw err(`node ids "${files.get(f)}" and "${n.id}" map to the same golden file "${fileOf(n.id)}"`);
    files.set(f, n.id);
  }
  // collection items only exist at capture time; a node may still hang off one by id
  const itemPrefixes = nodes.filter(n => n.collection).map(n => `${n.collection!.idPrefix ?? `${n.id}:item`}:`);
  const isItem = (id: string) => itemPrefixes.some(p => id.startsWith(p));
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const n of nodes) {
    if (n.parent && !ids.has(n.parent) && !isItem(n.parent)) throw err(`node "${n.id}" has unknown parent "${n.parent}"`);
    if (!n.url && !n.parent) throw err(`node "${n.id}" needs a url or a parent`);
    if (!n.url && n.parent && isItem(n.parent)) throw err(`node "${n.id}" hangs off collection item "${n.parent}", so it needs its own url`);
    if (n.url && n.steps) throw err(`node "${n.id}" has both url and steps; steps only run on nodes reached from a parent`);
    if (!n.url && n.fixture) throw err(`node "${n.id}" has a fixture but no url; fixtures apply to the chain root (the nearest node with a url)`);
    if (n.fixture && !config.fixtures?.[n.fixture]) throw err(`node "${n.id}" uses unknown fixture "${n.fixture}"`);
    const seen = new Set<string>();
    for (let c: UINode | undefined = n; c?.parent; c = byId.get(c.parent)) {
      if (seen.has(c.id)) throw err(`parent cycle through "${c.id}"`);
      seen.add(c.id);
    }
  }
  return nodes;
}

/** Ancestor chain from the nearest node with a `url` down to `n` (inclusive). */
export function chainOf(n: UINode, byId: Map<string, UINode>): UINode[] {
  const chain: UINode[] = [];
  for (let c: UINode | undefined = n; c; c = c.url ? undefined : byId.get(c.parent!)) chain.unshift(c);
  if (!chain[0].url) throw new Error(`Golden Map Atlas: no ancestor of "${n.id}" has a url`);
  return chain;
}

export const groupOf = (n: UINode, byId: Map<string, UINode>): string | undefined => {
  for (let c: UINode | undefined = n; c; c = c.parent ? byId.get(c.parent) : undefined) if (c.group) return c.group;
};
