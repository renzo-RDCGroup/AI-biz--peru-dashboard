// Storefront filtering & sorting (Search & Discovery semantics, simplified but faithful in shape):
// filter.v.availability, filter.v.price.gte/lte, filter.p.vendor, filter.p.product_type,
// filter.v.option.<handle>. Variant-level filters must be satisfied by the same variant.
import { Drop } from 'liquidjs';
import { ColorDrop } from './colors.mjs';
import { colorForWord, handleize, hashInt } from './util.mjs';

export const COLLECTION_SORT_OPTIONS = [
  { value: 'manual', name: 'Destacado' },
  { value: 'best-selling', name: 'Más vendidos' },
  { value: 'title-ascending', name: 'Alfabéticamente, A-Z' },
  { value: 'title-descending', name: 'Alfabéticamente, Z-A' },
  { value: 'price-ascending', name: 'Precio, menor a mayor' },
  { value: 'price-descending', name: 'Precio, mayor a menor' },
  { value: 'created-ascending', name: 'Fecha, antiguo(a) a reciente(a)' },
  { value: 'created-descending', name: 'Fecha, reciente(a) a antiguo(a)' },
];

export const SEARCH_SORT_OPTIONS = [
  { value: 'relevance', name: 'Relevancia' },
  ...COLLECTION_SORT_OPTIONS.filter((o) => o.value !== 'manual'),
];

const INTERNAL_PARAMS = ['page', 'section_id', 'sections', '__cart', '__form', 'view'];

function parsePrice(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function readFacetState(query) {
  const st = { avail: [], vendor: [], type: [], options: new Map(), gte: null, lte: null, any: false };
  for (const [k, v] of query) {
    if (!k.startsWith('filter.')) continue;
    if (k === 'filter.v.availability') st.avail.push(v);
    else if (k === 'filter.p.vendor') st.vendor.push(v);
    else if (k === 'filter.p.product_type') st.type.push(v);
    else if (k === 'filter.v.price.gte') st.gte = parsePrice(v);
    else if (k === 'filter.v.price.lte') st.lte = parsePrice(v);
    else if (k.startsWith('filter.v.option.')) {
      const key = k.slice('filter.v.option.'.length);
      if (!st.options.has(key)) st.options.set(key, []);
      st.options.get(key).push(v);
    } else continue;
    st.any = true;
  }
  return st;
}

function optionIndex(product, key) {
  return product.options.findIndex((o) => handleize(o.name) === key);
}

function variantMatches(product, v, st, skip) {
  if (skip !== 'filter.v.availability' && st.avail.length) {
    if (!st.avail.some((a) => (a === '1' ? v.available : !v.available))) return false;
  }
  if (skip !== 'filter.v.price') {
    if (st.gte !== null && v.price < st.gte) return false;
    if (st.lte !== null && v.price > st.lte) return false;
  }
  for (const [key, values] of st.options) {
    if (skip === `filter.v.option.${key}`) continue;
    const idx = optionIndex(product, key);
    if (idx < 0 || !values.includes(v.options[idx])) return false;
  }
  return true;
}

export function productMatches(product, st, skip = null) {
  if (skip !== 'filter.p.vendor' && st.vendor.length && !st.vendor.includes(product.vendor)) return false;
  if (skip !== 'filter.p.product_type' && st.type.length && !st.type.includes(product.product_type)) return false;
  return product.variants.some((v) => variantMatches(product, v, st, skip));
}

export function applyFacets(products, st) {
  if (!st.any) return products;
  return products.filter((p) => productMatches(p, st));
}

const minPrice = (p) => Math.min(...p.variants.map((v) => v.price));

export function sortProducts(products, sortBy) {
  const list = [...products];
  const byIndex = (a, b) => a.index - b.index;
  switch (sortBy) {
    case 'title-ascending': return list.sort((a, b) => a.title.localeCompare(b.title, 'es') || byIndex(a, b));
    case 'title-descending': return list.sort((a, b) => b.title.localeCompare(a.title, 'es') || byIndex(a, b));
    case 'price-ascending': return list.sort((a, b) => minPrice(a) - minPrice(b) || byIndex(a, b));
    case 'price-descending': return list.sort((a, b) => minPrice(b) - minPrice(a) || byIndex(a, b));
    case 'created-ascending': return list.sort((a, b) => a.created_at.localeCompare(b.created_at) || byIndex(a, b));
    case 'created-descending': return list.sort((a, b) => b.created_at.localeCompare(a.created_at) || byIndex(a, b));
    case 'best-selling': return list.sort((a, b) => (hashInt(a.handle) % 997) - (hashInt(b.handle) % 997) || byIndex(a, b));
    default: return list.sort(byIndex);
  }
}

// ---------------------------------------------------------------------------
// URL helpers

export function cleanQuery(query) {
  const q = new URLSearchParams(query);
  for (const p of INTERNAL_PARAMS) q.delete(p);
  return q;
}

export function buildUrl(basePath, q) {
  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}

function withoutPair(q, key, value) {
  const out = new URLSearchParams();
  for (const [k, v] of q) if (!(k === key && (value === undefined || v === value))) out.append(k, v);
  return out;
}

// ---------------------------------------------------------------------------
// Drops

class FilterValueDrop extends Drop {
  constructor(data) { super(); Object.assign(this, data); }
  valueOf() { return this.value ?? ''; }
  toString() { return String(this.value ?? ''); }
}

class SwatchDrop extends Drop {
  constructor(color) { super(); this.color = color ? new ColorDrop(color) : null; this.image = null; }
}

class FilterDrop extends Drop {
  constructor(data) { super(); Object.assign(this, data); }
  get active_values() { return (this.values || []).filter((v) => v.active); }
  get inactive_values() { return (this.values || []).filter((v) => !v.active); }
}

/**
 * Build filter drops for `baseProducts` (the unfiltered result set) given the current URL.
 * basePath: '/collections/luces' or '/search'.
 */
export function buildFilters(baseProducts, query, basePath) {
  const st = readFacetState(query);
  const q = cleanQuery(query);
  const filters = [];

  const countWith = (group, mutate) => {
    const scoped = { ...st, avail: [...st.avail], vendor: [...st.vendor], type: [...st.type], options: new Map(st.options) };
    mutate(scoped);
    scoped.any = true;
    return baseProducts.filter((p) => productMatches(p, scoped)).length;
  };

  const listFilter = ({ label, param, type = 'list', values, presentation = 'text', swatch = false, optionKey = null }) => {
    if (!values.length) return;
    const active = new Set(q.getAll(param));
    const valueDrops = values.map(({ value, label: vLabel }) => {
      const isActive = active.has(value);
      const addQ = new URLSearchParams(q);
      addQ.append(param, value);
      const count = countWith(param, (s) => {
        if (param === 'filter.v.availability') s.avail = [value];
        else if (param === 'filter.p.vendor') s.vendor = [value];
        else if (param === 'filter.p.product_type') s.type = [value];
        else if (optionKey) s.options.set(optionKey, [value]);
      });
      return new FilterValueDrop({
        label: vLabel ?? value,
        value,
        count,
        active: isActive,
        param_name: param,
        url_to_add: buildUrl(basePath, addQ),
        url_to_remove: buildUrl(basePath, withoutPair(q, param, value)),
        swatch: swatch ? new SwatchDrop(colorForWord(value)) : null,
        image: null,
      });
    });
    filters.push(new FilterDrop({
      label,
      param_name: param,
      type,
      operator: 'OR',
      presentation,
      values: valueDrops,
      url_to_remove: buildUrl(basePath, withoutPair(q, param)),
      min_value: null,
      max_value: null,
      range_max: null,
    }));
  };

  // Availability
  listFilter({
    label: 'Disponibilidad',
    param: 'filter.v.availability',
    type: 'boolean',
    values: [{ value: '1', label: 'Disponible' }, { value: '0', label: 'Agotado' }],
  });

  // Price range
  const prices = baseProducts.flatMap((p) => p.variants.map((v) => v.price));
  if (prices.length) {
    const rangeMax = Math.max(...prices);
    let removeQ = withoutPair(q, 'filter.v.price.gte');
    removeQ = withoutPair(removeQ, 'filter.v.price.lte');
    filters.push(new FilterDrop({
      label: 'Precio',
      param_name: 'filter.v.price',
      type: 'price_range',
      operator: 'AND',
      presentation: null,
      values: [],
      url_to_remove: buildUrl(basePath, removeQ),
      min_value: new FilterValueDrop({ param_name: 'filter.v.price.gte', value: st.gte, active: st.gte !== null, label: '' }),
      max_value: new FilterValueDrop({ param_name: 'filter.v.price.lte', value: st.lte, active: st.lte !== null, label: '' }),
      range_max: rangeMax,
    }));
  }

  const distinct = (fn) => [...new Set(baseProducts.flatMap(fn).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  listFilter({ label: 'Marca', param: 'filter.p.vendor', values: distinct((p) => [p.vendor]).map((v) => ({ value: v })) });
  listFilter({ label: 'Tipo de producto', param: 'filter.p.product_type', values: distinct((p) => [p.product_type]).map((v) => ({ value: v })) });

  // Color option (any option named color/colour)
  const colorValues = distinct((p) => {
    const idx = p.options.findIndex((o) => /^(color|colour|color\/colour)$/i.test(o.name));
    return idx < 0 ? [] : p.variants.map((v) => v.options[idx]);
  });
  listFilter({
    label: 'Color',
    param: 'filter.v.option.color',
    values: colorValues.map((v) => ({ value: v })),
    presentation: 'swatch',
    swatch: true,
    optionKey: 'color',
  });

  return filters;
}
