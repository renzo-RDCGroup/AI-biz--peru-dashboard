// Theme / section / block settings: schema defaults merged with stored values, then each value is
// resolved to what Liquid sees on Shopify (image_picker → image, collection → collection drop, …).
import { BaseDrop, collectionDrop, linklistDrop, pageDrop, productDrop, blogDrop, shopImageDrop, ArticleDrop } from './drops.mjs';
import { ColorDrop } from './colors.mjs';

const SHOPIFY_URL_MAP = [
  [/^shopify:\/\/collections\/?$/, () => '/collections'],
  [/^shopify:\/\/collections\/(.+)$/, (m) => `/collections/${m[1]}`],
  [/^shopify:\/\/products\/(.+)$/, (m) => `/products/${m[1]}`],
  [/^shopify:\/\/pages\/(.+)$/, (m) => `/pages/${m[1]}`],
  [/^shopify:\/\/blogs\/(.+)$/, (m) => `/blogs/${m[1]}`],
  [/^shopify:\/\/policies\/(.+)$/, (m) => `/policies/${m[1]}`],
  [/^shopify:\/\/search$/, () => '/search'],
  [/^shopify:\/\/(?:index|home)$/, () => '/'],
];

export function resolveUrl(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value);
  for (const [re, fn] of SHOPIFY_URL_MAP) {
    const m = s.match(re);
    if (m) return fn(m);
  }
  return s;
}

export class FontDrop extends BaseDrop {
  constructor(w, handle) {
    super(w);
    const [fam, variant = 'n4'] = String(handle).split(/_(?=[ni]\d$)/);
    this.handle = String(handle);
    this.family = fam.split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
    this.style = variant.startsWith('i') ? 'italic' : 'normal';
    this.weight = Number(variant.slice(1)) * 100 || 400;
    this.fallback_families = 'sans-serif';
    this.baseline_ratio = 0.2;
    this['system?'] = /^(sans-serif|serif|monospace)/.test(fam);
  }
  get variants() { return [this]; }
  toString() { return this.family; }
}

class VideoUrlDrop extends BaseDrop {
  constructor(w, url) {
    super(w);
    this.url = url;
    let m;
    if ((m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/))) { this.type = 'youtube'; this.id = m[1]; }
    else if ((m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/))) { this.type = 'vimeo'; this.id = m[1]; }
    else { this.type = null; this.id = null; }
  }
  valueOf() { return this.url; }
  toString() { return this.url; }
}

const blank = (v) => v === null || v === undefined || v === '';

/** Resolve one stored/default value according to its setting type. */
export function resolveValue(w, setting, value) {
  const type = setting.type;
  switch (type) {
    case 'checkbox':
      return value === true || value === 'true';
    case 'range':
    case 'number':
      if (blank(value)) return null;
      return Number.isFinite(Number(value)) ? Number(value) : null;
    case 'image_picker':
      if (blank(value)) return null;
      if (typeof value === 'object') return value;
      return shopImageDrop(w, String(value).replace(/^shopify:\/\/(shop_images|files)\//, ''));
    case 'collection':
      if (blank(value)) return null;
      return collectionDrop(w, String(value)) || null;
    case 'collection_list':
      return (Array.isArray(value) ? value : []).map((h) => collectionDrop(w, h)).filter(Boolean);
    case 'product':
      if (blank(value)) return null;
      return productDrop(w, w.store.product(String(value)));
    case 'product_list':
      return (Array.isArray(value) ? value : []).map((h) => productDrop(w, w.store.product(h))).filter(Boolean);
    case 'link_list':
      if (blank(value)) return null;
      return linklistDrop(w, String(value));
    case 'page':
      if (blank(value)) return null;
      return pageDrop(w, w.store.page(String(value)));
    case 'blog':
      if (blank(value)) return null;
      return blogDrop(w, w.store.blog(String(value)));
    case 'article': {
      if (blank(value)) return null;
      const [b, a] = String(value).split('/');
      const art = w.store.blog(b)?.articles.find((x) => x.handle === a);
      return art ? new ArticleDrop(w, art) : null;
    }
    case 'url':
      return resolveUrl(value);
    case 'color':
      if (blank(value)) return null;
      return new ColorDrop(value);
    case 'color_scheme':
      if (blank(value)) return null;
      return w.colorSchemes?.[value] || null;
    case 'font_picker':
      if (blank(value)) return null;
      return new FontDrop(w, value);
    case 'video_url':
      if (blank(value)) return null;
      return new VideoUrlDrop(w, String(value));
    case 'video':
    case 'metaobject':
      return blank(value) ? null : null;
    case 'metaobject_list':
      return [];
    case 'richtext':
    case 'inline_richtext':
    case 'html':
    case 'liquid':
    case 'text':
    case 'textarea':
    case 'select':
    case 'radio':
    case 'text_alignment':
    case 'color_background':
    default:
      if (blank(value)) return null;
      return typeof value === 'string' ? value : value;
  }
}

/** Merge defaults with stored values; returns { settings, liquidKeys } */
export function resolveSettings(w, schemaSettings, stored) {
  const out = {};
  const liquidKeys = [];
  const values = stored && typeof stored === 'object' ? stored : {};
  for (const s of schemaSettings || []) {
    if (!s || !s.id) continue;
    const raw = Object.prototype.hasOwnProperty.call(values, s.id) ? values[s.id] : s.default;
    out[s.id] = resolveValue(w, s, raw);
    if (s.type === 'liquid' && out[s.id]) liquidKeys.push(s.id);
  }
  // Like Shopify, stored values without a schema entry are ignored (they'd be nil in production).
  return { settings: out, liquidKeys };
}

/**
 * Preview-only per-request overrides: `?__settings=whatsapp_number:51900000000,cart_type:page`
 * (comma-separated id:value pairs; values are typed by the schema like stored values).
 */
export function settingsOverrides(query) {
  const raw = query && query.get ? query.get('__settings') : null;
  const out = {};
  if (!raw) return out;
  for (const pair of raw.split(',')) {
    const i = pair.indexOf(':');
    if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1);
  }
  return out;
}

/** Global `settings` object from config/settings_schema.json + settings_data.json. */
export function themeSettings(w) {
  const { schema, error: schemaError } = w.theme.settingsSchema();
  const data = w.theme.settingsData();
  const dataError = data.error;
  const current = { ...(data.current || {}), ...settingsOverrides(w.query) };
  if (schemaError) w.errors.error(schemaError, { file: 'config/settings_schema.json' });
  if (dataError) w.errors.error(dataError, { file: 'config/settings_data.json' });
  const all = schema.flatMap((g) => (Array.isArray(g.settings) ? g.settings : []));

  // color_scheme_group → settings.color_schemes
  const group = all.find((s) => s.type === 'color_scheme_group');
  if (group) {
    const stored = current[group.id] || {};
    const schemes = {};
    for (const [id, sch] of Object.entries(stored)) {
      const colorDefs = group.definition || [];
      const { settings } = resolveSettings(w, colorDefs, sch.settings || {});
      schemes[id] = { id, settings };
    }
    w.colorSchemes = schemes;
  }
  const { settings } = resolveSettings(w, all.filter((s) => s.type !== 'color_scheme_group'), current);
  if (group) settings[group.id] = w.colorSchemes;
  const known = new Set(all.map((s) => s.id).filter(Boolean));
  for (const k of Object.keys(current)) {
    if (!known.has(k) && !['sections', 'content_for_index', 'blocks', 'checkout_logo_image'].includes(k)) {
      w.errors.warn(`settings_data.json has "${k}" but settings_schema.json does not define it (nil on Shopify)`, { file: 'config/settings_data.json' });
    }
  }
  return settings;
}
