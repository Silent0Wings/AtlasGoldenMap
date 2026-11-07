/**
 * Generic Playwright config: every setting comes from atlas.config.ts.
 * One project per variant (goldens/<variant>/*.png); with ATLAS_CRAWL=1 only the `crawl` project.
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import atlas from './atlas.config';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function webServer(): PlaywrightTestConfig['webServer'] {
  const s = atlas.server;
  if (!s) return undefined;
  if ('staticDir' in s) {
    const port = s.port ?? Number(new URL(atlas.baseURL).port);
    if (!port) throw new Error('Golden Map Atlas: staticDir needs a port in baseURL (http://127.0.0.1:8091) or server.port');
    return {
      command: `node "${path.join(HERE, 'core', 'serve.mjs')}" ${port} "${path.resolve(HERE, s.staticDir)}"`,
      url: s.url ?? atlas.baseURL, reuseExistingServer: true, timeout: 30_000,
    };
  }
  return {
    command: s.command, cwd: s.cwd ? path.resolve(HERE, s.cwd) : HERE,
    url: s.url ?? atlas.baseURL, reuseExistingServer: s.reuseExisting ?? true, timeout: s.timeout ?? 120_000,
  };
}

const first = atlas.variants[0];
const CRAWL = !!process.env.ATLAS_CRAWL;

export default defineConfig({
  testDir: path.join(HERE, 'core'),
  fullyParallel: true,
  workers: atlas.workers ?? '50%',
  retries: 0,
  timeout: atlas.timeout ?? 60_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(HERE, 'report') }]],
  outputDir: path.join(HERE, 'test-results'),
  use: {
    baseURL: atlas.baseURL,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    actionTimeout: atlas.actionTimeout ?? 15_000,   // a renamed selector fails fast instead of eating the test timeout
    locale: 'en-US',
    timezoneId: 'UTC',
    browserName: 'chromium',
  },
  projects: CRAWL
    ? [{ name: 'crawl', testMatch: 'crawl.spec.ts', use: { ...(first?.viewport && { viewport: first.viewport }) } }]
    : atlas.variants.map(v => ({
      name: v.name,
      testMatch: 'golden.spec.ts',
      use: {
        ...(v.colorScheme && { colorScheme: v.colorScheme }),
        ...(v.viewport && { viewport: v.viewport }),
        ...(v.deviceScaleFactor && { deviceScaleFactor: v.deviceScaleFactor }),
        ...(v.isMobile !== undefined && { isMobile: v.isMobile }),
        ...(v.hasTouch !== undefined && { hasTouch: v.hasTouch }),
        ...(v.locale && { locale: v.locale }),
        ...(v.timezoneId && { timezoneId: v.timezoneId }),
      },
    })),
  webServer: webServer(),
});
