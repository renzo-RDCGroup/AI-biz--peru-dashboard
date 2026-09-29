// Small, dependency-free helpers shared by every module.
import crypto from 'node:crypto';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Attribute-safe escaping that leaves existing entities alone (like Shopify's escape_once). */
export function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&(?!#?\w+;)/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Lowercase, strip accents — used for search matching and case-insensitive lookups. */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Shopify's handleize: transliterate, lowercase, non-alphanumerics → single dashes. */
export function handleize(value) {
  return normalizeText(value)
    .replace(/['"()[\]]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** FNV-1a 32-bit hash → unsigned int. Deterministic ids and picks. */
export function hashInt(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function md5(str) {
  return crypto.createHash('md5').update(String(str)).digest('hex');
}

/**
 * Strip `/* … *\/` and `// …` comments from JSON text without touching string contents.
 * Shopify writes an auto-generated block comment at the top of JSON templates / settings_data.
 */
export function stripJsonComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  let inString = false;
  while (i < n) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') { out += text[i + 1] ?? ''; i += 2; continue; }
      if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') { inString = true; out += c; i++; continue; }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i + 2);
      i = end === -1 ? n : end;
      continue;
    }
    out += c;
    i++;
  }
  return out.replace(/^﻿/, '');
}

export function parseJsonLoose(text) {
  return JSON.parse(stripJsonComments(text));
}

// ---------------------------------------------------------------------------
// Money

function groupDigits(intPart, sep) {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

function formatAmount(cents, decimals, thousands, decimal) {
  const value = (cents / 100).toFixed(decimals);
  let [intPart, fraction] = value.split('.');
  let sign = '';
  if (intPart.startsWith('-')) { sign = '-'; intPart = intPart.slice(1); }
  return sign + groupDigits(intPart, thousands) + (fraction ? decimal + fraction : '');
}

export function formatAmountKey(cents, key) {
  switch (key) {
    case 'amount_no_decimals': return formatAmount(cents, 0, ',', '.');
    case 'amount_with_comma_separator': return formatAmount(cents, 2, '.', ',');
    case 'amount_no_decimals_with_comma_separator': return formatAmount(cents, 0, '.', ',');
    case 'amount_with_apostrophe_separator': return formatAmount(cents, 2, "'", '.');
    case 'amount_no_decimals_with_space_separator': return formatAmount(cents, 0, ' ', '.');
    case 'amount_with_space_separator': return formatAmount(cents, 2, ' ', ',');
    case 'amount_with_period_and_space_separator': return formatAmount(cents, 2, ' ', '.');
    case 'amount':
    default: return formatAmount(cents, 2, ',', '.');
  }
}

/** Format integer cents with a Shopify money format such as "S/ {{amount}}". */
export function formatMoney(cents, format) {
  if (cents === null || cents === undefined || cents === '') return '';
  const n = Number(cents);
  if (!Number.isFinite(n)) return '';
  return String(format).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => formatAmountKey(n, key));
}

// ---------------------------------------------------------------------------
// Rails-style nested params: items[0][id]=1, updates[123]=2, updates[]=1, properties[Color]=Rojo

export function nestParams(entries) {
  const root = {};
  for (const [rawKey, value] of entries) {
    const parts = [];
    const m = rawKey.match(/^([^[\]]+)((?:\[[^\]]*\])*)$/);
    if (!m) { root[rawKey] = value; continue; }
    parts.push(m[1]);
    const brackets = m[2].match(/\[([^\]]*)\]/g) || [];
    for (const b of brackets) parts.push(b.slice(1, -1));
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const key = parts[i];
      const last = i === parts.length - 1;
      if (key === '') {
        // push semantics: node must be an array
        if (!Array.isArray(node.__arr)) node.__arr = [];
        if (last) { node.__arr.push(value); break; }
        const child = {};
        node.__arr.push(child);
        node = child;
        continue;
      }
      if (last) {
        node[key] = value;
      } else {
        if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
        node = node[key];
      }
    }
  }
  return unwrapArrays(root);
}

function unwrapArrays(node) {
  if (Array.isArray(node) || node === null || typeof node !== 'object') return node;
  if (Array.isArray(node.__arr) && Object.keys(node).length === 1) return node.__arr.map(unwrapArrays);
  const keys = Object.keys(node);
  // objects keyed 0..n → arrays (items[0][id])
  if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
    return keys.sort((a, b) => a - b).map((k) => unwrapArrays(node[k]));
  }
  const out = {};
  for (const k of keys) out[k] = unwrapArrays(node[k]);
  return out;
}

export function toInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function uniq(arr) {
  return [...new Set(arr)];
}

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
}

/** Spanish-first mapping of color words used by filters' swatches (mirrors SPEC §6.4). */
const COLOR_WORDS = {
  amarillo: '#FFD219', blanco: '#FFFFFF', negro: '#111111', rojo: '#D10000', azul: '#1F5BD8',
  celeste: '#7CC6F2', verde: '#2E9E4F', rosa: '#F28DB2', fucsia: '#E0218A', naranja: '#FF7A00',
  morado: '#7B3FB5', lila: '#B79CE0', gris: '#9A9A9A', plateado: '#C9C9C9', dorado: '#C9A13B',
  marron: '#7A4B2A', beige: '#E6D5B8',
};

export function colorForWord(value) {
  const words = normalizeText(value).split(/[^a-z]+/).filter(Boolean);
  for (const w of words) if (COLOR_WORDS[w]) return COLOR_WORDS[w];
  return null;
}
