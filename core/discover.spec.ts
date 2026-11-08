/**
 * discover.spec.ts — finds clickable navigation (tabs, nav links, hash links, data-attribute buttons)
 * on the start page and writes them to atlas.discovered.txt as commented-out state nodes. Keep the
 * ones you want by copying them into atlas.config.ts; the file is never read by the atlas.
 *
 *   npm run discover
 */
import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import config from '../atlas.config';
import { PROJECT_ROOT, loadNodes, slug } from './atlas';

type Candidate = { tag: string; id: string; role: string | null; href: string | null; data: [string, string] | null; text: string };

// double quotes inside a CSS selector or Playwright text match
const dq = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
// single-quoted TypeScript string for the generated node
const sq = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** Preference: #id, a[href], data-attribute button, [role=tab] with its text. null when none fits. */
function selectorFor(c: Candidate): string | null {
  if (c.id && /^[A-Za-z][\w-]*$/.test(c.id)) return `#${c.id}`;
  if (c.tag === 'a' && c.href) return `a[href="${dq(c.href)}"]`;
  if (c.data) return `${c.tag}[${c.data[0]}="${dq(c.data[1])}"]`;
  if (c.role === 'tab' && c.text) return `[role=tab]:has-text("${dq(c.text)}")`;
  return null;
}

// same viewport as the first variant; the project may already set it, this keeps the spec standalone
const first = config.variants[0];
if (first?.viewport) test.use({ viewport: first.viewport });

test('discover', async ({ page }) => {
  test.setTimeout(60_000);
  const nodes = await loadNodes(config);
  const start = config.crawl?.start[0] ?? nodes.find(n => n.url)?.url;
  test.skip(!start, 'no start page: add a node with a url or a crawl section to atlas.config.ts');
  const parent = nodes.find(n => n.url === start)?.id ?? config.root ?? nodes.find(n => n.url)?.id ?? 'home';

  await page.goto(start!);
  await page.waitForLoadState('load');
  await page.waitForTimeout(500);

  const found: Candidate[] = await page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const els = Array.from(document.querySelectorAll('[role=tab], nav a, a[href^="#"], button')).filter(visible);
    return els.map(el => {
      const data = el.getAttributeNames().find(n => n.startsWith('data-'));
      const text = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '')
        .replace(/\s+/g, ' ').trim().slice(0, 60);
      return {
        tag: el.tagName.toLowerCase(), id: el.id, role: el.getAttribute('role'), href: el.getAttribute('href'),
        // buttons count with a data-* attribute or as tabs; other candidates need neither
        data: data ? [data, el.getAttribute(data)!] : null, text,
      } as any;
    }).filter((c: any) => c.tag !== 'button' || c.data || c.role === 'tab');
  });

  // steps that already exist in the config are not suggested again
  const srcs = nodes.map(n => n.steps?.src ?? '');
  const ids = new Set(nodes.map(n => n.id));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const c of found) {
    const sel = selectorFor(c);
    if (!sel || seen.has(sel) || srcs.some(s => s.includes(JSON.stringify(sel)))) continue;
    seen.add(sel);
    const label = c.text || c.id || sel;
    let id = `${parent}:${slug(label)}`;
    while (ids.has(id)) id += '-';
    ids.add(id);
    lines.push(`// { id: ${sq(id)}, label: ${sq(label)}, kind: 'state', parent: ${sq(parent)}, steps: click(${sq(sel)}), ready: 'body' },`);
  }

  const out = path.join(PROJECT_ROOT, 'atlas.discovered.txt');
  const header = [
    `// Navigation candidates found on ${start} by \`npm run discover\` (${new Date().toISOString().slice(0, 10)}).`,
    '// Copy the ones you want into the nodes array of atlas.config.ts and fix their ready selector.',
    '// This file is not read by the atlas.',
    '',
  ];
  fs.writeFileSync(out, header.concat(lines).join('\n') + '\n');
  console.log(`discover: ${lines.length} candidate(s) -> ${out}`);
});
