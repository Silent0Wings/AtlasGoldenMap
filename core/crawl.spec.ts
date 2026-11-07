/**
 * crawl.spec.ts — optional page discovery. Follows same-origin links breadth-first from
 * `crawl.start` and writes atlas.crawl.json; golden.spec.ts then adds every page that no
 * hand-written node covers. Modals, tabs and forms still need hand-written `steps`.
 *
 *   npm run crawl
 */
import { test } from '@playwright/test';
import fs from 'fs';
import config from '../atlas.config';
import { CRAWL_FILE, slug } from './atlas';

test('crawl', async ({ page, baseURL }) => {
  const c = config.crawl;
  test.skip(!c, 'no `crawl` section in atlas.config.ts');
  const max = c!.maxPages ?? 200, maxDepth = c!.maxDepth ?? 6;
  test.setTimeout(30_000 + max * 5_000);
  const origin = new URL(baseURL!).origin;
  const norm = (href: string) => {
    const u = new URL(href, origin);
    u.hash = '';
    if (c!.ignoreQuery) u.search = '';
    return u.origin === origin ? u.pathname + u.search : null;
  };
  const allowed = (p: string) => (!c!.include || c!.include.test(p)) && !(c!.exclude?.test(p));

  const queue = c!.start.map(s => ({ url: norm(s)!, parentUrl: undefined as string | undefined, depth: 0 }));
  const seen = new Set(queue.map(q => q.url));
  const out: any[] = [];
  const ids = new Set<string>();
  while (queue.length && out.length < max) {
    const { url, parentUrl, depth } = queue.shift()!;
    const res = await page.goto(url).catch(() => null);
    if (!res || !res.ok() || !(res.headers()['content-type'] ?? '').includes('html')) continue;
    await page.locator(c!.ready ?? 'body').first().waitFor().catch(() => {});
    const title = (await page.title()).trim();
    let id = `page:${slug(url === '/' ? 'home' : url)}`;
    while (ids.has(id)) id += '-';
    ids.add(id);
    out.push({ id, label: title || url, kind: 'page', url, parentUrl, ready: c!.ready ?? 'body', tags: ['crawled', url] });
    if (depth >= maxDepth) continue;
    const hrefs = await page.$$eval('a[href]', as => as.map(a => (a as HTMLAnchorElement).href));
    for (const h of hrefs) {
      const p = norm(h);
      if (p && !seen.has(p) && allowed(p)) { seen.add(p); queue.push({ url: p, parentUrl: url, depth: depth + 1 }); }
    }
  }
  if (!out.length) throw new Error(`crawl found no HTML pages from ${c!.start.join(', ')}: is the app running at ${baseURL}?`);
  fs.writeFileSync(CRAWL_FILE, JSON.stringify(out, null, 2));
  console.log(`crawl: ${out.length} pages -> ${CRAWL_FILE}`);
});
