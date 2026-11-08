/**
 * atlas.config.demo.ts — the map of the bundled demo site (examples/demo-site).
 *
 * To try the demo, copy this file over atlas.config.ts (save your own config first).
 * See README.md → "Config reference".
 */
import { defineAtlas, fromCases, click, fill, seq, type UINode } from './core/atlas';

const nodes: UINode[] = [
  {
    id: 'home', label: 'Home', kind: 'page', url: '/index.html', group: 'shop', fixture: 'signed-in',
    ready: '.product', tags: ['products', 'landing'],
    components: [
      { name: 'header', label: 'Top bar', selector: 'header.top' },
      { name: 'hero', label: 'Hero', selector: '.hero' },
    ],
    // every product card becomes its own node (kind 'item')
    collection: { selector: '#grid .product', label: 'h3', tags: ['.badge'], idPrefix: 'product' },
  },
  { id: 'home:guest', label: 'Home — signed out', kind: 'state', parent: 'home', url: '/index.html',
    ready: '.product', tags: ['guest', 'empty'] },
  { id: 'home:new-dialog', label: 'New product dialog', kind: 'state', parent: 'home',
    steps: click('#newBtn'), ready: '#newDialog[open] form', tags: ['modal', 'create'],
    components: [{ name: 'form', label: 'Dialog form', selector: '#newDialog form' }] },
  { id: 'home:filtered', label: 'Filtered list', kind: 'state', parent: 'home',
    steps: fill('#search', 'ch'), ready: '.product', tags: ['search', 'filter'] },

  { id: 'settings', label: 'Settings', kind: 'page', parent: 'home', url: '/settings.html', group: 'account',
    ready: '#tab-profile', tags: ['preferences'],
    components: [{ name: 'tabs', label: 'Tabs', selector: '.tabs' }] },
  { id: 'settings:notifications', label: 'Notifications tab', kind: 'state', parent: 'settings',
    steps: click('[data-tab=notifications]'), ready: '#tab-notifications', tags: ['email'] },
  { id: 'settings:saved', label: 'Settings saved', kind: 'state', parent: 'settings',
    steps: seq(fill('#displayName', 'Grace'), click('#saveBtn')), ready: '#saved', tags: ['confirmation'] },

  // one isolated node per JSON case; the demo app's harness page renders each (examples/demo-site/harness.html)
  ...fromCases({ dir: 'examples/demo-site/cases', harness: '/harness.html', parent: 'home', group: 'cases' }),
];

export default defineAtlas({
  title: 'Demo Shop',
  baseURL: 'http://127.0.0.1:8092',
  server: { staticDir: 'examples/demo-site' },

  variants: [
    { name: 'light', label: 'Light', colorScheme: 'light' },
    { name: 'dark', label: 'Dark', colorScheme: 'dark' },
    { name: 'mobile', label: 'Mobile', colorScheme: 'light', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  ],

  nodes,
  root: 'home',
  fixtures: {
    'signed-in': { localStorage: { 'demo-user': JSON.stringify({ name: 'Ada', cart: 2 }) } },
  },
  mask: ['#clock'],
  review: { threshold: 0.0005 },
  groups: { shop: 'Shop', account: 'Account', cases: 'Formatter cases' },
  labels: { item: 'product', items: 'products' },

  // pages reachable by links that no node above covers (about, team) are added by `run crawl`
  crawl: { start: ['/index.html'], maxPages: 50, exclude: /\.(pdf|zip)$/ },
});
