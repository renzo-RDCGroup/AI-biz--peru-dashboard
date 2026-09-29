// Image registry + local placeholder generation.
//
// * Product images (cdn.shopify.com URLs in the mock) → deterministic SVG: soft surface background,
//   a product-type icon and the product title (served at /_img/p/<handle>/<pos>.svg).
// * Shop images (shopify://shop_images/<name>, collection images) → 16:9 SVG wrapper around one of
//   the stand-in brand photos in .cache/img (served at /_img/s/<name>.svg).
// * Anything else from cdn.shopify.com → neutral generic placeholder (/_img/x/<hash>.svg).
// Width / height / crop query params are honoured so srcset candidates have the right intrinsic size.
import fs from 'node:fs';
import path from 'node:path';
import { PHOTOS_DIR } from './paths.mjs';
import { escapeHtml, hashInt, normalizeText } from './util.mjs';

export const PRODUCT_IMAGE_SIZE = { width: 1600, height: 1600 };
export const SHOP_IMAGE_SIZE = { width: 2048, height: 1152 };

const CDN_RE = /(?:https?:)?\/\/cdn\.shopify\.com\/[^\s"'()<>\\,]+/g;

// 24×24 stroke icons (copied from the theme's snippets/icon.liquid where it has the same name).
const ICONS = {
  light: '<path d="M10 6.5C6.1 6.5 3 9 3 12s3.1 5.5 7 5.5a1.5 1.5 0 0 0 1.5-1.5V8A1.5 1.5 0 0 0 10 6.5z"/><path d="M15 8h6M15 12h6M15 16h6"/>',
  tire: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6.4"/><circle cx="12" cy="12" r="1.5"/><path d="m13.3 12.75 4.24 2.45M12 13.5v4.9m-1.3-5.65-4.24 2.45m4.24-3.95L6.46 8.8M12 10.5V5.6m1.3 5.65 4.24-2.45"/>',
  gear: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3 7 7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/>',
  mirror: '<rect x="8.5" y="3.5" width="13" height="8.5" rx="4.25"/><path d="M11.5 12v2.5a2 2 0 0 1-2 2H3.5m8.3-9.3a2.6 2.6 0 0 1 2.4-1.6"/>',
  seat: '<path d="M2.5 8.8c0-1.9 3.4-2.8 8.5-2.8 5.4 0 10.5 1 10.5 3 0 1.8-4 2.8-8 2.8-1.3 0-2.2.6-3 1.6L8.5 16"/><path d="M8.5 16v5M5.5 21h6"/>',
  pedal: '<circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="1.2"/><path d="m8.9 9 5.6 6.8"/><rect x="11" y="15.8" width="10.5" height="4.7" rx="2.35"/>',
  grip: '<rect x="2.5" y="8.5" width="14" height="7" rx="3.5"/><path d="M16.5 12H22M6 8.5v7M9 8.5v7M12 8.5v7"/>',
  mudguard: '<circle cx="12" cy="14" r="5"/><circle cx="12" cy="14" r="1.2"/><path d="M3.73 10.99A8.8 8.8 0 0 1 20.27 17.01l-1.69-.62A7 7 0 0 0 5.42 11.61z"/>',
  helmet: '<path d="M3 15.5a9 9 0 0 1 18 0V17H3z"/><path d="M8 7.5l2 4M13 6.8l.5 4.5M17.6 9.2l-2 3"/><path d="M5 17l1.2 3H10"/>',
  glasses: '<circle cx="7" cy="13" r="4"/><circle cx="17" cy="13" r="4"/><path d="M11 13h2M3.2 11.8 2 8.5M20.8 11.8 22 8.5"/>',
  bag: '<path d="M5 8h14l-1.2 13H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  box: '<path d="M3 7.5 12 3.5l9 4v9l-9 4-9-4z"/><path d="M3 7.5l9 4 9-4M12 11.5v9"/>',
};

export function iconForProduct(title, type) {
  const t = normalizeText(`${title} ${type}`);
  const rules = [
    [/\b(luz|luces|linterna|faro|led)\b/, 'light'],
    [/\b(llanta|llantas|camara|camaras|neumatico)\b/, 'tire'],
    [/\b(pinon|pinones|cadena|transmision|cassette|catalina)\b/, 'gear'],
    [/\bespejo/, 'mirror'],
    [/\b(asiento|asientos|sillin|tubo)\b/, 'seat'],
    [/\bpedal/, 'pedal'],
    [/\b(grip|grips|puno|punos)\b/, 'grip'],
    [/\btapa ?barro/, 'mudguard'],
    [/\bcasco/, 'helmet'],
    [/\b(lente|lentes|gafa|gafas)\b/, 'glasses'],
    [/\b(accesorio|accesorios|bolso|mochila|botella|soporte)\b/, 'bag'],
  ];
  for (const [re, icon] of rules) if (re.test(t)) return icon;
  return 'box';
}

function wrapLines(text, maxChars, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…');
  }
  return lines;
}

let photoCache = null;
function photos() {
  if (photoCache) return photoCache;
  photoCache = [];
  let files = [];
  try { files = fs.readdirSync(PHOTOS_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort(); } catch { /* none */ }
  for (const f of files) {
    const buf = fs.readFileSync(path.join(PHOTOS_DIR, f));
    const dims = jpegSize(buf);
    // Skip strips/masks (extreme aspect ratios) — they make poor 16:9 stand-ins.
    if (dims && (dims.width / dims.height > 2.6 || dims.height / dims.width > 2.6)) continue;
    const mime = /\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg';
    photoCache.push({ file: f, dataUri: `data:${mime};base64,${buf.toString('base64')}` });
  }
  return photoCache;
}

function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

// Nicer default pairing for the known shop images; everything else is hashed.
const PHOTO_HINTS = [
  [/casco|helmet/, 'p8-58'],
  [/llanta|tire|scooter/, 'p8-59'],
  [/luces|luz|anochecer/, 'p3-17'],
];

function photoFor(name) {
  const list = photos();
  if (!list.length) return null;
  const n = normalizeText(name);
  for (const [re, hint] of PHOTO_HINTS) {
    if (re.test(n)) {
      const hit = list.find((p) => p.file.includes(hint));
      if (hit) return hit;
    }
  }
  return list[hashInt(name) % list.length];
}

export class ImageRegistry {
  constructor() {
    this.byKey = new Map();
    this.byCdn = new Map();
  }

  register(entry) {
    this.byKey.set(entry.key, entry);
    if (entry.cdn) this.byCdn.set(stripQuery(entry.cdn), entry);
    return entry;
  }

  product({ handle, title, type, position, count, cdn, id, productId }) {
    return this.register({
      key: `p/${handle}/${position}`,
      kind: 'product',
      id,
      productId,
      title,
      type,
      position,
      count,
      cdn,
      icon: iconForProduct(title, type),
      ...PRODUCT_IMAGE_SIZE,
    });
  }

  shop(name) {
    const clean = String(name).replace(/^shopify:\/\/shop_images\//, '');
    const key = `s/${clean}`;
    if (this.byKey.has(key)) return this.byKey.get(key);
    return this.register({
      key,
      kind: 'shop',
      id: 30000000000000 + (hashInt(clean) % 999999999),
      name: clean,
      cdn: `https://cdn.shopify.com/s/files/1/0846/2250/8276/files/${clean}`,
      ...SHOP_IMAGE_SIZE,
    });
  }

  generic(url) {
    const clean = stripQuery(url);
    const key = `x/${hashInt(clean).toString(36)}`;
    if (this.byKey.has(key)) return this.byKey.get(key);
    const label = decodeURIComponent(clean.split('/').pop() || 'image');
    return this.register({ key, kind: 'generic', label, cdn: clean, width: 1200, height: 1200 });
  }

  fromCdn(url) {
    const clean = stripQuery(String(url).replace(/^\/\//, 'https://').replace(/^http:/, 'https:'));
    return this.byCdn.get(clean) || this.generic(clean);
  }

  /** '/_img/<key>.svg' (+ params) → entry */
  fromLocalPath(pathname) {
    const m = pathname.match(/^\/_img\/(.+)\.svg$/);
    if (!m) return null;
    const key = m[1].split('/').map((s) => decodeURIComponent(s)).join('/');
    if (this.byKey.has(key)) return this.byKey.get(key);
    if (key.startsWith('s/')) return this.shop(key.slice(2));
    return null;
  }

  localUrl(entry, params = {}) {
    const q = ['v=1'];
    for (const k of ['width', 'height', 'crop', 'format', 'pad_color']) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') q.push(`${k}=${encodeURIComponent(params[k])}`);
    }
    const keyPath = entry.key.split('/').map(encodeURIComponent).join('/');
    return `/_img/${keyPath}.svg?${q.join('&')}`;
  }

  /** Rewrite any leftover cdn.shopify.com URL in HTML/JSON/CSS to the local placeholder. */
  rewriteCdnUrls(text) {
    return text.replace(CDN_RE, (url) => {
      const amp = url.includes('&amp;');
      const decoded = url.replace(/&amp;/g, '&');
      const qIndex = decoded.search(/[?&]/);
      const base = qIndex === -1 ? decoded : decoded.slice(0, qIndex);
      const params = qIndex === -1 ? {} : Object.fromEntries(new URLSearchParams(decoded.slice(qIndex + 1).replace(/\?/g, '&')));
      const entry = this.fromCdn(base);
      const local = this.localUrl(entry, { width: params.width, height: params.height, crop: params.crop });
      return amp ? local.replace(/&/g, '&amp;') : local;
    });
  }
}

export function stripQuery(url) {
  return String(url).split(/[?#]/)[0];
}

/** Size Shopify would deliver for image_url params (no upscaling unless cropping). */
export function outputSize(entry, { width, height, crop } = {}) {
  const w0 = entry.width || 1200;
  const h0 = entry.height || 1200;
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w && h && crop) return { width: w, height: h };
  if (w && h) {
    const s = Math.min(w / w0, h / h0, 1);
    return { width: Math.round(w0 * s), height: Math.round(h0 * s) };
  }
  if (w) {
    const tw = Math.min(w, w0);
    return { width: tw, height: Math.round((tw * h0) / w0) };
  }
  if (h) {
    const th = Math.min(h, h0);
    return { width: Math.round((th * w0) / h0), height: th };
  }
  return { width: w0, height: h0 };
}

function alignFor(crop) {
  switch (crop) {
    case 'top': return 'xMidYMin';
    case 'bottom': return 'xMidYMax';
    case 'left': return 'xMinYMid';
    case 'right': return 'xMaxYMid';
    default: return 'xMidYMid';
  }
}

export function renderSvg(entry, params = {}) {
  const { width, height } = outputSize(entry, params);
  if (entry.kind === 'product') return productSvg(entry, width, height);
  if (entry.kind === 'shop') return shopSvg(entry, width, height, params.crop);
  return genericSvg(entry, width, height);
}

function productSvg(entry, W, H) {
  const vw = 1000;
  const vh = Math.round((1000 * H) / W);
  const m = Math.min(vw, vh);
  const cx = vw / 2;
  const cy = vh * 0.42;
  const s = m * 0.4;
  const rotations = [0, -10, 10, -5, 5, 0];
  const r = rotations[(entry.position - 1) % rotations.length];
  const fs = Math.max(18, Math.round(m * 0.042));
  const lines = wrapLines(entry.title, Math.max(16, Math.round((vw / fs) * 1.7)), 2);
  const textY = Math.min(vh - fs * 2.6, cy + s * 0.78 + fs * 1.6);
  const text = lines.map((ln, i) =>
    `<text x="${cx}" y="${Math.round(textY + i * fs * 1.3)}" text-anchor="middle" font-size="${fs}">${escapeHtml(ln)}</text>`).join('');
  const counter = entry.count > 1
    ? `<text x="${vw - m * 0.05}" y="${m * 0.08}" text-anchor="end" font-size="${Math.round(fs * 0.8)}">${entry.position}/${entry.count}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${escapeHtml(entry.title)}">`
    // White background like real catalog photos, so the theme's multiply blend (card_blend_white)
    // behaves as it will on Shopify: the product floats on the --color-surface tile.
    + `<rect width="${vw}" height="${vh}" fill="#FFFFFF"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${Math.round(s * 0.78)}" fill="#F1F1EC"/>`
    + `<g transform="translate(${cx - s / 2} ${cy - s / 2}) scale(${s / 24}) rotate(${r} 12 12)" fill="none" stroke="#0B0B0B" stroke-opacity=".82" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">${ICONS[entry.icon] || ICONS.box}</g>`
    + `<g fill="#8A8A82" font-family="'Libre Franklin','Helvetica Neue',Arial,sans-serif">${text}${counter}</g>`
    + `</svg>`;
}

function shopSvg(entry, W, H, crop) {
  const photo = photoFor(entry.name);
  const vw = 2048;
  const vh = Math.round((2048 * H) / W);
  if (!photo) return genericSvg({ ...entry, label: entry.name }, W, H);
  const align = alignFor(crop);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="${align} slice">`
    + `<rect width="${vw}" height="${vh}" fill="#ECECE6"/>`
    + `<image href="${photo.dataUri}" xlink:href="${photo.dataUri}" x="0" y="0" width="${vw}" height="${vh}" preserveAspectRatio="${align} slice"/>`
    + `</svg>`;
}

function genericSvg(entry, W, H) {
  const vw = 1000;
  const vh = Math.round((1000 * H) / W);
  const fs = Math.round(Math.min(vw, vh) * 0.045);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid slice">`
    + `<rect width="${vw}" height="${vh}" fill="#ECECE6"/>`
    + `<g transform="translate(${vw / 2 - 60} ${vh / 2 - 90}) scale(5)" fill="none" stroke="#5C5C56" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="2"/><path d="m21 16-5-5-9 9"/></g>`
    + `<text x="${vw / 2}" y="${vh / 2 + 80}" text-anchor="middle" font-size="${fs}" fill="#5C5C56" font-family="Arial,sans-serif">${escapeHtml(entry.label || '')}</text>`
    + `</svg>`;
}

// ---------------------------------------------------------------------------
// Shopify placeholder_svg_tag / payment_type_svg_tag stand-ins (paths inherit `fill` from CSS,
// exactly like Shopify's own placeholder illustrations).

export function placeholderSvg(name, cls) {
  const n = String(name || 'image');
  const wide = /lifestyle|hero|image|detailed|collection-apparel/.test(n) && !/product/.test(n);
  const [w, h] = wide ? [1300, 730] : [525, 525];
  const classAttr = cls ? ` class="${escapeHtml(cls)}"` : '';
  const seed = hashInt(n);
  const cx = w * (0.35 + (seed % 30) / 100);
  return `<svg${classAttr} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-placeholder="${escapeHtml(n)}">`
    + `<path d="M0 ${h * 0.78} L${w * 0.28} ${h * 0.46} L${w * 0.47} ${h * 0.66} L${w * 0.66} ${h * 0.36} L${w} ${h * 0.74} V${h} H0 Z" opacity=".55"/>`
    + `<circle cx="${cx}" cy="${h * 0.24}" r="${Math.min(w, h) * 0.07}" opacity=".45"/>`
    + `<path d="M${w * 0.04} ${h * 0.94} H${w * 0.96}" stroke-width="${Math.max(2, w / 260)}" opacity=".3"/>`
    + `</svg>`;
}

const PAYMENT_NAMES = {
  visa: ['Visa', '#1A1F71', '#fff'],
  master: ['Mastercard', '#EB001B', '#fff'],
  american_express: ['American Express', '#2E77BB', '#fff'],
  diners_club: ['Diners Club', '#0079BE', '#fff'],
  paypal: ['PayPal', '#003087', '#fff'],
  discover: ['Discover', '#F68121', '#fff'],
  shopify_pay: ['Shop Pay', '#5A31F4', '#fff'],
  apple_pay: ['Apple Pay', '#000', '#fff'],
  google_pay: ['Google Pay', '#fff', '#3C4043'],
  yape: ['Yape', '#742384', '#fff'],
};

export function paymentSvg(type, cls = 'icon icon--full-color') {
  const [label, bg, fg] = PAYMENT_NAMES[type] || [String(type).replace(/_/g, ' '), '#555', '#fff'];
  const short = label.length > 10 ? label.split(' ').map((s) => s[0]).join('') : label;
  const id = `pi-${type}`;
  return `<svg class="${escapeHtml(cls)}" viewBox="0 0 38 24" xmlns="http://www.w3.org/2000/svg" role="img" width="38" height="24" aria-labelledby="${id}"><title id="${id}">${escapeHtml(label)}</title>`
    + `<rect x=".5" y=".5" width="37" height="23" rx="3" fill="${bg}" stroke="#000" stroke-opacity=".07"/>`
    + `<text x="19" y="15.5" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="${short.length > 6 ? 6.5 : 8}" fill="${fg}">${escapeHtml(short)}</text></svg>`;
}
