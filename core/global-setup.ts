/**
 * Runs once before the workers start (after webServer is up).
 * server.ready: wait until the app is ready by condition, not just until the port answers.
 * warmup: load baseURL once so the first real tests do not pay the cold start. Failures only warn.
 */
import { chromium, type FullConfig } from '@playwright/test';
import atlas from '../atlas.config';
import type { ServerReady } from './atlas';

const excerpt = (body: string) => body.replace(/\s+/g, ' ').slice(0, 200);
const parse = (body: string) => { try { return JSON.parse(body); } catch { return body; } };

async function waitReady(ready: ServerReady, baseURL: string) {
  const url = new URL(ready.url ?? '/', baseURL).href;
  const status = ready.status ?? 200;
  const interval = ready.interval ?? 500;
  const timeout = ready.timeout ?? 120_000;
  const deadline = Date.now() + timeout;
  let last = 'no response';
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      const body = await res.text();
      last = `status ${res.status}: ${excerpt(body)}`;
      if (res.status === status
        && (!ready.bodyIncludes || body.includes(ready.bodyIncludes))
        && (!ready.until || ready.until(parse(body)))) return;
    } catch (e) {
      last = `error: ${(e as Error).message}`;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Golden Map Atlas: server.ready not met at ${url} after ${timeout} ms (wanted status ${status}); last ${last}`);
    }
    await new Promise(r => setTimeout(r, interval));
  }
}

async function warmup(baseURL: string) {
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ baseURL });
    await page.goto(baseURL, { waitUntil: 'load', timeout: 60_000 });
  } catch (e) {
    console.warn(`Golden Map Atlas: warm-up skipped: ${(e as Error).message.split('\n')[0]}`);
  } finally {
    await browser?.close().catch(() => {});
  }
}

export default async function globalSetup(_config: FullConfig) {
  const ready = atlas.server?.ready;
  if (ready) await waitReady(ready, atlas.baseURL);
  if (atlas.warmup !== false) await warmup(atlas.baseURL);
}
