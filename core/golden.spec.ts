/**
 * golden.spec.ts — one test per UI node per variant. Captures a full-page shot, one shot per
 * visible component and one per collection item, evaluates each against the approved golden
 * (core/store.mjs) and writes shots/nodes/<variant>/<file>.json for build-dashboard.mjs.
 * Goldens are never written here: approve them in the review UI (`npm run review`).
 *
 *   npx playwright test       # capture; fails on any shot that is not match/volatile
 *
 * App-specific behaviour comes only from ../atlas.config.ts.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import config from '../atlas.config';
import { ATLAS_ROOT, loadNodes, chainOf, groupOf, fileOf, slug, type UINode, type Variant } from './atlas';
import { evaluate, sha256, writeAtomic } from './store.mjs';

type Info = Parameters<typeof evaluate>[0]['info'];
type ReviewRecord = ReturnType<typeof evaluate>;

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

/** Sorted-key JSON for config hashes; functions hash by their source (or step tag), so edited steps or prepare hooks count. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) => typeof x === 'function' ? (x.src ?? x.toString())
    : x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
}

/** Retake until two consecutive captures are byte-identical (at most 3 retakes): hides late paints and animation residue. */
async function stableShot(take: () => Promise<Buffer>): Promise<Buffer> {
  let prev = await take();
  for (let i = 0; i < 3; i++) {
    const next = await take();
    if (next.equals(prev)) return next;
    prev = next;
  }
  return prev;
}

const variantOf = (name: string) => config.variants.find(v => v.name === name)!;

for (const node of NODES) {
  test(node.id, async ({ page }) => {
    // collections shoot one image per element, ~2.5s each (two stable takes plus the comparison)
    test.setTimeout(node.timeout ?? (node.collection ? 60_000 + (node.collection.max ?? 100) * 5_000 : config.timeout ?? 60_000));
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

    const masks = [...(config.mask ?? []), ...(node.mask ?? [])];
    const mask = masks.map(s => page.locator(s));
    const base = fileOf(node.id);
    const group = groupOf(node, byId) ?? null;
    const fx = root.fixture ? config.fixtures?.[root.fixture] : undefined;
    // everything a shot depends on besides its pixels: any change here resets the review decision
    const shared = {
      node, ancestors: chain.slice(0, -1), fixture: fx ?? null, variant,
      global: { mask: config.mask, freezeCss: config.freezeCss, clock: config.clock, seedRandom: config.seedRandom, settle: config.settle },
    };
    const records: ReviewRecord[] = [];

    // stable screenshot -> htmlHash (on a clone, masks emptied) -> configHash -> store.evaluate
    const shoot = async (target: Locator | 'page', file: string, info: Info, extra: unknown, maskLocs: Locator[] = []) => {
      const opts = { animations: 'disabled' as const, caret: 'hide' as const, mask: maskLocs };
      const take = (): Promise<Buffer> => target === 'page'
        ? page.screenshot({ ...opts, fullPage: true })
        : target.screenshot(opts);
      // volatile shots are never compared, so a single take is enough
      const actualPng = node.volatile ? await take() : await stableShot(take);
      const el = target === 'page' ? page.locator('body') : target;
      // null when markup hashing is off, so the store treats it as disabled (not as the hash of '')
      const htmlHash = config.review?.htmlHash === false ? null : sha256(await el.evaluate((src, { sels, attrs }) => {
        const w = document.createElement('div');
        w.append(src.cloneNode(true));
        w.querySelectorAll('script').forEach(s => s.remove());
        for (const sel of sels) w.querySelectorAll(sel).forEach(m => { m.innerHTML = ''; });
        w.querySelectorAll('*').forEach(e => { for (const a of attrs) e.removeAttribute(a); });
        return w.innerHTML.replace(/\s+/g, ' ');
      }, { sels: masks, attrs: ['nonce', ...(config.review?.ignoreAttributes ?? [])] }));
      return evaluate({
        variant: variant.name, file, actualPng, htmlHash, configHash: sha256(stable({ shared, extra })),
        volatile: !!node.volatile, info, threshold: config.review?.threshold, pixelThreshold: config.review?.pixelThreshold,
      });
    };

    const pageRec = await shoot('page', base, { id: node.id, nodeId: node.id, label: node.label, kind: node.kind, group, tags: node.tags ?? [] }, null, mask);
    records.push(pageRec);

    const components: any[] = [];
    for (const c of node.components ?? []) {
      const loc = page.locator(c.selector).first();
      if (!(await isVisible(loc))) continue;
      const f = `${base}--${c.name}`;
      await loc.scrollIntoViewIfNeeded();
      const id = `${node.id}/${c.name}`;
      const r = await shoot(loc, f, { id, nodeId: node.id, label: c.label, kind: 'component', group, tags: node.tags ?? [] }, { component: c }, mask);
      records.push(r);
      components.push({ id, label: c.label, selector: c.selector, img: `${f}.png`, status: r.status });
    }

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
        const itemLabel = label || `${node.label} #${i + 1}`;
        const r = await shoot(el, f, { id, nodeId: node.id, label: itemLabel, kind: col.kind ?? 'item', group, tags }, { collection: col, label: itemLabel }, mask);
        records.push(r);
        items.push({ id, label: itemLabel, kind: col.kind ?? 'item', parent: node.id, group,
          tags, selector: `${col.selector} >> nth=${i}`, url: null, img: `${f}.png`, status: r.status, components: [] });
      }
    }

    const out = path.join(OUT, variant.name);
    fs.mkdirSync(out, { recursive: true });
    const rec = {
      id: node.id, label: node.label, kind: node.kind, parent: node.parent ?? null, group,
      tags: node.tags ?? [], url: root.url ?? null, volatile: !!node.volatile,
      steps: chain.slice(1).map(c => c.id), text: await textOf(page), errors,
      img: `${base}.png`, status: pageRec.status, components,
    };
    fs.writeFileSync(path.join(out, `${base}.json`), JSON.stringify([rec, ...items], null, 2));

    // written before the check so the dashboard still shows the statuses of a failing node
    const problems = records.filter(r => r.status !== 'match' && r.status !== 'volatile')
      .map(r => `${r.key}: ${r.status} (${r.reasons.join(', ')}) ${r.decision}`);
    expect(problems, `visual check failed:\n${problems.join('\n')}`).toEqual([]);
  });
}

/** Viewer settings the (plain JS) builder can't read from the TS config. */
function writeMeta() {
  const meta = {
    title: config.title, root: ROOT, groups: config.groups ?? {}, labels: config.labels ?? {},
    variants: config.variants.map(v => ({ name: v.name, label: v.label ?? v.name, colorScheme: v.colorScheme ?? null })),
    reviewPort: config.review?.port ?? 8097,
  };
  fs.mkdirSync(path.join(ATLAS_ROOT, 'shots'), { recursive: true });
  const file = path.join(ATLAS_ROOT, 'shots', 'meta.json');
  writeAtomic(file, JSON.stringify(meta, null, 2));   // several workers write the same content, so the write must be atomic
}
