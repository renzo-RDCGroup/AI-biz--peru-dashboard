// HTTP layer: storefront pages, Section Rendering API, AJAX Cart API, predictive search,
// recommendations, theme assets, placeholder images, local fonts and debug endpoints.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { FONTS_DIR } from './paths.mjs';
import { renderSvg, paymentSvg } from './images.mjs';
import { escapeHtml, nestParams, toInt } from './util.mjs';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const GOOGLE_FONTS_RE = /(?:https?:)?\/\/fonts\.googleapis\.com\/css2?\?[^"'()\s<>]*/g;

// ---------------------------------------------------------------------------
// response helpers

function send(res, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', headers);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function errorHeaders(world) {
  return {
    'X-Render-Errors': String(world.errors.errorCount),
    'X-Render-Warnings': String(world.errors.warningCount),
  };
}

/** Serve-time rewrites: Google Fonts → local copy; any cdn.shopify.com URL → local placeholder. */
function rewrite(app, text) {
  return app.store.registry.rewriteCdnUrls(String(text).replace(GOOGLE_FONTS_RE, '/_fonts/local.css'));
}

// ---------------------------------------------------------------------------
// request parsing

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readParams(req, url) {
  const params = nestParams([...url.searchParams]);
  if (req.method !== 'POST' && req.method !== 'PUT') return params;
  const buf = await readBody(req);
  if (!buf.length) return params;
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('application/json')) {
    try {
      return { ...params, ...JSON.parse(buf.toString('utf8')) };
    } catch {
      return params;
    }
  }
  if (ct.includes('multipart/form-data')) {
    const fd = await new Request('http://local/', { method: 'POST', headers: { 'content-type': ct }, body: buf }).formData();
    const entries = [];
    for (const [k, v] of fd.entries()) if (typeof v === 'string') entries.push([k, v]);
    return { ...params, ...nestParams(entries) };
  }
  return { ...params, ...nestParams([...new URLSearchParams(buf.toString('utf8'))]) };
}

function sectionIds(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list.map((s) => String(s).trim()).filter(Boolean);
}

const MAX_SECTIONS = 5; // Shopify renders at most five ids per `sections` request

function limitSections(w, ids) {
  if (ids.length <= MAX_SECTIONS) return ids;
  w.errors.warn(`Section Rendering API: ${ids.length} sections requested, Shopify renders at most ${MAX_SECTIONS} — ignored: ${ids.slice(MAX_SECTIONS).join(', ')}`, {});
  return ids.slice(0, MAX_SECTIONS);
}

function contextPath(req, params) {
  if (params.sections_url) return String(params.sections_url);
  const ref = req.headers.referer;
  if (ref) {
    try {
      const u = new URL(ref);
      return u.pathname + u.search;
    } catch { /* ignore */ }
  }
  return '/';
}

// ---------------------------------------------------------------------------
// rendering helpers

async function renderSections(app, origin, ctxPath, ids) {
  const url = new URL(ctxPath, origin);
  const w = app.world(url);
  const out = {};
  for (const id of limitSections(w, ids)) {
    const html = await app.renderer.renderSectionById(w, id);
    out[id] = html === null ? null : rewrite(app, html);
  }
  return { sections: out, world: w };
}

async function servePage(app, req, res, url) {
  if (url.searchParams.has('__cart')) app.cart.seed(url.searchParams.get('__cart'));
  const route = app.resolveRoute(url);
  const w = app.world(url, route);

  if (url.searchParams.has('section_id')) {
    const id = url.searchParams.get('section_id');
    const html = await app.renderer.renderSectionById(w, id);
    if (html === null) return send(res, 404, `Section "${escapeHtml(id)}" not found`, 'text/plain; charset=utf-8', errorHeaders(w));
    return send(res, route.status, rewrite(app, html), 'text/html; charset=utf-8', errorHeaders(w));
  }
  if (url.searchParams.has('sections')) {
    const out = {};
    for (const id of limitSections(w, sectionIds(url.searchParams.get('sections')))) {
      const html = await app.renderer.renderSectionById(w, id);
      out[id] = html === null ? null : rewrite(app, html);
    }
    return sendJson(res, route.status, out, errorHeaders(w));
  }
  const html = await app.renderer.renderPage(w);
  return send(res, route.status, rewrite(app, html), 'text/html; charset=utf-8', errorHeaders(w));
}

// ---------------------------------------------------------------------------
// cart

async function cartAjax(app, req, res, url, op) {
  const params = await readParams(req, url);
  const cart = app.cart;
  let result;
  let single = false;
  if (op === 'add') {
    let items = params.items;
    if (!Array.isArray(items) || !items.length) {
      single = true;
      items = [{ id: params.id, quantity: params.quantity ?? 1, properties: params.properties }];
    }
    result = cart.addItems(items.map((i) => ({ id: i.id, quantity: i.quantity ?? 1, properties: i.properties })));
  } else if (op === 'change') {
    result = cart.change({ id: params.id, line: params.line, quantity: params.quantity, properties: params.properties });
  } else if (op === 'update') {
    result = cart.update({ updates: params.updates, note: params.note, attributes: params.attributes });
  } else {
    result = cart.clear();
  }
  if (!result.ok) return sendJson(res, result.status, result.body);

  let payload;
  if (op === 'add') {
    const lines = result.lines.map((l) => cart.lineJson(cart.resolvedLines().find((x) => x.key === l.key)));
    payload = single ? lines[0] : { items: lines };
  } else {
    payload = cart.json();
  }
  const ids = sectionIds(params.sections);
  let headers = {};
  if (ids.length) {
    const { sections, world } = await renderSections(app, url.origin, contextPath(req, params), ids);
    payload.sections = sections;
    headers = errorHeaders(world);
  }
  return send(res, 200, rewrite(app, JSON.stringify(payload)), 'application/json; charset=utf-8', headers);
}

async function cartForm(app, req, res, url, op) {
  const params = await readParams(req, url);
  const cart = app.cart;
  if (op === 'add') {
    const items = Array.isArray(params.items) && params.items.length
      ? params.items
      : [{ id: params.id, quantity: params.quantity ?? 1, properties: params.properties }];
    const r = cart.addItems(items);
    if (!r.ok) return send(res, r.status, `<!doctype html><meta charset="utf-8"><title>Error</title><p>${escapeHtml(r.body.description)}</p><p><a href="/cart">Volver al carrito</a></p>`);
    return redirect(res, params.return_to || '/cart');
  }
  if (op === 'change') cart.change({ id: params.id, line: params.line, quantity: params.quantity });
  if (op === 'clear') cart.clear();
  if (op === 'update' || op === 'cart') {
    cart.update({ updates: params.updates, note: params.note, attributes: params.attributes });
    if (op === 'cart' && params.checkout !== undefined) return redirect(res, '/checkout');
  }
  return redirect(res, params.return_to || '/cart');
}

// ---------------------------------------------------------------------------
// predictive search / recommendations / product JSON

async function predictive(app, req, res, url) {
  const q = url.searchParams.get('q') || '';
  const typesRaw = url.searchParams.get('resources[type]') || 'query,product,collection,page,article';
  const types = typesRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const limit = Math.min(10, Math.max(1, toInt(url.searchParams.get('resources[limit]'), 10)));
  const route = { pageType: 'search', template: 'search', suffix: null, objects: { predictive: { q, types, limit } }, handle: '', status: 200 };
  const w = app.world(url, route);
  const sectionId = url.searchParams.get('section_id');
  if (sectionId) {
    const html = await app.renderer.renderSectionById(w, sectionId);
    if (html === null) return send(res, 404, 'Section not found', 'text/plain; charset=utf-8', errorHeaders(w));
    return send(res, 200, rewrite(app, html), 'text/html; charset=utf-8', errorHeaders(w));
  }
  return send(res, 200, rewrite(app, JSON.stringify(w.globals.predictive_search.toJSON())), 'application/json; charset=utf-8');
}

async function recommendations(app, req, res, url) {
  const pid = url.searchParams.get('product_id');
  const product = pid ? app.store.productsById.get(String(pid)) : null;
  if (!product) return sendJson(res, 404, { status: 404, message: 'Product not found', description: `No product with id ${pid}` });
  const intent = url.searchParams.get('intent') === 'complementary' ? 'complementary' : 'related';
  const limit = Math.min(10, Math.max(1, toInt(url.searchParams.get('limit'), 10)));
  const route = { pageType: 'product', template: 'product', suffix: null, objects: { product, recommendations: { product, intent, limit } }, handle: product.handle, status: 200 };
  const w = app.world(url, route);
  const sectionId = url.searchParams.get('section_id');
  if (sectionId) {
    const html = await app.renderer.renderSectionById(w, sectionId);
    if (html === null) return send(res, 404, 'Section not found', 'text/plain; charset=utf-8', errorHeaders(w));
    return send(res, 200, rewrite(app, html), 'text/html; charset=utf-8', errorHeaders(w));
  }
  const recs = w.globals.recommendations;
  return send(res, 200, rewrite(app, JSON.stringify({ intent, products: recs.products.map((p) => p.ajaxJSON()) })), 'application/json; charset=utf-8');
}

function productJson(app, res, url, handle, wrap) {
  const product = app.store.product(handle);
  if (!product) return sendJson(res, 404, { status: 404, message: 'Not Found' });
  const w = app.world(url, { pageType: 'product', template: 'product', suffix: null, objects: { product }, handle, status: 200 });
  const data = w.globals.product.ajaxJSON();
  return send(res, 200, rewrite(app, JSON.stringify(wrap ? { product: data } : data)), 'application/json; charset=utf-8');
}

// ---------------------------------------------------------------------------
// static-ish endpoints

async function serveAsset(app, req, res, url, name) {
  const rel = `assets/${name}`;
  const ext = path.extname(name).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  if (app.theme.exists(rel)) {
    const buf = app.theme.readBuffer(rel);
    const body = type.startsWith('text/css') ? rewrite(app, buf.toString('utf8')) : buf;
    return send(res, 200, body, type, { 'Cache-Control': 'no-cache' });
  }
  if (app.theme.exists(`${rel}.liquid`)) {
    const w = app.world(url, { pageType: 'asset', template: 'asset', suffix: null, objects: {}, handle: '', status: 200 });
    const html = await app.renderer.renderFile(w, `${rel}.liquid`, {});
    return send(res, 200, rewrite(app, html), type, errorHeaders(w));
  }
  return send(res, 404, `Asset not found: ${rel}`, 'text/plain; charset=utf-8');
}

function serveImage(app, res, url) {
  const entry = app.store.registry.fromLocalPath(url.pathname);
  if (!entry) return send(res, 404, 'Unknown image', 'text/plain; charset=utf-8');
  const params = Object.fromEntries(url.searchParams);
  return send(res, 200, renderSvg(entry, params), 'image/svg+xml', { 'Cache-Control': 'public, max-age=600' });
}

function serveFont(res, url) {
  const name = decodeURIComponent(url.pathname.slice('/_fonts/'.length)) + (url.search ? decodeURIComponent(url.search) : '');
  const candidates = [name, decodeURIComponent(url.pathname.slice('/_fonts/'.length)) + url.search];
  for (const c of candidates) {
    const p = path.join(FONTS_DIR, c);
    if (!p.startsWith(FONTS_DIR)) break;
    try {
      const buf = fs.readFileSync(p);
      const type = c.endsWith('.css') ? 'text/css; charset=utf-8' : 'font/woff2';
      return send(res, 200, buf, type, { 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' });
    } catch { /* try next */ }
  }
  return send(res, 404, 'Font not found', 'text/plain; charset=utf-8');
}

function placeholderPage(title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>`
    + `<body style="font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:10vh auto;padding:0 16px;color:#0b0b0b"><h1 style="font-size:1.5rem">${escapeHtml(title)}</h1><p>${body}</p><p><a href="/">← Volver a la tienda</a></p></body></html>`;
}

// ---------------------------------------------------------------------------
// router

async function routeRequest(app, req, res, url) {
  const p = url.pathname;
  const method = req.method;

  // Debug / harness endpoints
  if (p === '/__health') return sendJson(res, 200, { ok: true, theme: app.theme.root, seq: app.errorLog.seq });
  if (p === '/__errors') {
    if (url.searchParams.has('clear')) app.errorLog.clear();
    const since = toInt(url.searchParams.get('since'), 0);
    return sendJson(res, 200, {
      seq: app.errorLog.seq,
      errors: app.errorLog.query({ since, path: url.searchParams.get('path'), kind: url.searchParams.get('kind') }),
    });
  }
  if (p === '/__reset') {
    const params = await readParams(req, url);
    app.cart.reset();
    if (params.cart) app.cart.seed(params.cart);
    if (params.errors) app.errorLog.clear();
    return sendJson(res, 200, { ok: true, seq: app.errorLog.seq, cart: app.cart.json() });
  }

  // Cart API
  if (p === '/cart.js' || p === '/cart.json') return send(res, 200, rewrite(app, JSON.stringify(app.cart.json())), 'application/json; charset=utf-8');
  // Shopify answers /cart/add etc. with JSON when the request is AJAX (Accept JSON / XHR / JSON body).
  const accept = String(req.headers.accept || '');
  const isAjax = /application\/(json|javascript)/.test(accept) || req.headers['x-requested-with'] === 'XMLHttpRequest'
    || /application\/json/.test(String(req.headers['content-type'] || ''));
  if (p === '/cart' && method === 'GET' && /^application\/json/.test(accept)) {
    return send(res, 200, rewrite(app, JSON.stringify(app.cart.json())), 'application/json; charset=utf-8');
  }
  let m = p.match(/^\/cart\/(add|change|update|clear)(\.js|\.json)?$/);
  if (m) {
    if (m[2] || isAjax) {
      if (method !== 'POST' && m[1] !== 'clear') return sendJson(res, 405, { status: 405, message: 'Method not allowed', description: 'Use POST' });
      return cartAjax(app, req, res, url, m[1]);
    }
    return cartForm(app, req, res, url, m[1]);
  }
  if (p === '/cart' && method === 'POST') return cartForm(app, req, res, url, 'cart');

  // Search & recommendations
  if (p === '/search/suggest' || p === '/search/suggest.json') return predictive(app, req, res, url);
  if (p === '/recommendations/products' || p === '/recommendations/products.json') return recommendations(app, req, res, url);
  if ((m = p.match(/^\/products\/([^/]+)\.(js|json)$/))) return productJson(app, res, url, decodeURIComponent(m[1]), m[2] === 'json');

  // Assets, images, fonts
  if (p.startsWith('/assets/')) return serveAsset(app, req, res, url, decodeURIComponent(p.slice('/assets/'.length)));
  if (p.startsWith('/_img/')) return serveImage(app, res, url);
  if (p.startsWith('/_fonts/')) return serveFont(res, url);
  if (p === '/_compiled/styles.css') return send(res, 200, app.theme.compiledAssets().css, MIME['.css']);
  if (p === '/_compiled/scripts.js') return send(res, 200, app.theme.compiledAssets().js, MIME['.js']);
  if ((m = p.match(/^\/_payment\/(.+)\.svg$/))) return send(res, 200, paymentSvg(decodeURIComponent(m[1])), 'image/svg+xml');
  if (p.startsWith('/_files/')) {
    const name = decodeURIComponent(p.slice('/_files/'.length));
    if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name)) {
      return send(res, 200, renderSvg(app.store.registry.generic(`https://cdn.shopify.com/files/${name}`), Object.fromEntries(url.searchParams)), 'image/svg+xml');
    }
    return send(res, 404, 'File not found', 'text/plain; charset=utf-8');
  }
  if (p.startsWith('/_shopify/')) return send(res, 200, '', MIME[path.extname(p)] || 'text/plain; charset=utf-8');
  if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }

  // Non-storefront Shopify routes
  if (p === '/checkout' || p.startsWith('/checkouts')) {
    return send(res, 200, placeholderPage('Checkout (preview local)', 'El checkout real vive en Shopify. En el preview local termina aquí.'));
  }
  if (p === '/account' || p.startsWith('/account/')) {
    return send(res, 200, placeholderPage('Cuenta de cliente (preview local)', 'Las cuentas de cliente son hospedadas por Shopify y no se simulan en el preview.'));
  }
  if (method === 'POST' && (p === '/contact' || p === '/localization' || p === '/password')) {
    const params = await readParams(req, url);
    const back = params.return_to || contextPath(req, {}) || '/';
    if (p !== '/contact') return redirect(res, p === '/password' ? '/' : back);
    const type = params.form_type || 'contact';
    const email = params.contact?.email ?? params.customer?.email ?? params.email;
    const u = new URL(back, url.origin);
    for (const k of ['contact_posted', 'customer_posted', '__form_errors', '__form_type']) u.searchParams.delete(k);
    if (!email) {
      u.searchParams.set('__form_errors', 'email');
      u.searchParams.set('__form_type', type);
    } else {
      u.searchParams.set(type === 'customer' ? 'customer_posted' : 'contact_posted', 'true');
    }
    return redirect(res, `${u.pathname}${u.search}#${type === 'customer' ? 'contact_form' : 'contact_form'}`);
  }

  if (method !== 'GET' && method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
  return servePage(app, req, res, url);
}

export function createHandler(app, { quiet = false } = {}) {
  return async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const seqBefore = app.errorLog.seq;
    try {
      await routeRequest(app, req, res, url);
    } catch (e) {
      console.error(`[preview] ${req.method} ${url.pathname}${url.search}:`, e);
      app.errorLog.add({ kind: 'error', message: `Server exception: ${e.message}`, url: url.pathname + url.search, path: url.pathname, file: null, line: null, count: 1 });
      if (!res.headersSent) send(res, 500, `<pre>${escapeHtml(e.stack || String(e))}</pre>`);
      else res.end();
    }
    if (!quiet && !url.pathname.startsWith('/_') && !url.pathname.startsWith('/assets/')) {
      const newErrors = app.errorLog.seq - seqBefore;
      console.log(`${req.method} ${url.pathname}${url.search} → ${res.statusCode} ${Date.now() - started}ms${newErrors ? ` · ${newErrors} render issue(s)` : ''}`);
    }
  };
}

export function createServer(app, opts = {}) {
  return http.createServer(createHandler(app, opts));
}
