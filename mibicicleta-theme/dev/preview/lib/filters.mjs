// Shopify Liquid filters implemented on top of liquidjs.
// Every filter receives (input, positional[], named{}, world) through `define()`, which splits
// liquidjs' argv into positional values and `key: value` pairs using the parsed filter token.
import crypto from 'node:crypto';
import { Drop, toValue } from 'liquidjs';
import { adjustHsl, brightness, contrast, formatColor, mix, modify, parseColor, toHex, toHslString, toRgbString } from './colors.mjs';
import { describeError } from './errors.mjs';
import { outputSize, paymentSvg, placeholderSvg } from './images.mjs';
import { ArticleDrop, CollectionDrop, ImageDrop, LineItemDrop, ProductDrop, VariantDrop, shopImageDrop } from './drops.mjs';
import { FontDrop } from './settings.mjs';
import { escapeAttr, escapeHtml, formatMoney, handleize, isPlainObject } from './util.mjs';
import { worldOf } from './world.mjs';

const DEFAULT_SRCSET_WIDTHS = [352, 832, 1200, 1920, 2880, 3840];

const str = (v) => {
  v = toValue(v);
  return v === null || v === undefined ? '' : String(v);
};

function locOf(filterThis) {
  const { file, line, col } = describeError({ message: '' }, filterThis.token);
  return { file, line, col };
}

// ---------------------------------------------------------------------------
// images

/** Resolve anything image-like (drop, media, product, variant, URL string) to an image target. */
function imageTarget(w, input) {
  input = input instanceof Drop ? input : toValue(input);
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof ImageDrop) return { entry: input.entry || w.registry.fromCdn(input.src), alt: input.alt, drop: input };
  if (input instanceof ProductDrop) return input.featured_image ? imageTarget(w, input.featured_image) : null;
  if (input instanceof VariantDrop) return imageTarget(w, input.featured_image || input.product.featured_image);
  if (input instanceof CollectionDrop) return input.image ? imageTarget(w, input.image) : null;
  if (input instanceof LineItemDrop) return input.image ? imageTarget(w, input.image) : null;
  if (input instanceof ArticleDrop) return input.image ? imageTarget(w, input.image) : null;
  if (typeof input === 'object' && input.preview_image) return imageTarget(w, input.preview_image);
  if (typeof input === 'object' && input.src) return imageTarget(w, input.src);
  const s = String(input);
  if (s.startsWith('shopify://shop_images/')) return imageTarget(w, shopImageDrop(w, s.slice('shopify://shop_images/'.length)));
  if (/cdn\.shopify\.com/.test(s)) return { entry: w.registry.fromCdn(s), alt: '' };
  const local = w.registry.fromLocalPath(s.split('?')[0]);
  if (local) return { entry: local, alt: '' };
  return { url: s, alt: '' };
}

function imageUrl(w, input, named) {
  const t = imageTarget(w, input);
  if (!t) return null;
  const params = { width: named.width, height: named.height, crop: named.crop, format: named.format, pad_color: named.pad_color };
  if (t.entry) return w.registry.localUrl(t.entry, params);
  const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return qs ? `${t.url}${t.url.includes('?') ? '&' : '?'}${qs}` : t.url;
}

function parseImgUrlSize(size) {
  if (!size || size === 'master' || size === 'original') return {};
  const legacy = { pico: 16, icon: 32, thumb: 50, small: 100, compact: 160, medium: 240, large: 480, grande: 600 };
  if (legacy[size]) return { width: legacy[size], height: legacy[size] };
  const m = String(size).match(/^(\d*)x(\d*)$/);
  if (!m) return {};
  return { width: m[1] ? Number(m[1]) : undefined, height: m[2] ? Number(m[2]) : undefined };
}

function imageTag(w, input, named, loc) {
  const src = str(input);
  if (!src) {
    w?.errors.warn('image_tag: input is blank', loc);
    return '';
  }
  const url = new URL(src.replace(/&amp;/g, '&'), 'http://local');
  const params = Object.fromEntries(url.searchParams);
  const entry = w.registry.fromLocalPath(url.pathname);
  const size = entry ? outputSize(entry, params) : { width: Number(params.width) || null, height: Number(params.height) || null };
  const width = named.width ?? size.width;
  const height = named.height ?? size.height;
  const attrs = [['src', src]];
  const alt = named.alt ?? (entry && entry.kind === 'product' ? entry.title : '');
  attrs.push(['alt', alt]);
  if (named.srcset !== null && entry) {
    const maxW = entry.width;
    const baseWidth = size.width || maxW;
    let widths;
    if (named.widths) {
      widths = String(named.widths).split(',').map((x) => parseInt(x, 10)).filter((x) => x > 0 && x <= maxW);
    } else {
      widths = DEFAULT_SRCSET_WIDTHS.filter((x) => x < baseWidth);
      widths.push(baseWidth);
    }
    widths = [...new Set(widths)].sort((a, b) => a - b);
    const ratio = size.height && size.width ? size.height / size.width : null;
    const cropped = params.crop && params.height;
    const set = widths.map((wd) => {
      const u = new URL(url);
      u.searchParams.set('width', String(wd));
      if (cropped && ratio) u.searchParams.set('height', String(Math.round(wd * ratio)));
      return `${u.pathname}${u.search} ${wd}w`;
    });
    if (set.length) attrs.push(['srcset', set.join(', ')]);
  }
  if (width) attrs.push(['width', width]);
  if (height) attrs.push(['height', height]);
  for (const [k, v] of Object.entries(named)) {
    if (['alt', 'width', 'height', 'widths', 'srcset', 'preload'].includes(k)) continue;
    if (v === null || v === undefined || v === false) continue;
    attrs.push([k, v === true ? '' : v]);
  }
  return `<img ${attrs.map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ')}>`;
}

// ---------------------------------------------------------------------------
// translations

function lookupKey(obj, key) {
  let node = obj;
  for (const part of String(key).split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

function translate(w, key, named, loc) {
  const k = str(key);
  let val = lookupKey(w.locale, k);
  if (val !== null && typeof val === 'object') {
    if (named.count !== undefined) {
      const c = Number(toValue(named.count));
      val = (c === 0 && val.zero !== undefined) ? val.zero
        : (c === 1 && val.one !== undefined) ? val.one
          : val.other ?? val.many ?? val.one;
    } else {
      w.errors.error(`Translation for "${k}" is a pluralization object but no count: was given`, loc);
      return k;
    }
  }
  if (typeof val !== 'string') {
    w.errors.error(`Translation missing: es.${k}`, loc);
    return k;
  }
  const raw = /(^|[._])html$/.test(k);
  return val.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (m, name) => {
    if (!(name in named)) return m;
    const v = str(named[name]);
    return raw ? v : escapeHtml(v);
  });
}

// ---------------------------------------------------------------------------
// misc helpers

function shopifyJson(value) {
  const seen = new WeakSet();
  const json = JSON.stringify(value === undefined ? null : value, function replacer(key, v) {
    if (v && typeof v === 'object') {
      if (seen.has(v) && !(v instanceof Drop)) return undefined;
      if (typeof v.toJSON !== 'function' && !Array.isArray(v) && !isPlainObject(v)) {
        if (v instanceof Drop) {
          const out = {};
          for (const [k, x] of Object.entries(v)) if (!k.startsWith('_')) out[k] = x;
          return out;
        }
      }
      seen.add(v);
    }
    return v;
  });
  return (json ?? 'null')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const DATE_FORMATS = {
  abbreviated_date: '%d %b %Y',
  basic: '%d/%m/%Y',
  date: '%-d de %B de %Y',
  date_at_time: '%-d de %B de %Y a las %H:%M',
  default: '%a, %d %b %Y %H:%M:%S %z',
  on_date: 'el %-d de %B de %Y',
  short: '%d %b',
  long: '%-d de %B de %Y %H:%M',
  month_day_year: '%B %d, %Y',
};

function highlightHtml(html, terms) {
  const words = str(terms).split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return html;
  const re = new RegExp(`(${words.join('|')})`, 'gi');
  return str(html).split(/(<[^>]+>)/).map((part) => (part.startsWith('<') ? part : part.replace(re, '<strong class="highlight">$1</strong>'))).join('');
}

function formatAddress(addr) {
  if (!addr || typeof addr !== 'object') return '';
  const pick = (k) => str(addr[k]);
  const lines = [
    [pick('first_name'), pick('last_name')].filter(Boolean).join(' ') || pick('name'),
    pick('company'),
    pick('address1'),
    pick('address2'),
    [pick('city'), pick('province_code') || pick('province'), pick('zip')].filter(Boolean).join(' '),
    pick('country'),
  ].filter(Boolean);
  return `<p>${lines.map(escapeHtml).join('<br>')}</p>`;
}

function fontCss(font, named) {
  const fam = font instanceof FontDrop ? font.family : str(font);
  const display = named.font_display ? `\n  font-display: ${named.font_display};` : '';
  // No network in the preview: resolve to locally installed faces (the page CSS falls back anyway).
  return `@font-face {\n  font-family: "${fam}";\n  font-weight: ${font?.weight ?? 400};\n  font-style: ${font?.style ?? 'normal'};${display}\n  src: local("${fam}");\n}`;
}

function productStructuredData(p) {
  const v = p.selected_or_first_available_variant;
  const data = {
    '@context': 'http://schema.org/',
    '@type': 'Product',
    name: p.title,
    url: p.url,
    image: p.featured_image ? [p.featured_image.src] : [],
    description: str(p.description).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    sku: v?.sku || undefined,
    brand: { '@type': 'Brand', name: p.vendor },
    offers: p.variants.map((x) => ({
      '@type': 'Offer',
      availability: x.available ? 'http://schema.org/InStock' : 'http://schema.org/OutOfStock',
      price: (x.price / 100).toFixed(2),
      priceCurrency: 'PEN',
      url: x.url,
      sku: x.sku || undefined,
    })),
  };
  return `<script type="application/ld+json">${shopifyJson(data)}</script>`;
}

// ---------------------------------------------------------------------------

export function registerFilters(engine) {
  const { liquid, app } = engine;
  const builtinDate = liquid.filters.date;

  const define = (names, fn) => {
    for (const name of [].concat(names)) {
      liquid.registerFilter(name, function shopifyFilter(input, ...argv) {
        const positional = [];
        const named = {};
        const tokens = this.token?.args || [];
        argv.forEach((arg, i) => {
          if (Array.isArray(tokens[i])) named[arg[0]] = arg[1];
          else positional.push(arg);
        });
        const w = worldOf(this.context);
        return fn.call(this, input, positional, named, w);
      });
    }
  };

  // --- money ---------------------------------------------------------------
  const money = (fmtKey) => (input, p, n, w) => formatMoney(toValue(input), (w?.store.shop || app.store.shop)[fmtKey]);
  define('money', money('money_format'));
  define('money_with_currency', money('money_with_currency_format'));
  define('money_without_currency', (input) => formatMoney(toValue(input), '{{amount}}'));
  define('money_without_trailing_zeros', (input, p, n, w) => {
    const out = formatMoney(toValue(input), (w?.store.shop || app.store.shop).money_format);
    return out.replace(/[.,]00(?=\D*$)/, '');
  });

  // --- translations --------------------------------------------------------
  define(['t', 'translate'], function t(input, p, named, w) {
    if (!w) return str(input);
    return translate(w, input, named, locOf(this));
  });

  // --- assets / urls -------------------------------------------------------
  define('asset_url', function assetUrl(input, p, n, w) {
    const name = str(input);
    const theme = w?.theme || app.theme;
    const st = theme.stat(`assets/${name}`) || theme.stat(`assets/${name}.liquid`);
    if (!st && w) w.errors.warn(`asset_url: assets/${name} does not exist`, locOf(this));
    return `/assets/${name}?v=${st ? Math.floor(st.mtimeMs) : 0}`;
  });
  define('asset_img_url', (input, p) => {
    const size = parseImgUrlSize(p[0]);
    const qs = size.width ? `&width=${size.width}` : '';
    return `/assets/${str(input)}?v=1${qs}`;
  });
  define('file_url', (input) => `/_files/${encodeURIComponent(str(input))}`);
  define('file_img_url', (input, p) => {
    const size = parseImgUrlSize(p[0]);
    return `/_files/${encodeURIComponent(str(input))}${size.width ? `?width=${size.width}` : ''}`;
  });
  define('shopify_asset_url', (input) => `/_shopify/${str(input)}`);
  define('global_asset_url', (input) => `/_shopify/global/${str(input)}`);
  define('image_url', function imageUrlFilter(input, p, named, w) {
    const url = imageUrl(w, input, named);
    if (url === null) {
      w?.errors.warn('image_url: input is nil/blank', locOf(this));
      return '';
    }
    return url;
  });
  define('image_tag', function imageTagFilter(input, p, named, w) { return imageTag(w, input, named, locOf(this)); });
  define('img_url', (input, p, named, w) => {
    const size = parseImgUrlSize(p[0]);
    return imageUrl(w, input, { ...size, crop: named.crop }) || '';
  });
  define('img_tag', (input, p) => `<img src="${escapeAttr(str(input))}" alt="${escapeAttr(p[0] ?? '')}"${p[1] ? ` class="${escapeAttr(p[1])}"` : ''}>`);
  define('stylesheet_tag', (input, p, named) => `<link href="${escapeAttr(str(input))}" rel="stylesheet" type="text/css" media="${escapeAttr(named.media || 'all')}" />`);
  define('script_tag', (input) => `<script src="${escapeAttr(str(input))}" type="text/javascript"></script>`);
  define('preload_tag', (input, p, named) => `<link href="${escapeAttr(str(input))}" rel="preload" as="${escapeAttr(named.as || '')}">`);
  define('placeholder_svg_tag', (input, p) => placeholderSvg(str(input), p[0] ? str(p[0]) : ''));
  define('payment_type_svg_tag', (input, p, named) => paymentSvg(str(input), named.class ?? 'icon icon--full-color'));
  define('payment_type_img_url', (input) => `/_payment/${encodeURIComponent(str(input))}.svg`);
  define('inline_asset_content', function inlineAsset(input, p, n, w) {
    const name = str(input);
    const text = (w?.theme || app.theme).read(`assets/${name}`);
    if (text === null) { w?.errors.error(`inline_asset_content: assets/${name} not found`, locOf(this)); return ''; }
    return text;
  });

  define('link_to', (input, p) => `<a href="${escapeAttr(str(p[0]))}"${p[1] ? ` title="${escapeAttr(p[1])}"` : ''}>${str(input)}</a>`);
  define('url_for_type', (input) => `/collections/types?q=${encodeURIComponent(str(input))}`);
  define('url_for_vendor', (input) => `/collections/vendors?q=${encodeURIComponent(str(input))}`);
  define('link_to_type', (input) => `<a href="/collections/types?q=${encodeURIComponent(str(input))}" title="${escapeAttr(str(input))}">${str(input)}</a>`);
  define('link_to_vendor', (input) => `<a href="/collections/vendors?q=${encodeURIComponent(str(input))}" title="${escapeAttr(str(input))}">${str(input)}</a>`);
  const collectionBase = (w) => (w?.globals.collection ? w.globals.collection.url : '/collections/all');
  define('link_to_tag', (input, p, n, w) => `<a href="${collectionBase(w)}/${handleize(input)}" title="Mostrar productos con la etiqueta ${escapeAttr(str(input))}">${str(input)}</a>`);
  define('link_to_add_tag', (input, p, n, w) => {
    const tags = [...(w?.currentTags || []), handleize(input)];
    return `<a href="${collectionBase(w)}/${tags.join('+')}" title="Mostrar productos con la etiqueta ${escapeAttr(str(input))}">${str(input)}</a>`;
  });
  define('link_to_remove_tag', (input, p, n, w) => {
    const tags = (w?.currentTags || []).filter((t) => t !== handleize(input));
    return `<a href="${collectionBase(w)}${tags.length ? `/${tags.join('+')}` : ''}" title="Quitar etiqueta ${escapeAttr(str(input))}">${str(input)}</a>`;
  });
  define('highlight_active_tag', (input, p, n, w) => ((w?.currentTags || []).includes(handleize(input)) ? `<span class="active">${str(input)}</span>` : str(input)));
  define('within', (input, p) => {
    const col = p[0];
    const handle = col?.handle ?? (typeof col === 'string' ? col : null);
    const url = str(input);
    return handle ? `/collections/${handle}${url.startsWith('/') ? url : `/${url}`}` : url;
  });
  define('sort_by', (input, p) => {
    const u = new URL(str(input), 'http://local');
    u.searchParams.set('sort_by', str(p[0]));
    return `${u.pathname}${u.search}`;
  });
  define('url_escape', (input) => encodeURI(str(input)).replace(/%25([0-9A-F]{2})/g, '%$1'));
  define('url_param_escape', (input) => encodeURIComponent(str(input)));
  define('customer_login_link', (input) => `<a href="/account/login" id="customer_login_link">${str(input)}</a>`);
  define('customer_logout_link', (input) => `<a href="/account/logout" id="customer_logout_link">${str(input)}</a>`);
  define('customer_register_link', (input) => `<a href="/account/register" id="customer_register_link">${str(input)}</a>`);
  define('login_button', () => '');
  define('avatar', () => '');
  define('payment_terms', () => '');
  define('payment_button', () => '<div data-shopify="payment-button" class="shopify-payment-button"><button class="shopify-payment-button__button shopify-payment-button__button--unbranded" type="button" disabled aria-disabled="true">Comprar ahora</button></div>');
  define('external_video_url', (input) => str(input?.url ?? input));
  define('external_video_tag', (input, p, named) => `<iframe src="${escapeAttr(str(input?.url ?? input))}" class="${escapeAttr(named.class || '')}" title="${escapeAttr(named.title || 'Video')}" allow="autoplay; encrypted-media" allowfullscreen loading="lazy"></iframe>`);
  define('video_tag', (input, p, named) => `<video playsinline="playsinline" preload="metadata"${named.class ? ` class="${escapeAttr(named.class)}"` : ''}></video>`);
  define('media_tag', (input, p, named, w) => imageTag(w, imageUrl(w, input, { width: 1200 }) || '', named, {}));
  define('model_viewer_tag', () => '');

  // --- fonts -----------------------------------------------------------------
  define('font_face', (input, p, named) => (input ? fontCss(input, named) : ''));
  define('font_url', () => '/_fonts/local.css');
  define('font_modify', (input, p, n, w) => {
    if (!(input instanceof FontDrop)) return input;
    const f = new FontDrop(w, input.handle);
    const [prop, value] = [str(p[0]), str(p[1])];
    if (prop === 'weight') {
      if (value === 'bold') f.weight = 700;
      else if (value === 'normal') f.weight = 400;
      else if (value === 'bolder') f.weight = Math.min(900, input.weight + 300);
      else if (value === 'lighter') f.weight = Math.max(100, input.weight - 300);
      else if (/^[+-]\d+$/.test(value)) f.weight = Math.min(900, Math.max(100, input.weight + Number(value)));
      else f.weight = Number(value) || input.weight;
    } else if (prop === 'style') {
      f.style = value;
    }
    return f;
  });

  // --- html helpers --------------------------------------------------------
  define('highlight', (input, p) => highlightHtml(str(input), p[0]));
  define('time_tag', function timeTag(input, p, named) {
    if (input === null || input === undefined || input === '') return '';
    const d = new Date(str(input) === 'now' ? Date.now() : str(input));
    const fmt = named.format ? DATE_FORMATS[named.format] || named.format : (p[0] ? str(p[0]) : '%d %b %Y');
    const text = builtinDate.call(this, str(input), fmt);
    const iso = named.datetime ? builtinDate.call(this, str(input), named.datetime) : (Number.isNaN(d.getTime()) ? str(input) : d.toISOString().replace(/\.\d{3}Z$/, 'Z'));
    return `<time datetime="${escapeAttr(iso)}">${text}</time>`;
  });
  define('date', function date(input, p, named) {
    let fmt = p[0];
    if (named.format) fmt = DATE_FORMATS[named.format] || named.format;
    return builtinDate.call(this, input, fmt ?? '%d %b %Y');
  });
  define('default_pagination', (input, p, named) => {
    const pg = input;
    if (!pg || !pg.parts) return '';
    const prev = named.previous ?? '&laquo; Anterior';
    const next = named.next ?? 'Siguiente &raquo;';
    const out = [];
    if (pg.previous) out.push(`<span class="prev"><a href="${escapeAttr(pg.previous.url)}" title="">${prev}</a></span>`);
    for (const part of pg.parts) {
      if (part.is_link) out.push(`<span class="page"><a href="${escapeAttr(part.url)}" title="">${part.title}</a></span>`);
      else if (String(part.title) === String(pg.current_page)) out.push(`<span class="page current">${part.title}</span>`);
      else out.push(`<span class="deco">${part.title}</span>`);
    }
    if (pg.next) out.push(`<span class="next"><a href="${escapeAttr(pg.next.url)}" title="">${next}</a></span>`);
    return out.join(' ');
  });
  define('default_errors', (input) => {
    const e = input;
    if (!e || !e.messages) return '';
    const items = Object.entries(e.messages).map(([f, m]) => `<li>${escapeHtml(e.translated_fields?.[f] || f)} ${escapeHtml(m)}</li>`).join('');
    return `<div class="errors"><ul>${items}</ul></div>`;
  });
  define('format_address', (input) => formatAddress(input));
  define(['metafield_tag', 'metafield_text'], (input) => {
    const v = input && typeof input === 'object' && 'value' in input ? input.value : input;
    return v === null || v === undefined ? '' : escapeHtml(str(v));
  });
  define('structured_data', (input) => {
    if (input instanceof ProductDrop) return productStructuredData(input);
    if (input instanceof ArticleDrop) {
      return `<script type="application/ld+json">${shopifyJson({ '@context': 'http://schema.org/', '@type': 'Article', headline: input.title, author: input.author, datePublished: input.published_at })}</script>`;
    }
    return '';
  });

  // --- strings / data ------------------------------------------------------
  define(['handleize', 'handle'], (input) => handleize(str(input)));
  define(['camelize', 'camelcase'], (input) => str(input).split(/[^A-Za-z0-9]+/).filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(''));
  define('pluralize', (input, p) => (Number(toValue(input)) === 1 ? str(p[0]) : str(p[1])));
  define('md5', (input) => crypto.createHash('md5').update(str(input)).digest('hex'));
  define('sha1', (input) => crypto.createHash('sha1').update(str(input)).digest('hex'));
  define('sha256', (input) => crypto.createHash('sha256').update(str(input)).digest('hex'));
  define('hmac_sha1', (input, p) => crypto.createHmac('sha1', str(p[0])).update(str(input)).digest('hex'));
  define('hmac_sha256', (input, p) => crypto.createHmac('sha256', str(p[0])).update(str(input)).digest('hex'));
  define('base64_encode', (input) => Buffer.from(str(input), 'utf8').toString('base64'));
  define('base64_decode', (input) => Buffer.from(str(input), 'base64').toString('utf8'));
  define('base64_url_safe_encode', (input) => Buffer.from(str(input), 'utf8').toString('base64url'));
  define('base64_url_safe_decode', (input) => Buffer.from(str(input), 'base64url').toString('utf8'));
  define('json', (input) => shopifyJson(input));
  define('weight_with_unit', (input, p) => {
    const grams = Number(toValue(input)) || 0;
    const unit = str(p[0]) || 'kg';
    const factor = { kg: 1000, g: 1, lb: 453.592, oz: 28.3495 }[unit] || 1000;
    const v = Math.round((grams / factor) * 100) / 100;
    return `${v} ${unit}`;
  });
  define('divided_by', function dividedBy(input, p) {
    const a = Number(toValue(input));
    const b = Number(toValue(p[0]));
    if (b === 0) throw new Error('divided by 0');
    // Ruby semantics: integer ÷ integer floors; a float literal (2.0) forces float division.
    const literal = this.token?.args?.[0]?.getText?.() || '';
    if (Number.isInteger(a) && Number.isInteger(b) && !literal.includes('.')) return Math.floor(a / b);
    return a / b;
  });
  define('item_count_for_variant', (input, p) => {
    const id = String(toValue(p[0]));
    const items = input?.items || [];
    return items.filter((i) => String(i.variant_id) === id).reduce((s, i) => s + i.quantity, 0);
  });
  define('line_items_for', (input, p) => {
    const obj = p[0];
    const items = input?.items || [];
    if (obj instanceof ProductDrop) return items.filter((i) => i.product_id === obj.id);
    if (obj instanceof VariantDrop) return items.filter((i) => i.variant_id === obj.id);
    return [];
  });
  define('visual_preview', (input) => input);

  // --- colors --------------------------------------------------------------
  const color = (fn) => (input, p) => {
    const c = parseColor(input);
    if (!c) return str(input);
    return fn(c, p);
  };
  define('color_to_rgb', color((c) => toRgbString(c)));
  define('color_to_hsl', color((c) => toHslString(c)));
  define('color_to_hex', color((c) => toHex(c)));
  define('color_to_oklch', color((c) => toHex(c)));
  define('color_modify', color((c, p) => formatColor(modify(c, str(p[0]), p[1]))));
  define('color_brightness', color((c) => Math.round(brightness(c) * 10) / 10));
  define('color_extract', color((c, p) => {
    const prop = str(p[0]);
    if (prop === 'red') return Math.round(c.r);
    if (prop === 'green') return Math.round(c.g);
    if (prop === 'blue') return Math.round(c.b);
    if (prop === 'alpha') return c.a;
    const hslStr = toHslString(c).match(/(\d+), (\d+)%, (\d+)%/);
    if (!hslStr) return 0;
    return Number({ hue: hslStr[1], saturation: hslStr[2], lightness: hslStr[3] }[prop] ?? 0);
  }));
  define('color_lighten', color((c, p) => formatColor(adjustHsl(c, 'l', Number(p[0]) || 0))));
  define('color_darken', color((c, p) => formatColor(adjustHsl(c, 'l', -(Number(p[0]) || 0)))));
  define('color_saturate', color((c, p) => formatColor(adjustHsl(c, 's', Number(p[0]) || 0))));
  define('color_desaturate', color((c, p) => formatColor(adjustHsl(c, 's', -(Number(p[0]) || 0)))));
  define('color_mix', color((c, p) => {
    const other = parseColor(p[0]);
    return other ? formatColor(mix(c, other, p[1] ?? 50)) : formatColor(c);
  }));
  define('color_contrast', color((c, p) => {
    const other = parseColor(p[0]);
    return other ? Math.round(contrast(c, other) * 10) / 10 : 0;
  }));
  define('color_difference', color((c, p) => {
    const o = parseColor(p[0]);
    if (!o) return 0;
    return Math.round(Math.max(c.r, o.r) - Math.min(c.r, o.r) + Math.max(c.g, o.g) - Math.min(c.g, o.g) + Math.max(c.b, o.b) - Math.min(c.b, o.b));
  }));
  define('brightness_difference', color((c, p) => {
    const o = parseColor(p[0]);
    return o ? Math.round(Math.abs(brightness(c) - brightness(o))) : 0;
  }));
}
