#!/usr/bin/env node
// Screenshot + diagnostics runner for the local preview.
//
//   node shoot.mjs [--port 4180] [--no-server] [--theme <dir>] [--pages home,product,cart-drawer]
//                  [--vp mobile,desktop] [--out ../screens] [--no-full] [--no-states] [--strict]
//                  [--settings whatsapp_number:51900000000,cart_type:page]   (theme-settings override)
//
// For every page × viewport it saves <out>/<name>-<vp>.png and records console errors/warnings,
// page errors, failed requests (≥400, favicon excluded), server-side Liquid render errors/warnings
// and horizontal overflow (mobile). Interaction states (cart drawer, menu drawer, predictive search,
// filters drawer, variant switch) are captured viewport-sized. Everything lands in <out>/report.json.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { CHROMIUM_PATH, DEFAULT_MOCK_PATH, DEFAULT_SCREENS_DIR } from './lib/paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Catalog (keep in sync with README.md)

const mock = JSON.parse(fs.readFileSync(DEFAULT_MOCK_PATH, 'utf8'));
const variantOf = (handle, title) => {
  const p = mock.products.find((x) => x.handle === handle);
  if (!p) return null;
  return (title ? p.variants.find((v) => v.title === title) : p.variants[0])?.id ?? null;
};
const CART_SEED = [
  [variantOf('linterna-multifuncional-m29'), 1],
  [variantOf('lentes-deportivos-tornasolado-hm-l1-hm-l1', 'Negro'), 2],
].filter(([id]) => id).map(([id, q]) => `${id}:${q}`).join(',');

export const PAGES = [
  { name: 'home', url: '/' },
  { name: 'collection', url: '/collections/luces' },
  { name: 'collection-all', url: '/collections/all' },
  { name: 'collection-filtered', url: '/collections/all?filter.p.vendor=Rockbros&sort_by=price-ascending' },
  { name: 'product', url: '/products/linterna-multifuncional-m29' },
  { name: 'product-color', url: '/products/lentes-deportivos-tornasolado-hm-l1-hm-l1' },
  { name: 'product-soldout', url: '/products/casco-open-face-mt-33g2' },
  // Preview-only fixture products (fixtures/products.json): fully sold out; "Modelo" pills with
  // varying prices, low stock (deny, 4), badges nuevo + mas-vendido and a demo rating.
  { name: 'product-agotado', url: '/products/sg-luz-delantera-agotada' },
  { name: 'product-modelos', url: '/products/sg-grips-ergonomicos-modelos' },
  { name: 'search', url: '/search?q=luz' },
  { name: 'search-empty', url: '/search?q=zzzz' },
  { name: 'cart', url: '/cart', cart: CART_SEED },
  { name: 'cart-empty', url: '/cart' },
  { name: 'list-collections', url: '/collections' },
  { name: 'page', url: '/pages/contact' },
  { name: '404', url: '/nope' },
  { name: 'password', url: '/password' },
  { name: 'styleguide', url: '/_styleguide' },
];

const HEADER = '.shopify-section-group-header-group';
const DRAWER_OPEN = ['side-drawer#CartDrawer[open]', '#CartDrawer[open]', '.cart-drawer[open]', 'cart-drawer[open]'];

export const STATES = [
  {
    name: 'cart-drawer',
    url: '/products/linterna-multifuncional-m29',
    vps: ['mobile', 'desktop'],
    async run(page) {
      const btn = await firstVisible(page, ['main [name="add"][type="submit"]', 'main button[name="add"]', '[name="add"][type="submit"]', 'button[name="add"]']);
      if (!btn) return 'no visible add-to-cart submit button [name="add"]';
      await btn.click();
      if (!(await waitForAny(page, DRAWER_OPEN, 6000))) return `cart drawer did not open (${DRAWER_OPEN.join(' | ')})`;
      await page.waitForTimeout(500);
      return true;
    },
  },
  {
    name: 'cart-drawer-empty',
    url: '/',
    vps: ['mobile', 'desktop'],
    async run(page) {
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('cart:open', { bubbles: true })));
      if (!(await waitForAny(page, DRAWER_OPEN, 4000))) return 'dispatching cart:open did not open the cart drawer';
      await page.waitForTimeout(300);
      return true;
    },
  },
  {
    name: 'menu-drawer',
    url: '/',
    vps: ['mobile'],
    async run(page) {
      const btn = await firstVisible(page, [`${HEADER} [data-drawer-open]`, 'header [data-drawer-open]']);
      if (!btn) return `no visible [data-drawer-open] in the header (${HEADER})`;
      await btn.click();
      if (!(await waitForAny(page, ['side-drawer[open]', '.drawer[open]'], 4000))) return 'menu drawer did not open (side-drawer[open])';
      await page.waitForTimeout(300);
      return true;
    },
  },
  {
    name: 'predictive',
    url: '/',
    vps: ['mobile', 'desktop'],
    async run(page) {
      const input = await firstVisible(page, [`${HEADER} input[type="search"]`, `${HEADER} input[name="q"]`, 'header input[name="q"]', 'input[name="q"]']);
      if (!input) return 'no visible search input in the header';
      await input.click();
      await input.type('luz', { delay: 60 });
      await page.waitForTimeout(800);
      const shown = await page.evaluate(() => !!document.querySelector('predictive-search [role="listbox"], [id*="predictive" i] a, .predictive-search a'));
      return shown ? true : 'typed "luz" but no predictive results appeared (predictive-search [role=listbox] / .predictive-search a)';
    },
  },
  {
    name: 'filters-drawer',
    url: '/collections/luces',
    vps: ['mobile'],
    async run(page) {
      const btn = await firstVisible(page, ['main [data-drawer-open]']);
      if (!btn) return 'no visible [data-drawer-open] filter trigger inside main';
      await btn.click();
      if (!(await waitForAny(page, ['side-drawer[open]', '.drawer[open]'], 4000))) return 'filters drawer did not open';
      await page.waitForTimeout(300);
      return true;
    },
  },
  {
    name: 'variant-switch',
    url: '/products/lentes-deportivos-tornasolado-hm-l1-hm-l1',
    vps: ['mobile', 'desktop'],
    async run(page, rec) {
      const before = page.url();
      const radios = page.locator('main variant-picker input[type="radio"], main fieldset input[type="radio"]');
      if ((await radios.count()) >= 2) {
        const second = radios.nth(1);
        const id = await second.getAttribute('id');
        const label = id ? page.locator(`label[for="${id}"]`).first() : null;
        if (label && (await label.count()) && (await label.isVisible())) await label.click();
        else await second.check({ force: true });
      } else {
        const buttons = page.locator('main variant-picker [data-option-value], main variant-picker button, main [data-option-value]');
        if ((await buttons.count()) >= 2) await buttons.nth(1).click();
        else {
          const select = page.locator('main variant-picker select, main select[name^="options"]').first();
          if (!(await select.count())) return 'no variant picker inputs (radio / [data-option-value] / select) found in main';
          await select.selectOption({ index: 1 });
        }
      }
      await page.waitForTimeout(700);
      rec.urlAfter = page.url();
      if (rec.urlAfter === before) rec.note = 'URL did not change after switching (expected ?variant=)';
      return true;
    },
  },
];

// ---------------------------------------------------------------------------
// helpers

async function firstVisible(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel);
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (await el.isVisible().catch(() => false)) return el;
    }
  }
  return null;
}

async function waitForAny(page, selectors, timeout) {
  try {
    await page.waitForSelector(selectors.join(', '), { state: 'attached', timeout });
    return true;
  } catch {
    return false;
  }
}

const NO_MOTION_CSS = `*, *::before, *::after {
  animation-duration: 0s !important; animation-delay: 0s !important;
  transition-duration: 0s !important; transition-delay: 0s !important;
}
html { scroll-behavior: auto !important; }`;

async function settle(page) {
  await page.addStyleTag({ content: NO_MOTION_CSS }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

/** Scroll through the page so lazy images and reveal-on-scroll content render, then return to top. */
async function warmUp(page) {
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await sleep(60);
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(120);
    window.scrollTo(0, 0);
    const imgs = [...document.images].filter((img) => !img.complete);
    await Promise.race([
      Promise.all(imgs.map((img) => new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); }))),
      sleep(4000),
    ]);
    await sleep(150);
  }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
}

/** Stop autoplaying carousels on their first slide so full-page captures are deterministic. */
async function freezeCarousels(page) {
  await page.evaluate(() => {
    document.querySelectorAll('carousel-slider').forEach((c) => {
      c._editorHold = true; // carousel.js: start() is a no-op while held (the pause button keeps its state)
      if (typeof c.stop === 'function') c.stop();
      const track = c.querySelector('.carousel__track');
      if (track) track.scrollLeft = 0;
      if (typeof c.update === 'function') c.update();
    });
  }).catch(() => {});
  await page.waitForTimeout(60);
}

async function measureOverflow(page, vpWidth) {
  return page.evaluate((vw) => {
    const doc = document.documentElement;
    const scrollWidth = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0);
    const innerWidth = window.innerWidth;
    const overflowing = scrollWidth > Math.min(innerWidth, vw) + 1;
    const offenders = [];
    if (overflowing) {
      const describe = (el) => {
        let s = el.tagName.toLowerCase();
        if (el.id) s += `#${el.id}`;
        const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
        if (cls) s += `.${cls}`;
        const sec = el.closest('.shopify-section');
        return sec && sec !== el ? `${s} (in #${sec.id})` : s;
      };
      const hits = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed') continue;
        // Box sticking out, or content (e.g. an unbreakable word) overflowing a visible-overflow box.
        const right = Math.max(r.right, cs.overflowX === 'visible' ? r.left + el.scrollWidth : r.right);
        if (right <= vw + 1) continue;
        let clipped = false;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          if (getComputedStyle(a).overflowX !== 'visible') { clipped = true; break; }
        }
        if (!clipped) hits.push({ el, right });
      }
      // Report the innermost offenders (drop ancestors of other offenders).
      const leaves = hits.filter((h) => !hits.some((o) => o !== h && h.el.contains(o.el)));
      for (const h of leaves.slice(0, 10)) offenders.push(`${describe(h.el)} → right edge ${Math.round(h.right)}px`);
    }
    const hasViewportMeta = !!document.querySelector('meta[name="viewport"]');
    return { scrollWidth, innerWidth, overflowing, hasViewportMeta, offenders };
  }, vpWidth);
}

// ---------------------------------------------------------------------------
// CLI

function parseArgs(argv) {
  const a = { port: null, server: true, pages: null, vps: ['mobile', 'desktop'], out: DEFAULT_SCREENS_DIR, full: true, states: true, strict: false, theme: null, timeout: 30000 };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const next = () => argv[++i];
    if (x === '--port') a.port = Number(next());
    else if (x === '--no-server') a.server = false;
    else if (x === '--pages') a.pages = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (x === '--vp') a.vps = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (x === '--out') a.out = path.resolve(next());
    else if (x === '--full') a.full = true;
    else if (x === '--no-full') a.full = false;
    else if (x === '--no-states') a.states = false;
    else if (x === '--strict') a.strict = true;
    else if (x === '--theme') a.theme = path.resolve(next());
    else if (x === '--timeout') a.timeout = Number(next());
    else if (x === '--settings') a.settings = next();
    else if (x === '--help' || x === '-h') a.help = true;
  }
  if (!a.port) a.port = a.server ? 4180 : 4173;
  return a;
}

const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};

async function waitForHealth(base, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${base}/__health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n'));
    return 0;
  }
  const base = `http://127.0.0.1:${args.port}`;
  let child = null;
  // A preview server already listening on --port is reused instead of spawning a second one.
  if (args.server && (await waitForHealth(base, 400))) {
    console.log(`[shoot] reusing the preview server already running at ${base}`);
    args.server = false;
  }
  if (args.server) {
    const serverArgs = [path.join(here, 'server.mjs'), '--port', String(args.port), '--quiet'];
    if (args.theme) serverArgs.push('--theme', args.theme);
    child = spawn(process.execPath, serverArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('exit', (code) => { if (code) console.error(`[shoot] server exited with code ${code}`); });
  }
  const cleanup = () => { if (child && !child.killed) child.kill(); };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  if (!(await waitForHealth(base))) {
    console.error(`[shoot] preview server not reachable at ${base}`);
    cleanup();
    return 2;
  }

  const wanted = args.pages ? new Set(args.pages) : null;
  const known = new Set([...PAGES.map((p) => p.name), ...STATES.map((s) => s.name)]);
  for (const n of wanted || []) if (!known.has(n)) console.warn(`[shoot] unknown page/state "${n}" (known: ${[...known].join(', ')})`);
  const pages = PAGES.filter((p) => !wanted || wanted.has(p.name));
  const states = args.states ? STATES.filter((s) => !wanted || wanted.has(s.name)) : [];
  const vps = args.vps.filter((v) => VIEWPORTS[v]);
  fs.mkdirSync(args.out, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
  const records = [];

  // --settings id:value,id2:value2 → every captured URL gets ?__settings=… (preview-only theme
  // settings override, e.g. whatsapp_number:51900000000 to review the WhatsApp UI).
  const withSettings = (u) => {
    if (!args.settings) return u;
    const [p, hash = ''] = u.split('#');
    return `${p}${p.includes('?') ? '&' : '?'}__settings=${encodeURIComponent(args.settings)}${hash ? `#${hash}` : ''}`;
  };

  const capture = async ({ name, url: rawUrl, vp, cart = null, state = null }) => {
    const url = withSettings(rawUrl);
    const rec = { name, vp, url, kind: state ? 'state' : 'page', file: null, status: null, consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [], renderErrors: [], renderWarnings: [] };
    const t0 = Date.now();
    const reset = await fetch(`${base}/__reset${cart ? `?cart=${encodeURIComponent(cart)}` : ''}`).then((r) => r.json());
    const seq = reset.seq;
    const context = await browser.newContext({ ...VIEWPORTS[vp], locale: 'es-PE', timezoneId: 'America/Lima' });
    const page = await context.newPage();
    page.on('console', (msg) => {
      const entry = { text: msg.text(), location: msg.location()?.url || null };
      // Resource load failures are reported (with URL + status) under failedRequests instead.
      if (/^Failed to load resource/.test(entry.text)) return;
      if (msg.type() === 'error') rec.consoleErrors.push(entry);
      else if (msg.type() === 'warning') rec.consoleWarnings.push(entry);
    });
    page.on('pageerror', (err) => rec.pageErrors.push(String(err?.stack || err).split('\n').slice(0, 4).join('\n')));
    page.on('requestfailed', (req) => {
      if (/favicon/.test(req.url())) return;
      rec.failedRequests.push({ url: req.url().replace(base, ''), error: req.failure()?.errorText || 'failed' });
    });
    page.on('response', (res) => {
      if (res.status() >= 400 && !/favicon/.test(res.url()) && res.url() !== `${base}${url}`) {
        rec.failedRequests.push({ url: res.url().replace(base, ''), status: res.status() });
      }
    });
    try {
      const resp = await page.goto(base + url, { waitUntil: 'load', timeout: args.timeout });
      rec.status = resp ? resp.status() : null;
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await settle(page);
      if (state) {
        const outcome = await state.run(page, rec).catch((e) => `interaction failed: ${e.message.split('\n')[0]}`);
        rec.reached = outcome === true;
        if (outcome !== true) rec.reason = outcome;
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
      } else {
        await warmUp(page);
        await freezeCarousels(page);
      }
      if (vp === 'mobile') rec.overflow = await measureOverflow(page, VIEWPORTS[vp].viewport.width);
      if (!state || rec.reached) {
        const file = path.join(args.out, `${name}-${vp}.png`);
        await page.screenshot({ path: file, fullPage: !state && args.full, animations: 'disabled' });
        rec.file = path.basename(file); // relative to report.json
        rec.path = file;
      }
    } catch (e) {
      rec.error = e.message.split('\n')[0];
    }
    await context.close();
    try {
      const errs = await fetch(`${base}/__errors?since=${seq}`).then((r) => r.json());
      for (const e of errs.errors) {
        const item = { message: e.message, file: e.file, line: e.line, count: e.count, request: e.url };
        (e.kind === 'error' ? rec.renderErrors : rec.renderWarnings).push(item);
      }
    } catch { /* server gone */ }
    rec.ms = Date.now() - t0;
    records.push(rec);
    printLine(rec);
  };

  console.log(`[shoot] ${base} → ${path.relative(process.cwd(), args.out) || '.'}  (${pages.length} pages, ${states.length} states, ${vps.join('+')})`);
  for (const vp of vps) {
    for (const p of pages) await capture({ name: p.name, url: p.url, vp, cart: p.cart });
    for (const s of states) if (s.vps.includes(vp)) await capture({ name: s.name, url: s.url, vp, state: s });
  }
  await browser.close();

  const summary = {
    captures: records.length,
    screenshots: records.filter((r) => r.file).length,
    withConsoleErrors: records.filter((r) => r.consoleErrors.length).length,
    withPageErrors: records.filter((r) => r.pageErrors.length).length,
    withFailedRequests: records.filter((r) => r.failedRequests.length).length,
    withRenderErrors: records.filter((r) => r.renderErrors.length).length,
    mobileOverflow: records.filter((r) => r.overflow?.overflowing).map((r) => r.name),
    statesNotReached: records.filter((r) => r.kind === 'state' && !r.reached).map((r) => `${r.name}-${r.vp}: ${r.reason}`),
  };
  const report = { generatedAt: new Date().toISOString(), base, out: args.out, viewports: vps, summary, pages: records };
  fs.writeFileSync(path.join(args.out, 'report.json'), JSON.stringify(report, null, 2));

  console.log('\n[shoot] summary');
  console.log(`  screenshots: ${summary.screenshots}/${summary.captures}`);
  console.log(`  console errors on ${summary.withConsoleErrors}, page errors on ${summary.withPageErrors}, failed requests on ${summary.withFailedRequests}, Liquid render errors on ${summary.withRenderErrors}`);
  if (summary.mobileOverflow.length) console.log(`  mobile horizontal overflow: ${summary.mobileOverflow.join(', ')}`);
  for (const s of summary.statesNotReached) console.log(`  state not reached: ${s}`);
  console.log(`  report: ${path.relative(process.cwd(), path.join(args.out, 'report.json'))}`);
  cleanup();
  const bad = summary.withConsoleErrors + summary.withPageErrors + summary.withRenderErrors;
  return args.strict && bad ? 1 : 0;
}

function printLine(r) {
  const flags = [];
  if (r.error) flags.push(`ERROR ${r.error}`);
  if (r.kind === 'state' && !r.reached) flags.push(`not reached: ${r.reason}`);
  if (r.consoleErrors.length) flags.push(`console ${r.consoleErrors.length}E`);
  if (r.consoleWarnings.length) flags.push(`${r.consoleWarnings.length}W`);
  if (r.pageErrors.length) flags.push(`pageerror ${r.pageErrors.length}`);
  if (r.failedRequests.length) flags.push(`failed req ${r.failedRequests.length}`);
  if (r.renderErrors.length) flags.push(`liquid ${r.renderErrors.length}E`);
  if (r.renderWarnings.length) flags.push(`liquid ${r.renderWarnings.length}W`);
  if (r.overflow?.overflowing) flags.push(`overflow ${r.overflow.scrollWidth}px`);
  const status = r.status ?? '---';
  console.log(`  ${r.name.padEnd(20)} ${r.vp.padEnd(7)} ${String(status).padEnd(4)} ${String(r.ms).padStart(5)}ms  ${flags.join(' · ') || 'clean'}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error('[shoot] failed:', e);
    process.exit(1);
  });
}
