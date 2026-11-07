/**
 * golden.spec.ts — one test per UI node per variant. Takes a full-page golden, one golden
 * per visible component and one per collection item, then writes
 * shots/nodes/<variant>/<file>.json for build-dashboard.mjs.
 *
 *   npx playwright test --update-snapshots   # create / refresh goldens
 *   npx playwright test                      # fail on visual drift
 *
 * App-specific behaviour comes only from ../atlas.config.ts.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import config from '../atlas.config';
import { ATLAS_ROOT, loadNodes, chainOf, groupOf, fileOf, slug, type UINode, type Variant } from './atlas';

const OUT = path.join(ATLAS_ROOT, 'shots', 'nodes');
const NODES = await loadNodes(config);
const byId = new Map(NODES.map(n => [n.id, n]));
const ROOT = config.root ?? NODES.find(n => !n.parent)?.id ?? NODES[0]?.id;

const FREEZE_CSS = `
  *,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}
  ${config.freezeCss ?? ''}
`;
const TEXT_SELECTORS = (config.textSelectors ?? ['h1', 'h2', 'h3', '[role=heading]']).join(', ');

writeMeta();

async function prepare(page: Page, root: UINode, variant: Variant) {
  if (config.clock !== false) await page.clock.setFixedTime(new Date(config.clock ?? '2026-01-01T12:00:00Z'));
  const fx = root.fixture ? config.fixtures?.[root.fixture] : undefined;
  if (root.fixture && !fx) throw new Error(`Golden Map Atlas: unknown fixture "${root.fixture}" on node "${root.id}"`);
  if (fx?.cookies) await page.context().addCookies(fx.cookies);

  await page.addInitScript(({ seedRandom, local, session, attrs }) => {
    if (seedRandom) {   // deterministic Math.random (mulberry32)
      let a = 0x9e3779b9;
      Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }
    try {   // storage only on the first document of the test, so the app's own writes survive navigation
      if (!sessionStorage.getItem('__atlas_init')) {
        localStorage.clear();
        sessionStorage.clear();
        sessionStorage.setItem('__atlas_init', '1');
        for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v);
        for (const [k, v] of Object.entries(session)) sessionStorage.setItem(k, v);
      }
    } catch {}
    const setAttrs = () => { for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') document.documentElement.classList.add(...v.split(/\s+/).filter(Boolean));
      else document.documentElement.setAttribute(k, v);
    } };
    if (Object.keys(attrs).length) { if (document.documentElement) setAttrs(); else addEventListener('DOMContentLoaded', setAttrs); }
  }, {
    seedRandom: config.seedRandom !== false,
    local: { ...(variant.localStorage ?? {}), ...(fx?.localStorage ?? {}) },
    session: fx?.sessionStorage ?? {},
    attrs: variant.htmlAttributes ?? {},
  });

  await variant.prepare?.(page);
  await fx?.prepare?.(page);
}

async function settle(page: Page) {
  await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
  await page.evaluate(async () => {
    await (document as any).fonts?.ready;
    const mj = (window as any).MathJax;   // common enough to support out of the box
    if (mj?.startup?.promise) { await mj.startup.promise; if (mj.typesetPromise) await mj.typesetPromise(); }
    // lazy images below the fold never load on their own: skip them, and cap each wait
    await Promise.all([...document.images].filter(i => !i.complete && i.loading !== 'lazy')
      .map(i => new Promise(r => {
        i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); setTimeout(r, 10_000);
      })));
  });
  await config.settle?.(page);
  await page.waitForTimeout(300);
}

async function textOf(page: Page) {
  return page.evaluate(sel => {
    const pick = [...document.querySelectorAll<HTMLElement>(sel)]
      .filter(e => e.offsetParent !== null).map(e => e.innerText.trim()).filter(Boolean);
    return [document.title, ...pick].join(' · ').replace(/\s+/g, ' ').slice(0, 600);
  }, TEXT_SELECTORS);
}

async function isVisible(loc: Locator) {
  return (await loc.count()) > 0 && (await loc.first().isVisible());
}

const variantOf = (name: string) => config.variants.find(v => v.name === name)!;

for (const node of NODES) {
  test(node.id, async ({ page }) => {
    // collections shoot one image per element, ~1.5s each
    test.setTimeout(node.timeout ?? (node.collection ? 60_000 + (node.collection.max ?? 100) * 3_000 : config.timeout ?? 60_000));
    const chain = chainOf(node, byId);
    const root = chain[0];
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.dismiss().catch(() => {}));

    const variant = variantOf(test.info().project.name);
    await prepare(page, root, variant);
    await page.goto(root.url!);
    for (let i = 1; i < chain.length; i++) {
      await page.locator(chain[i - 1].ready ?? 'body').first().waitFor();
      await chain[i].steps?.(page);
    }
    await page.locator(node.ready ?? 'body').first().waitFor({ state: 'visible', timeout: 20_000 });
    await settle(page);

    const mask = [...(config.mask ?? []), ...(node.mask ?? [])].map(s => page.locator(s));
    const base = fileOf(node.id);
    // volatile nodes are captured for the atlas but never diffed
    const shoot = async (target: Page | Locator, name: string, opts: any = {}) => node.volatile
      ? target.screenshot({ ...opts, path: test.info().snapshotPath(name), animations: 'disabled' })
      : expect.soft(target as any).toHaveScreenshot(name, opts);
    await shoot(page, `${base}.png`, { fullPage: true, mask });

    const components: any[] = [];
    for (const c of node.components ?? []) {
      const loc = page.locator(c.selector).first();
      if (!(await isVisible(loc))) continue;
      const f = `${base}--${c.name}`;
      await loc.scrollIntoViewIfNeeded();
      await shoot(loc, `${f}.png`, { mask });
      components.push({ id: `${node.id}/${c.name}`, label: c.label, selector: c.selector, img: `${f}.png` });
    }

    const group = groupOf(node, byId) ?? null;
    const items: any[] = [];
    if (node.collection) {
      const col = node.collection;
      const prefix = col.idPrefix ?? `${node.id}:item`;
      const els = page.locator(col.selector);
      const n = Math.min(await els.count(), col.max ?? Infinity);
      const used = new Set<string>();
      for (let i = 0; i < n; i++) {
        const el = els.nth(i);
        if (!(await el.isVisible())) continue;
        // read without auto-waiting: optional sub-elements must not stall the test
        const { label, tags } = await el.evaluate((e, { l, t }) => {
          const txt = (x: Element | null) => (x as HTMLElement | null)?.innerText?.replace(/\s+/g, ' ').trim() ?? '';
          return { label: txt(l ? e.querySelector(l) : e).slice(0, 120), tags: t.map(s => txt(e.querySelector(s))).filter(Boolean) };
        }, { l: col.label ?? null, t: col.tags ?? [] });
        let key = col.idFromLabel === false || !label ? String(i + 1) : slug(label);
        while (used.has(key)) key += `-${i + 1}`;
        used.add(key);
        const id = `${prefix}:${key}`;
        const f = fileOf(id);
        await el.scrollIntoViewIfNeeded();
        await shoot(el, `${f}.png`);
        items.push({ id, label: label || `${node.label} #${i + 1}`, kind: col.kind ?? 'item', parent: node.id, group,
          tags, selector: `${col.selector} >> nth=${i}`, url: null, img: `${f}.png`, components: [] });
      }
    }

    const out = path.join(OUT, variant.name);
    fs.mkdirSync(out, { recursive: true });
    const rec = {
      id: node.id, label: node.label, kind: node.kind, parent: node.parent ?? null, group,
      tags: node.tags ?? [], url: root.url ?? null, volatile: !!node.volatile,
      steps: chain.slice(1).map(c => c.id), text: await textOf(page), errors,
      img: `${base}.png`, components,
    };
    fs.writeFileSync(path.join(out, `${base}.json`), JSON.stringify([rec, ...items], null, 2));
  });
}

/** Viewer settings the (plain JS) builder can't read from the TS config. */
function writeMeta() {
  const meta = {
    title: config.title, root: ROOT, groups: config.groups ?? {}, labels: config.labels ?? {},
    variants: config.variants.map(v => ({ name: v.name, label: v.label ?? v.name, colorScheme: v.colorScheme ?? null })),
  };
  fs.mkdirSync(path.join(ATLAS_ROOT, 'shots'), { recursive: true });
  const file = path.join(ATLAS_ROOT, 'shots', 'meta.json');
  const tmp = `${file}.${process.pid}.tmp`;   // several workers write the same content: rename is atomic
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
  fs.renameSync(tmp, file);
}
