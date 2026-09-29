#!/usr/bin/env node
// Self-test for the preview harness: renders the fixture theme in selftest/theme through the
// real server and asserts Shopify semantics. Then boots the server against the real theme and
// loads a few pages to make sure nothing crashes.   node selftest.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { groupSectionId, templateSectionId } from './lib/theme.mjs';
import { CHROMIUM_PATH, DEFAULT_MOCK_PATH, DEFAULT_THEME_DIR } from './lib/paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_THEME = path.join(here, 'selftest', 'theme');
const mock = JSON.parse(fs.readFileSync(DEFAULT_MOCK_PATH, 'utf8'));
const byHandle = (h) => mock.products.find((p) => p.handle === h);
const LINTERNA = byHandle('linterna-multifuncional-m29');
const LENTES = byHandle('lentes-deportivos-tornasolado-hm-l1-hm-l1');
const CASCO = byHandle('casco-open-face-mt-33g2');
const V_LINTERNA = LINTERNA.variants[0].id;
const V_LENTES_NEGRO = LENTES.variants.find((v) => v.title === 'Negro').id;
const V_CASCO_SOLDOUT = CASCO.variants.find((v) => !v.available).id;
const V_CASCO_LOWSTOCK = CASCO.variants.find((v) => v.available && v.inventory_policy === 'deny' && v.inventory_quantity === 3).id;

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e });
    console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`);
  }
}

/** Inner HTML of the first element carrying `cls` in its class attribute. */
function pick(html, cls) {
  const re = new RegExp(`<([a-z0-9-]+)[^>]*class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"[^>]*>([\\s\\S]*?)</\\1>`, 'i');
  const m = html.match(re);
  return m ? m[2] : null;
}
function attr(html, cls, name) {
  const re = new RegExp(`<[a-z0-9-]+[^>]*class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"[^>]*>`, 'i');
  const tag = (html.match(re) || [])[0] || '';
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------

console.log('Preview harness self-test (fixture theme)');
const fx = await startServer({ port: 0, theme: FIXTURE_THEME, quiet: true });
const base = fx.url;
const get = async (p, opts = {}) => {
  const r = await fetch(base + p, { redirect: 'manual', ...opts });
  const text = await r.text();
  return { status: r.status, text, headers: r.headers, json: () => JSON.parse(text) };
};
const post = (p, body, type = 'json') => {
  if (type === 'json') return get(p, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) fd.append(k, String(v));
  return get(p, { method: 'POST', body: fd });
};
const errorsSince = async (seq, pathFilter) => {
  const r = await get(`/__errors?since=${seq}${pathFilter ? `&path=${encodeURIComponent(pathFilter)}` : ''}`);
  return r.json().errors;
};

const seq0 = (await get('/__health')).json().seq;
const home = await get('/');
const MAIN_ID = templateSectionId('index.json', 'main');
const ANN_ID = groupSectionId('header-group.json', 'announcement');

await test('home renders with layout, 200, error header set', () => {
  assert.equal(home.status, 200);
  assert.match(home.text, /<main id="MainContent">/);
  assert.ok(Number(home.headers.get('x-render-errors')) >= 4, 'intentional errors counted');
  assert.match(home.text, /data-template="index"/);
  assert.match(home.text, /data-page-type="index"/);
});

await test('Google Fonts link rewritten to /_fonts/local.css; schema not output', () => {
  assert.match(home.text, /href="\/_fonts\/local\.css"/);
  assert.doesNotMatch(home.text, /fonts\.googleapis\.com\/css2/);
  assert.doesNotMatch(home.text, /"name": "Main test"/);
});

await test('template section wrapper id/class (schema class appended)', () => {
  assert.ok(home.text.includes(`<div id="shopify-section-${MAIN_ID}" class="shopify-section main-test-section">`), MAIN_ID);
  assert.equal(attr(home.text, 'main-test', 'data-section'), MAIN_ID);
  assert.equal(attr(home.text, 'main-test', 'data-index'), '1');
});

await test('section group wrapper + location/index; static section reads settings_data', () => {
  assert.ok(home.text.includes(`<div id="shopify-section-${ANN_ID}" class="shopify-section shopify-section-group-header-group">`));
  assert.equal(pick(home.text, 'announcement'), 'Envío gratis · header · 1');
  assert.ok(home.text.includes('<div id="shopify-section-cart-drawer" class="shopify-section">'));
  assert.match(home.text, /data-heading="Tu carrito \(data\)"/);
});

await test('section settings: defaults merged with template values; url/image/collection resolved', () => {
  assert.equal(pick(home.text, 'title'), 'Custom title');
  assert.equal(pick(home.text, 'subtitle'), 'Default subtitle');
  assert.equal(pick(home.text, 'range'), '4');
  assert.equal(pick(home.text, 'empty'), '[]BLANK');
  assert.equal(pick(home.text, 'url'), '/collections/luces');
  assert.equal(pick(home.text, 'img'), '/_img/s/mibi-ia-cascos-lima.png.svg?v=1&amp;width=800'.replace('&amp;', '&'));
  const luces = mock.products.filter((p) => p.collections.includes('luces')).length;
  assert.equal(pick(home.text, 'col'), `Luces y seguridad|${luces}`);
});

await test('blocks follow block_order, defaults applied, disabled blocks skipped', () => {
  assert.equal(pick(home.text, 'blocks'), '<i class="block--note" id="b-b2" >Block default</i><i class="block--note" id="b-b1" >First</i>');
});

await test('render: params, with…as, for…as (forloop), isolation (globals visible, parent vars not)', () => {
  assert.equal(pick(home.text, 'render-params').trim(), '<span class="item">Hola:3</span>');
  assert.equal(pick(home.text, 'render-with').trim(), '<span class="item">W</span>');
  const forHtml = pick(home.text, 'render-for');
  const luces = mock.products.filter((p) => p.collections.includes('luces'));
  assert.ok(forHtml.includes(`${luces[0].title}#1/${luces.length}`), forHtml);
  assert.ok(forHtml.includes(`#${luces.length}/${luces.length}`));
  assert.equal(pick(home.text, 'render-isolation').trim(), '<span class="iso">[]Mi Bicicleta|</span>');
});

await test('unset root variables named size/first/last are nil (not the globals count)', () => {
  assert.equal(pick(home.text, 'magic'), '[][][]|2');
});

await test('fixture products: reachable by handle, with metafields, never listed', async () => {
  assert.equal(pick(home.text, 'fixtures'), 'false|4.6|true');
  const all = await get('/collections/all');
  assert.ok(!all.text.includes('sg-luz-delantera-agotada'), 'fixture product leaked into collections.all');
  const p = await get('/products/sg-grips-ergonomicos-modelos.js');
  assert.equal(p.status, 200);
});

await test('?__settings= overrides theme settings for one request', async () => {
  const r = await get('/?__settings=color_brand:%23000000');
  assert.match(pick(r.text, 'color'), /^#000000\|/);
  assert.match(pick(home.text, 'color'), /^#(?!000000)/i);
});

await test('money filters (S/ 33.00 …)', () => {
  assert.equal(pick(home.text, 'money'), 'S/ 33.00|S/ 33.00 PEN|S/ 33|S/ 33.50|1,234.56');
});

await test('t: interpolation (escaped unless _html), pluralization, missing key recorded', async () => {
  assert.equal(pick(home.text, 't1'), 'Hola &lt;b&gt;Ana&lt;/b&gt;');
  assert.equal(pick(home.text, 't2'), 'Hola <b>Ana</b>');
  assert.equal(pick(home.text, 't3'), '1 producto|3 productos');
  assert.equal(pick(home.text, 't4'), 'general.nope');
  const errs = await errorsSince(seq0, '/');
  assert.ok(errs.some((e) => e.kind === 'error' && /Translation missing: es\.general\.nope/.test(e.message) && e.file === 'sections/main-test.liquid' && e.line), JSON.stringify(errs));
});

await test('misc filters: integer divided_by, unknown filter warning, json escaping, color, handleize', async () => {
  assert.equal(pick(home.text, 'div'), '3|3.5');
  assert.equal(pick(home.text, 'unknown'), 'x');
  const errs = await errorsSince(seq0, '/');
  assert.ok(errs.some((e) => e.kind === 'warning' && /Unknown filter "frobnicate"/.test(e.message)));
  assert.equal(pick(home.text, 'json'), '"\\u003ctag\\u003e"');
  assert.equal(pick(home.text, 'color'), '#ffd219|rgb(255, 210, 25)|rgba(255, 210, 25, 0.5)|255');
  assert.equal(pick(home.text, 'handle'), 'pinones-y-transmision');
});

await test('global lookups: collections.all/handle/size/iteration, all_products, linklists, pages, images', () => {
  const tapa = byHandle('tapa-barro-tp-05');
  const firstTwo = mock.collections.slice(0, 2).map((c) => `${c.handle};`).join('');
  assert.equal(pick(home.text, 'colls'), `${mock.products.length}|Luces y seguridad|${mock.collections.length}|${tapa.title}|${firstTwo}|${mock.menus.footer[0].title}|/pages/contact|1.778`);
});

await test('blank / empty / nil comparisons follow Ruby Liquid', () => {
  assert.equal(pick(home.text, 'blank-sem'), 'GBCNK');
});

await test('global settings: image_picker from shop_images, link_list default', () => {
  assert.equal(pick(home.text, 'settings-img'), '2048x1152');
  assert.equal(pick(home.text, 'menu'), 'Luces(0),Llantas y cámaras(0),Piñones y transmisión(0),Espejos(0),Componentes(4),Accesorios(0),Rockbros(0)');
});

await test('{% style %} renders Liquid inside <style data-shopify>', () => {
  assert.ok(home.text.includes('<style data-shopify>.main-test { --cols: 4; }</style>'));
});

await test('robustness: runtime error inline, syntax error box, missing snippet/section, page continues', async () => {
  assert.equal(pick(home.text, 'br'), 'before Liquid error (sections/broken-runtime.liquid line 1): divided by 0 after');
  assert.match(home.text, /data-preview-error[^>]*><strong[^>]*>Liquid syntax error in sections\/broken-syntax\.liquid/);
  assert.match(pick(home.text, 'ms'), /^Liquid error \(sections\/missing-snippet\.liquid line 1\): Could not find asset snippets\/does-not-exist\.liquid ?ok$/);
  assert.match(home.text, /Missing section file sections\/does-not-exist\.liquid/);
  assert.equal(pick(home.text, 'after-marker'), 'After all');
  const errs = await errorsSince(seq0, '/');
  for (const re of [/divided by 0/, /does-not-exist\.liquid/, /Section file not found/]) assert.ok(errs.some((e) => re.test(e.message)), String(re));
  assert.ok(errs.some((e) => e.file === 'sections/broken-syntax.liquid'), 'syntax error recorded with file');
});

const pPath = `/products/${LINTERNA.handle}`;
const prod = await get(pPath);
const PROD_MAIN = templateSectionId('product.json', 'main');
await test('product: title/price, cdn src rewritten, metafields tolerant', () => {
  assert.equal(prod.status, 200);
  assert.equal(pick(prod.text, 'ptitle'), LINTERNA.title);
  assert.equal(pick(prod.text, 'price'), `S/ ${(LINTERNA.variants[0].price / 100).toFixed(2)}`);
  assert.match(pick(prod.text, 'src'), /^\/_img\/p\/linterna-multifuncional-m29\/1\.svg\?v=1$/);
  assert.equal(pick(prod.text, 'rating'), '[]');
});

await test('image_url + image_tag: srcset/width/height/sizes/loading/class, widths capped at original', () => {
  const img = pick(prod.text, 'img');
  assert.match(img, /^<img src="\/_img\/p\/linterna-multifuncional-m29\/1\.svg\?v=1&amp;width=400" alt="[^"]+" srcset="[^"]*352w, [^"]*400w" width="400" height="400" loading="lazy" sizes="\(min-width: 990px\) 50vw, 100vw" class="pimg">$/, img);
  const img2 = pick(prod.text, 'img-widths');
  assert.match(img2, /srcset="[^"]*width=300 300w, [^"]*width=600 600w"/, img2);
  assert.doesNotMatch(img2, /2000w/);
  assert.match(img2, /width="1000" height="1000"/);
});

await test('form product: Shopify attributes, hidden inputs, product-id + section-id', () => {
  assert.ok(prod.text.includes('<form method="post" action="/cart/add" id="product-form-x" accept-charset="UTF-8" class="pf" enctype="multipart/form-data" novalidate="novalidate" data-type="add-to-cart-form"><input type="hidden" name="form_type" value="product" /><input type="hidden" name="utf8" value="✓" />'));
  assert.ok(prod.text.includes(`<input type="hidden" name="product-id" value="${LINTERNA.id}" /><input type="hidden" name="section-id" value="${PROD_MAIN}" /></form>`));
  assert.equal(pick(prod.text, 'posted'), 'false');
});

await test('product | json has variants and Shopify shape', () => {
  const json = prod.text.match(/data-product-json>([\s\S]*?)<\/script>/)[1];
  const data = JSON.parse(json);
  assert.equal(data.id, LINTERNA.id);
  assert.equal(data.variants[0].id, V_LINTERNA);
  assert.equal(data.price, LINTERNA.variants[0].price);
  assert.ok(Array.isArray(data.media) && data.media[0].media_type === 'image');
});

await test('variants: ?variant= selects, options_with_values selected/available', async () => {
  const r = await get(`/products/${LENTES.handle}?variant=${V_LENTES_NEGRO}`);
  assert.equal(pick(r.text, 'selected'), 'Negro');
  assert.equal(pick(r.text, 'opts'), 'Color:Amarillo/Blanco/Negro*/Rojo Negro');
  const ovId = pick(r.text, 'ov');
  const r2 = await get(`/products/${LENTES.handle}?option_values=${ovId}&section_id=${PROD_MAIN}`);
  assert.equal(pick(r2.text, 'selected'), LENTES.options[0].values[2], 'option_values selects the variant');
  const c = await get(`/products/${CASCO.handle}`);
  assert.match(pick(c.text, 'opts'), /^Color:AZUL BRILLO!\/NEGRO BRILLO \/ BLANCO\*/);
});

await test('Section Rendering API: section_id and sections (template, group, static, missing)', async () => {
  const one = await get(`/?section_id=${MAIN_ID}`);
  assert.equal(one.status, 200);
  assert.ok(one.text.startsWith(`<div id="shopify-section-${MAIN_ID}" class="shopify-section main-test-section">`));
  assert.doesNotMatch(one.text, /<main/);
  const many = await get(`/?sections=${MAIN_ID},cart-drawer,${ANN_ID},nope`);
  const map = many.json();
  assert.deepEqual(Object.keys(map), [MAIN_ID, 'cart-drawer', ANN_ID, 'nope']);
  assert.match(map['cart-drawer'], /^<div id="shopify-section-cart-drawer"/);
  assert.match(map[ANN_ID], /Envío gratis/);
  assert.equal(map.nope, null);
  const p = await get(`${pPath}?section_id=${PROD_MAIN}`);
  assert.match(p.text, new RegExp(`^<div id="shopify-section-${PROD_MAIN}"`));
  assert.equal((await get('/?section_id=nope')).status, 404);
});

await test('cart AJAX: add (JSON items) with sections, FormData add, change by key, update, clear', async () => {
  await get('/__reset');
  const add = await post('/cart/add.js', { items: [{ id: V_LINTERNA, quantity: 2 }], sections: 'cart-drawer', sections_url: '/' });
  assert.equal(add.status, 200, add.text);
  const a = add.json();
  assert.equal(a.items[0].quantity, 2);
  assert.equal(a.items[0].variant_id, V_LINTERNA);
  assert.match(a.sections['cart-drawer'], /<span class="count">2<\/span>/);
  assert.match(a.items[0].image, /^\/_img\/p\//, 'cart JSON images are local');

  const add2 = await post('/cart/add.js', { id: V_LENTES_NEGRO, quantity: 1, sections: `cart-drawer,${MAIN_ID}` }, 'form');
  assert.equal(add2.status, 200, add2.text);
  const b = add2.json();
  assert.equal(b.id, V_LENTES_NEGRO, 'single item response');
  assert.equal(b.quantity, 1);
  assert.match(b.sections['cart-drawer'], /<span class="count">3<\/span>/);
  assert.ok(b.sections[MAIN_ID]);

  const cart = (await get('/cart.js')).json();
  assert.equal(cart.item_count, 3);
  assert.equal(cart.total_price, LINTERNA.variants[0].price * 2 + LENTES.variants[0].price);
  const key = cart.items.find((i) => i.variant_id === V_LINTERNA).key;

  const ch = await post('/cart/change.js', { id: key, quantity: 0, sections: ['cart-drawer'] });
  assert.equal(ch.status, 200);
  assert.equal(ch.json().item_count, 1);
  assert.match(ch.json().sections['cart-drawer'], /<span class="count">1<\/span>/);

  const ch2 = await post('/cart/change.js', { line: 1, quantity: 4 });
  assert.equal(ch2.json().items[0].quantity, 4);

  const up = await post('/cart/update.js', { updates: { [V_LINTERNA]: 2 }, note: 'Hola' });
  assert.equal(up.json().item_count, 6);
  assert.equal(up.json().note, 'Hola');

  const clr = await post('/cart/clear.js', {});
  assert.equal(clr.json().item_count, 0);
});

await test('cart AJAX errors: 422 unknown variant, sold out, over stock (deny)', async () => {
  await get('/__reset');
  const unknown = await post('/cart/add.js', { id: 1234, quantity: 1 });
  assert.equal(unknown.status, 422);
  assert.deepEqual(Object.keys(unknown.json()).sort(), ['description', 'message', 'status']);
  assert.equal(unknown.json().status, 422);
  const sold = await post('/cart/add.js', { id: V_CASCO_SOLDOUT, quantity: 1 });
  assert.equal(sold.status, 422);
  assert.match(sold.json().description, /agotado/);
  const over = await post('/cart/add.js', { id: V_CASCO_LOWSTOCK, quantity: 5 });
  assert.equal(over.status, 422);
  assert.equal((await get('/cart.js')).json().item_count, 0);
});

await test('cart seeding (?__cart=) and cart page / cart form', async () => {
  const r = await get(`/cart?__cart=${V_LINTERNA}:1,${V_LENTES_NEGRO}:2`);
  assert.equal(attr(r.text, 'cartpage', 'data-count'), '3');
  assert.equal(attr(r.text, 'cartpage', 'data-empty'), 'false');
  assert.match(r.text, /<form method="post" action="\/cart" id="cart_form"/);
  const checkout = await post('/cart', { checkout: '', 'updates[]': 1 }, 'form');
  assert.equal(checkout.status, 302);
  assert.equal(checkout.headers.get('location'), '/checkout');
  await get('/__reset');
  const empty = await get('/cart');
  assert.equal(attr(empty.text, 'cartpage', 'data-empty'), 'true');
});

await test('paginate: slices collection.products, parts/next, snippets see paginated drop', async () => {
  const r = await get('/collections/all?page=2');
  const total = mock.products.length;
  assert.equal(attr(r.text, 'pg', 'data-current'), '2');
  assert.equal(attr(r.text, 'pg', 'data-pages'), String(Math.ceil(total / 2)));
  assert.equal(attr(r.text, 'pg', 'data-items'), String(total));
  assert.equal((pick(r.text, 'products').match(/<li/g) || []).length, 2);
  assert.equal(pick(r.text, 'next'), '/collections/all?page=3');
  assert.equal(pick(r.text, 'snippet-sees'), '2');
  assert.match(pick(r.text, 'pg'), /<a href="\/collections\/all\?page=1">1<\/a><span>2<\/span>/);
  assert.match(pick(r.text, 'default-pagination'), /<span class="page current">2<\/span>/);
  assert.equal(pick(r.text, 'pg-current'), '2', 'part.title must be an integer (== paginate.current_page)');
});

await test('collection filters + sort: vendor filter, price-ascending, counts, active values', async () => {
  const r = await get('/collections/all?filter.p.vendor=Rockbros&sort_by=price-ascending');
  const rockbros = mock.products.filter((p) => p.vendor === 'Rockbros');
  assert.equal(attr(r.text, 'coll', 'data-count'), String(rockbros.length));
  assert.equal(attr(r.text, 'coll', 'data-all'), String(mock.products.length));
  assert.equal(attr(r.text, 'coll', 'data-sort'), 'price-ascending');
  const prices = [...r.text.matchAll(/data-price="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  assert.match(r.text, /<span data-v="Rockbros" data-count="\d+" data-active="true">Rockbros<\/span>/);
  assert.match(r.text, /data-param="filter\.v\.availability" data-type="boolean"><span data-v="1" data-count="\d+" data-active="false">Disponible<\/span><span data-v="0"/);
  assert.match(r.text, /data-param="filter\.v\.price" data-type="price_range">.*<span class="max">\d+<\/span>/);
  const colors = await get('/collections/all?filter.v.option.color=Negro');
  assert.equal(attr(colors.text, 'coll', 'data-count'), '1');
  assert.match(colors.text, /data-v="Negro" data-count="1" data-active="true" data-swatch="#111111"/);
  const oos = await get('/collections/all?filter.v.availability=0');
  assert.equal(attr(oos.text, 'coll', 'data-count'), '1');
  const pr = await get('/collections/all?filter.v.price.gte=50&filter.v.price.lte=100');
  const inRange = mock.products.filter((p) => p.variants.some((v) => v.price >= 5000 && v.price <= 10000)).length;
  assert.equal(attr(pr.text, 'coll', 'data-count'), String(inRange));
});

await test('linklists: link.active on the current collection', async () => {
  const r = await get('/collections/luces');
  assert.equal(pick(r.text, 'active-link'), 'Luces');
});

await test('search: results, results_count, empty search', async () => {
  const r = await get('/search?q=luz');
  assert.equal(attr(r.text, 'search', 'data-terms'), 'luz');
  assert.ok(Number(attr(r.text, 'search', 'data-count')) > 0);
  assert.match(pick(r.text, 'search'), /data-type="product">Luz/);
  const e = await get('/search?q=zzzz');
  assert.equal(attr(e.text, 'search', 'data-count'), '0');
  assert.equal(attr(e.text, 'search', 'data-performed'), 'true');
});

await test('predictive search: section_id=predictive-search + JSON', async () => {
  const r = await get('/search/suggest?q=luz&resources[type]=product,collection,query&resources[limit]=4&section_id=predictive-search');
  assert.equal(r.status, 200);
  assert.match(r.text, /^<div id="shopify-section-predictive-search" class="shopify-section">/);
  assert.equal(attr(r.text, 'ps', 'data-terms'), 'luz');
  assert.ok((r.text.match(/class="ps-p"/g) || []).length > 0);
  assert.match(r.text, /<mark class="predictive-search__highlight">luz<\/mark>/);
  const j = (await get('/search/suggest.json?q=luz&resources[type]=product')).json();
  assert.ok(j.resources.results.products.length > 0);
});

await test('recommendations: section rendered with recommendations object', async () => {
  const id = templateSectionId('product.json', 'related');
  const r = await get(`/recommendations/products?product_id=${LINTERNA.id}&limit=4&intent=related&section_id=${id}`);
  assert.equal(r.status, 200);
  assert.equal(attr(r.text, 'recs', 'data-intent'), 'related');
  assert.ok(Number(attr(r.text, 'recs', 'data-count')) > 0);
  assert.doesNotMatch(pick(r.text, 'recs'), new RegExp(`>${LINTERNA.handle}<`));
  const j = (await get(`/recommendations/products.json?product_id=${LINTERNA.id}&limit=2`)).json();
  assert.equal(j.products.length, 2);
});

await test('contact form: posted_successfully?, POST /contact redirect, simulated errors', async () => {
  const r = await get('/pages/contact');
  assert.match(r.text, /<form method="post" action="\/contact#contact_form" id="contact_form" accept-charset="UTF-8" class="contact-form"><input type="hidden" name="form_type" value="contact" \/>/);
  assert.equal(pick(r.text, 'posted'), 'false');
  assert.equal(pick((await get('/pages/contact?contact_posted=true')).text, 'posted'), 'true');
  const errs = await get('/pages/contact?__form=errors');
  assert.match(errs.text, /<div class="errors"><ul><li>Correo electrónico no es válido\.<\/li><\/ul><\/div>/);
  const postR = await get('/contact', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', referer: `${base}/pages/contact` }, body: 'form_type=contact&contact%5Bemail%5D=a%40b.pe' });
  assert.equal(postR.status, 302);
  assert.equal(postR.headers.get('location'), '/pages/contact?contact_posted=true#contact_form');
});

await test('404 status for unknown paths, /password uses password layout, {% layout none %}', async () => {
  const nf = await get('/nope');
  assert.equal(nf.status, 404);
  assert.equal(pick(nf.text, 'nf'), '404 404');
  const pw = await get('/password');
  assert.match(pw.text, /class="password-layout"/);
  assert.match(pw.text, /action="\/password" id="login_form"/);
  const raw = await get('/pages/contact?view=raw');
  assert.equal(raw.text.trim(), 'RAW PAGE Contact');
});

await test('paginate over the global collections drop', async () => {
  const r = await get('/collections?page=1');
  const n = mock.collections.length;
  assert.equal(attr(r.text, 'lc', 'data-items'), String(n));
  assert.equal(attr(r.text, 'lc', 'data-pages'), String(Math.ceil(n / 5)));
  assert.equal((pick(r.text, 'lc').match(/<span>/g) || []).length, 5);
});

await test('static endpoints: placeholder images (width params), fonts, assets', async () => {
  const s = await get('/_img/s/mibi-ia-luces-lima-anochecer.png.svg?v=1&width=600');
  assert.equal(s.headers.get('content-type'), 'image/svg+xml');
  assert.match(s.text, /^<svg[^>]+width="600" height="338"/);
  assert.match(s.text, /data:image\/jpeg;base64,/);
  const p = await get('/_img/p/linterna-multifuncional-m29/2.svg?v=1&width=300&height=400&crop=center');
  assert.match(p.text, /^<svg[^>]+width="300" height="400"/);
  const css = await get('/_fonts/local.css');
  assert.equal(css.status, 200);
  const fontUrl = css.text.match(/url\(([^)]+)\)/)[1];
  const font = await fetch(`${base}/_fonts/${fontUrl}`);
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  assert.equal((await get('/assets/base.css')).status, 200);
  assert.equal((await get('/assets/nope.css')).status, 404);
});

fx.server.close();

// ---------------------------------------------------------------------------
if (process.argv.includes('--no-browser') || !fs.existsSync(CHROMIUM_PATH)) {
  console.log('\nBrowser phase skipped (--no-browser or Chromium missing)');
} else {
  console.log('\nshoot.mjs against the fixture theme (interaction states, browser → AJAX → sections)');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-selftest-'));
  const port = 4300 + Math.floor(Math.random() * 600);
  const run = spawnSync(process.execPath, [path.join(here, 'shoot.mjs'), '--theme', FIXTURE_THEME, '--port', String(port), '--out', out,
    '--pages', 'product,cart-drawer,cart-drawer-empty,menu-drawer,predictive,filters-drawer,variant-switch', '--vp', 'mobile,desktop'], { encoding: 'utf8', timeout: 240000 });
  let report = null;
  try { report = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')); } catch { /* checked below */ }
  await test('shoot.mjs ran and wrote report.json', () => {
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.ok(report, 'report.json missing');
  });
  if (report) {
    const states = report.pages.filter((r) => r.kind === 'state');
    await test('all interaction states reached (cart drawer via AJAX add, empty drawer, menu, predictive, filters, variant)', () => {
      assert.equal(states.length, 10);
      const missed = states.filter((r) => !r.reached).map((r) => `${r.name}-${r.vp}: ${r.reason}`);
      assert.deepEqual(missed, []);
      for (const r of states) assert.ok(r.file && fs.existsSync(path.join(out, r.file)), `screenshot for ${r.name}-${r.vp}`);
    });
    await test('no console errors / page errors / failed requests in fixture captures', () => {
      const bad = report.pages.filter((r) => r.consoleErrors.length || r.pageErrors.length || r.failedRequests.length)
        .map((r) => `${r.name}-${r.vp}: ${JSON.stringify([r.consoleErrors, r.pageErrors, r.failedRequests])}`);
      assert.deepEqual(bad, []);
    });
    await test('variant switch updated the URL (?variant=) and mobile has no horizontal overflow', () => {
      for (const r of states.filter((x) => x.name === 'variant-switch')) assert.match(r.urlAfter || '', /[?&]variant=\d+/);
      const overflow = report.pages.filter((r) => r.overflow?.overflowing).map((r) => `${r.name}: ${r.overflow.offenders.join('; ')}`);
      assert.deepEqual(overflow, []);
    });
  }
  if (!process.argv.includes('--keep')) fs.rmSync(out, { recursive: true, force: true });
  else console.log(`      (screenshots kept in ${out})`);
}

// ---------------------------------------------------------------------------
console.log('\nReal theme smoke test');
const real = await startServer({ port: 0, theme: DEFAULT_THEME_DIR, quiet: true });
for (const p of ['/', '/collections/luces', '/collections/all?filter.p.vendor=Rockbros&sort_by=price-ascending', `/products/${LINTERNA.handle}`, '/cart', '/search?q=luz', '/pages/contact', '/nope', '/password', '/_styleguide']) {
  await test(`real theme ${p} renders without crashing`, async () => {
    const r = await fetch(real.url + p);
    const text = await r.text();
    assert.ok(r.status === 200 || r.status === 404, `status ${r.status}`);
    assert.ok(text.length > 0);
    console.log(`      → ${r.status}, ${text.length} bytes, render errors: ${r.headers.get('x-render-errors')}, warnings: ${r.headers.get('x-render-warnings')}`);
  });
}
real.server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
