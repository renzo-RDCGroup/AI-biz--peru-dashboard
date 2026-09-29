// Shopify Liquid objects ("drops") backed by the mock store.
// Every drop keeps its world (per-request context) in a non-enumerable field and exposes
// Shopify's documented properties as getters. Unknown properties resolve to nil.
import { Drop } from 'liquidjs';
import { applyFacets, buildFilters, COLLECTION_SORT_OPTIONS, readFacetState, SEARCH_SORT_OPTIONS, sortProducts, cleanQuery, buildUrl } from './facets.mjs';
import { handleize, hashInt, normalizeText, escapeHtml } from './util.mjs';

const PRODUCTS_LIMIT = 50; // Shopify caps collection.products outside {% paginate %}

// ---------------------------------------------------------------------------
// Base

export class BaseDrop extends Drop {
  constructor(world) {
    super();
    Object.defineProperty(this, '_w', { value: world, enumerable: false, writable: true });
    Object.defineProperty(this, '_memo', { value: new Map(), enumerable: false });
    // An own enumerable key keeps `drop == empty` false (liquidjs checks Object.keys()).
    this.__kind = this.constructor.name;
  }
  _cached(key, fn) {
    if (!this._memo.has(key)) this._memo.set(key, fn());
    return this._memo.get(key);
  }
  toString() { return this.constructor.name; }
}

function cachedDrop(w, kind, key, make) {
  const k = `${kind}:${key}`;
  if (!w.dropCache.has(k)) w.dropCache.set(k, make());
  return w.dropCache.get(k);
}

// ---------------------------------------------------------------------------
// Metafields: any namespace/key resolves to nil unless the mock defines it.

class MetafieldDrop extends BaseDrop {
  constructor(w, value, type = 'single_line_text_field') { super(w); this.value = value; this.type = type; }
  valueOf() { return this.value; }
  toString() { return String(this.value ?? ''); }
}

class MetafieldNamespaceDrop extends BaseDrop {
  constructor(w, data) { super(w); Object.defineProperty(this, '_data', { value: data || {}, enumerable: false }); }
  liquidMethodMissing(key) {
    const v = this._data[key];
    if (v === undefined || v === null) return undefined;
    return typeof v === 'object' && 'value' in v ? new MetafieldDrop(this._w, v.value, v.type) : new MetafieldDrop(this._w, v);
  }
}

export class MetafieldsDrop extends BaseDrop {
  constructor(w, data) { super(w); Object.defineProperty(this, '_data', { value: data || {}, enumerable: false }); }
  liquidMethodMissing(ns) { return new MetafieldNamespaceDrop(this._w, this._data[ns]); }
}

// ---------------------------------------------------------------------------
// Images & media

export class ImageDrop extends BaseDrop {
  constructor(w, img) {
    super(w);
    Object.defineProperty(this, '_img', { value: img, enumerable: false });
  }
  get entry() { return this._img.entry; }
  get id() { return this._img.id; }
  get src() { return this._img.src; }
  get url() { return this._img.src; }
  get width() { return this._img.width; }
  get height() { return this._img.height; }
  get aspect_ratio() { return Math.round((this._img.width / this._img.height) * 1000) / 1000; }
  get alt() { return this._img.alt ?? ''; }
  get position() { return this._img.position ?? null; }
  get product_id() { return this._img.product_id ?? null; }
  get variants() { return this._img.variants ? this._img.variants() : []; }
  get ['attached_to_variant?']() { return this.variants.length > 0; }
  get media_type() { return 'image'; }
  get preview_image() { return this; }
  get presentation() { return { focal_point: null }; }
  get focal_point() { return null; }
  get file_size() { return null; }
  valueOf() { return this._img.src; }
  toString() { return this._img.src; }
  toJSON() {
    const base = { aspect_ratio: this.aspect_ratio, height: this.height, width: this.width, src: this.src };
    return { alt: this.alt || null, id: this.id, position: this.position, preview_image: base, ...base, media_type: 'image' };
  }
}

export function productImageDrop(w, product, img) {
  return cachedDrop(w, 'img', img.id, () => new ImageDrop(w, {
    ...img,
    alt: img.alt ?? product.title,
    variants: () => product.variants.filter((v) => v.image_position === img.position).map((v) => variantDrop(w, product, v)),
  }));
}

export function shopImageDrop(w, name) {
  if (!name) return null;
  const entry = w.registry.shop(name);
  return cachedDrop(w, 'shopimg', entry.key, () => new ImageDrop(w, {
    id: entry.id,
    src: entry.cdn,
    width: entry.width,
    height: entry.height,
    alt: '',
    position: null,
    entry,
  }));
}

// ---------------------------------------------------------------------------
// Products

export class VariantDrop extends BaseDrop {
  constructor(w, product, v) {
    super(w);
    Object.defineProperty(this, '_p', { value: product, enumerable: false });
    Object.defineProperty(this, '_v', { value: v, enumerable: false });
  }
  get id() { return this._v.id; }
  get title() { return this._v.title; }
  get name() { return this.public_title ? `${this._p.title} - ${this._v.title}` : this._p.title; }
  get public_title() { return this._v.title === 'Default Title' ? null : this._v.title; }
  get price() { return this._v.price; }
  get compare_at_price() { return this._v.compare_at_price ?? null; }
  get available() { return this._v.available; }
  get inventory_quantity() { return this._v.inventory_quantity; }
  get inventory_policy() { return this._v.inventory_policy; }
  get inventory_management() { return this._v.inventory_management; }
  get sku() { return this._v.sku || null; }
  get barcode() { return this._v.barcode; }
  get option1() { return this._v.option1; }
  get option2() { return this._v.option2; }
  get option3() { return this._v.option3; }
  get options() { return this._v.options; }
  get featured_image() {
    const pos = this._v.image_position;
    const img = pos ? this._p.images[pos - 1] : null;
    return img ? productImageDrop(this._w, this._p, img) : null;
  }
  get image() { return this.featured_image; }
  get featured_media() { return this.featured_image; }
  get url() { return `/products/${this._p.handle}?variant=${this._v.id}`; }
  get weight() { return this._v.weight || 0; }
  get weight_unit() { return 'kg'; }
  get weight_in_unit() { return (this._v.weight || 0) / 1000; }
  get requires_shipping() { return this._v.requires_shipping; }
  get taxable() { return this._v.taxable; }
  get unit_price_measurement() { return null; }
  get unit_price() { return null; }
  get quantity_rule() { return { min: 1, max: null, increment: 1 }; }
  get quantity_price_breaks() { return []; }
  get ['quantity_price_breaks_configured?']() { return false; }
  get store_availabilities() { return []; }
  get selected() { return String(this._w.query.get('variant')) === String(this._v.id); }
  get matched() { return true; }
  get incoming() { return false; }
  get next_incoming_date() { return null; }
  get product() { return productDrop(this._w, this._p); }
  get selling_plan_allocations() { return []; }
  get selected_selling_plan_allocation() { return null; }
  get requires_selling_plan() { return false; }
  get metafields() { return new MetafieldsDrop(this._w, this._v.metafields); }
  get position() { return this._v.position; }
  toJSON() {
    const img = this.featured_image;
    return {
      id: this.id,
      title: this.title,
      option1: this.option1,
      option2: this.option2,
      option3: this.option3,
      sku: this.sku,
      requires_shipping: this.requires_shipping,
      taxable: this.taxable,
      featured_image: img ? { id: img.id, product_id: this._p.id, position: img.position, alt: img.alt, width: img.width, height: img.height, src: img.src, variant_ids: [this.id] } : null,
      available: this.available,
      name: this.name,
      public_title: this.public_title,
      options: this.options,
      price: this.price,
      weight: this.weight,
      compare_at_price: this.compare_at_price,
      inventory_management: this.inventory_management,
      barcode: this.barcode,
      featured_media: img ? { alt: img.alt, id: img.id, position: img.position, preview_image: { aspect_ratio: img.aspect_ratio, height: img.height, width: img.width, src: img.src } } : null,
      requires_selling_plan: false,
      selling_plan_allocations: [],
      quantity_rule: { min: 1, max: null, increment: 1 },
    };
  }
}

export function variantDrop(w, product, v) {
  return cachedDrop(w, 'variant', v.id, () => new VariantDrop(w, product, v));
}

function optionValueId(product, index, name) {
  return 60000000000 + (hashInt(`${product.id}:${index}:${name}`) % 999999999);
}

class ProductOptionValueDrop extends BaseDrop {
  constructor(w, data) { super(w); Object.defineProperty(this, '_o', { value: data, enumerable: false }); }
  get id() { return this._o.id; }
  get name() { return this._o.name; }
  get value() { return this._o.name; }
  get available() { return this._o.available; }
  get selected() { return this._o.selected; }
  get swatch() { return null; }
  get variant() { return this._o.variant; }
  get product_url() { return null; }
  valueOf() { return this._o.name; }
  toString() { return this._o.name; }
  toJSON() { return this._o.name; }
}

class ProductOptionDrop extends BaseDrop {
  constructor(w, data) { super(w); Object.assign(this, data); }
  toString() { return this.name; }
  toJSON() { return { name: this.name, position: this.position, values: this.values.map((v) => v.name) }; }
}

class OptionsByNameDrop extends BaseDrop {
  constructor(w, options) { super(w); Object.defineProperty(this, '_o', { value: options, enumerable: false }); }
  liquidMethodMissing(key) {
    const k = normalizeText(key);
    return this._o.find((o) => normalizeText(o.name) === k);
  }
}

export class ProductDrop extends BaseDrop {
  constructor(w, p) {
    super(w);
    Object.defineProperty(this, '_p', { value: p, enumerable: false });
  }
  get id() { return this._p.id; }
  get handle() { return this._p.handle; }
  get title() { return this._p.title; }
  get url() { return `/products/${this._p.handle}`; }
  get vendor() { return this._p.vendor; }
  get type() { return this._p.product_type; }
  get product_type() { return this._p.product_type; }
  get tags() { return this._p.tags; }
  get description() { return this._p.description; }
  get content() { return this._p.description; }
  get object_type() { return 'product'; }
  get template_suffix() { return this._p.template_suffix; }
  get created_at() { return this._p.created_at; }
  get published_at() { return this._p.published_at; }
  get updated_at() { return this._p.updated_at; }
  get category() { return null; }
  get metafields() { return new MetafieldsDrop(this._w, this._p.metafields); }
  get ['gift_card?']() { return false; }
  get requires_selling_plan() { return false; }
  get selling_plan_groups() { return []; }
  get selected_selling_plan() { return null; }
  get selected_or_first_available_selling_plan_allocation() { return null; }
  get ['quantity_price_breaks_configured?']() { return false; }

  get variants() { return this._cached('variants', () => this._p.variants.map((v) => variantDrop(this._w, this._p, v))); }
  get available() { return this._p.variants.some((v) => v.available); }
  get price() { return this.price_min; }
  get price_min() { return Math.min(...this._p.variants.map((v) => v.price)); }
  get price_max() { return Math.max(...this._p.variants.map((v) => v.price)); }
  get price_varies() { return this.price_min !== this.price_max; }
  get compare_at_price() {
    const vals = this._p.variants.map((v) => v.compare_at_price).filter((x) => x !== null && x !== undefined);
    return vals.length ? Math.min(...vals) : null;
  }
  get compare_at_price_min() { return Math.min(...this._p.variants.map((v) => v.compare_at_price || 0)); }
  get compare_at_price_max() { return Math.max(...this._p.variants.map((v) => v.compare_at_price || 0)); }
  get compare_at_price_varies() { return this.compare_at_price_min !== this.compare_at_price_max; }

  get images() { return this._cached('images', () => this._p.images.map((img) => productImageDrop(this._w, this._p, img))); }
  get featured_image() { return this.images[0] || null; }
  get media() { return this.images; }
  get featured_media() { return this.images[0] || null; }

  get options() { return this._p.options.map((o) => o.name); }
  get has_only_default_variant() {
    const o = this._p.options;
    return o.length === 1 && o[0].name === 'Title' && this._p.variants.length === 1 && this._p.variants[0].title === 'Default Title';
  }
  get selected_variant() {
    const id = this._w.query.get('variant');
    let v = id ? this._p.variants.find((x) => String(x.id) === String(id)) : null;
    // Newer Shopify pickers request ?option_values=<product_option_value ids> instead of ?variant=
    const ov = this._w.query.get('option_values');
    if (!v && ov) {
      const wanted = ov.split(',').map((x) => x.trim());
      v = this._p.variants.find((x) => x.options.every((name, i) => wanted.includes(String(optionValueId(this._p, i, name)))));
    }
    return v ? variantDrop(this._w, this._p, v) : null;
  }
  get first_available_variant() {
    const v = this._p.variants.find((x) => x.available);
    return v ? variantDrop(this._w, this._p, v) : null;
  }
  get selected_or_first_available_variant() {
    return this.selected_variant || this.first_available_variant || this.variants[0] || null;
  }
  get options_with_values() {
    return this._cached('owv', () => {
      const current = this.selected_or_first_available_variant;
      const currentOpts = current ? current.options : [];
      return this._p.options.map((o, i) => {
        const values = o.values.map((name) => {
          const want = currentOpts.map((cv, j) => (j === i ? name : cv));
          const exact = this._p.variants.find((v) => v.options.every((ov, j) => ov === want[j]));
          const any = this._p.variants.find((v) => v.options[i] === name);
          const target = exact || any;
          return new ProductOptionValueDrop(this._w, {
            id: optionValueId(this._p, i, name),
            name,
            available: !!(exact && exact.available),
            selected: currentOpts[i] === name,
            variant: target ? variantDrop(this._w, this._p, target) : null,
          });
        });
        return new ProductOptionDrop(this._w, {
          name: o.name,
          position: i + 1,
          values,
          selected_value: currentOpts[i] ?? null,
        });
      });
    });
  }
  get options_by_name() { return new OptionsByNameDrop(this._w, this.options_with_values); }
  get collections() {
    return this._p.collections.map((h) => collectionDrop(this._w, h)).filter(Boolean);
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      handle: this.handle,
      description: this.description,
      published_at: this.published_at,
      created_at: this.created_at,
      vendor: this.vendor,
      type: this.type,
      tags: this.tags,
      price: this.price,
      price_min: this.price_min,
      price_max: this.price_max,
      available: this.available,
      price_varies: this.price_varies,
      compare_at_price: this.compare_at_price,
      compare_at_price_min: this.compare_at_price_min,
      compare_at_price_max: this.compare_at_price_max,
      compare_at_price_varies: this.compare_at_price_varies,
      variants: this.variants.map((v) => v.toJSON()),
      images: this.images.map((i) => i.src),
      featured_image: this.featured_image ? this.featured_image.src : null,
      options: this.options,
      media: this.images.map((i) => i.toJSON()),
      requires_selling_plan: false,
      selling_plan_groups: [],
      content: this.content,
    };
  }

  /** /products/<handle>.js format (options as objects). */
  ajaxJSON() {
    return {
      ...this.toJSON(),
      url: this.url,
      options: this._p.options.map((o) => ({ name: o.name, position: o.position, values: o.values })),
    };
  }
}

export function productDrop(w, rec) {
  if (!rec) return null;
  return cachedDrop(w, 'product', rec.id, () => new ProductDrop(w, rec));
}

export class AllProductsDrop extends BaseDrop {
  liquidMethodMissing(handle) { return productDrop(this._w, this._w.store.product(handle)) || undefined; }
  get size() { return this._w.store.products.length; }
}

// ---------------------------------------------------------------------------
// Collections

export class CollectionDrop extends BaseDrop {
  constructor(w, rec, { isPage = false, tags = [] } = {}) {
    super(w);
    Object.defineProperty(this, '_c', { value: rec, enumerable: false });
    Object.defineProperty(this, '_isPage', { value: isPage, enumerable: false });
    Object.defineProperty(this, '_tags', { value: tags, enumerable: false });
    Object.defineProperty(this, '_page', { value: null, enumerable: false, writable: true });
  }
  get id() { return this._c.id; }
  get handle() { return this._c.handle; }
  get title() { return this._c.title; }
  get url() { return `/collections/${this._c.handle}`; }
  get description() { return this._c.description; }
  get template_suffix() { return this._c.template_suffix; }
  get published_at() { return this._c.published_at; }
  get metafields() { return new MetafieldsDrop(this._w, this._c.metafields); }
  get image() { return this._c.image ? shopImageDrop(this._w, this._c.image) : null; }
  get featured_image() { return this.image || this._baseRecords()[0] && productDrop(this._w, this._baseRecords()[0]).featured_image || null; }
  get object_type() { return 'collection'; }
  get current_type() { return this._c.currentType || null; }
  get current_vendor() { return this._c.currentVendor || null; }
  get next_product() { return null; }
  get previous_product() { return null; }

  _baseRecords() {
    return this._cached('base', () => {
      let list = this._c.productHandles.map((h) => this._w.store.product(h)).filter(Boolean);
      if (this._tags.length) list = list.filter((p) => this._tags.every((t) => p.tags.map(handleize).includes(handleize(t))));
      return list;
    });
  }

  _resultRecords() {
    return this._cached('results', () => {
      let list = this._baseRecords();
      if (this._isPage) list = applyFacets(list, readFacetState(this._w.query));
      return sortProducts(list, this.sort_by || this.default_sort_by);
    });
  }

  __paginate(offset, limit) { this._page = { offset, limit }; }
  __unpaginate() { this._page = null; }
  __paginateTotal() { return this._resultRecords().length; }
  get __paginateProp() { return 'products'; }

  get products() {
    const all = this._resultRecords();
    const slice = this._page ? all.slice(this._page.offset, this._page.offset + this._page.limit) : all.slice(0, PRODUCTS_LIMIT);
    return slice.map((p) => productDrop(this._w, p));
  }
  get products_count() { return this._resultRecords().length; }
  get all_products_count() { return this._baseRecords().length; }
  get filters() {
    if (!this._isPage) return [];
    return this._cached('filters', () => buildFilters(this._baseRecords(), this._w.query, this.url));
  }
  get sort_options() { return COLLECTION_SORT_OPTIONS.map((o) => ({ ...o })); }
  get sort_by() {
    if (!this._isPage) return null;
    const s = this._w.query.get('sort_by');
    return s && COLLECTION_SORT_OPTIONS.some((o) => o.value === s) ? s : null;
  }
  get default_sort_by() { return this._c.sort_order || 'manual'; }
  get all_vendors() { return [...new Set(this._baseRecords().map((p) => p.vendor).filter(Boolean))].sort(); }
  get all_types() { return [...new Set(this._baseRecords().map((p) => p.product_type).filter(Boolean))].sort(); }
  get all_tags() { return [...new Set(this._baseRecords().flatMap((p) => p.tags))].sort(); }
  get tags() { return [...new Set(this._resultRecords().flatMap((p) => p.tags))].sort(); }
  toJSON() {
    return { id: this.id, handle: this.handle, title: this.title, description: this.description, published_at: this.published_at, image: this.image ? this.image.toJSON() : null, products_count: this.products_count };
  }
}

export function collectionDrop(w, handle, opts = null) {
  const rec = typeof handle === 'object' ? handle : w.store.collection(handle);
  if (!rec) return null;
  if (opts) return new CollectionDrop(w, rec, opts);
  return cachedDrop(w, 'collection', rec.handle, () => new CollectionDrop(w, rec));
}

export class CollectionsDrop extends BaseDrop {
  constructor(w) { super(w); Object.defineProperty(this, '_page', { value: null, enumerable: false, writable: true }); }
  liquidMethodMissing(handle) {
    if (handle === 'size') return this._all().length;
    if (handle === 'first') return this._list()[0];
    if (handle === 'last') { const l = this._list(); return l[l.length - 1]; }
    return collectionDrop(this._w, handle) || undefined;
  }
  // Underscore names: liquidjs calls any function found on a drop, so helpers must not shadow
  // collection handles such as `all` (collections.all).
  _all() { return this._w.store.collections.map((c) => collectionDrop(this._w, c.handle)); }
  _list() {
    const all = this._all();
    return this._page ? all.slice(this._page.offset, this._page.offset + this._page.limit) : all;
  }
  __paginate(offset, limit) { this._page = { offset, limit }; }
  __unpaginate() { this._page = null; }
  __paginateTotal() { return this._all().length; }
  get __paginateProp() { return null; }
  [Symbol.iterator]() { return this._list()[Symbol.iterator](); }
}

// ---------------------------------------------------------------------------
// Navigation

function linkType(url) {
  if (url === '/' ) return 'frontpage_link';
  if (url === '/collections/all') return 'catalog_link';
  if (url === '/collections') return 'collections_link';
  if (url.startsWith('/collections/')) return 'collection_link';
  if (url.startsWith('/products/')) return 'product_link';
  if (url.startsWith('/pages/')) return 'page_link';
  if (/^\/blogs\/[^/]+\/[^/]+/.test(url)) return 'article_link';
  if (url.startsWith('/blogs/')) return 'blog_link';
  if (url.startsWith('/policies/')) return 'policy_link';
  if (url.startsWith('/search')) return 'search_link';
  return 'http_link';
}

export class LinkDrop extends BaseDrop {
  constructor(w, data, depth = 1) {
    super(w);
    Object.defineProperty(this, '_l', { value: data, enumerable: false });
    Object.defineProperty(this, '_depth', { value: depth, enumerable: false });
  }
  get title() { return this._l.title; }
  get url() { return this._l.url; }
  get handle() { return handleize(this._l.title); }
  get type() { return linkType(this._l.url); }
  get links() { return this._cached('links', () => (this._l.links || []).map((l) => new LinkDrop(this._w, l, this._depth + 1))); }
  get levels() {
    const depth = (links) => (links.length ? 1 + Math.max(...links.map((l) => depth(l.links || []))) : 0);
    return depth(this._l.links || []);
  }
  get current() { return this._w.path === this._l.url.split('?')[0]; }
  get active() {
    const u = this._l.url.split('?')[0];
    if (this.current) return true;
    return u !== '/' && this._w.path.startsWith(`${u}/`);
  }
  get child_active() { return this.links.some((l) => l.active || l.child_active); }
  get child_current() { return this.links.some((l) => l.current || l.child_current); }
  get object() {
    const url = this._l.url;
    let m;
    if ((m = url.match(/^\/collections\/([^/?#]+)/))) return collectionDrop(this._w, m[1]);
    if ((m = url.match(/^\/products\/([^/?#]+)/))) return productDrop(this._w, this._w.store.product(m[1]));
    if ((m = url.match(/^\/pages\/([^/?#]+)/))) return pageDrop(this._w, this._w.store.page(m[1]));
    if ((m = url.match(/^\/blogs\/([^/?#]+)$/))) return blogDrop(this._w, this._w.store.blog(m[1]));
    return null;
  }
  toString() { return this._l.title; }
}

export class LinklistDrop extends BaseDrop {
  constructor(w, handle, links) {
    super(w);
    this.handle = handle;
    Object.defineProperty(this, '_links', { value: links, enumerable: false });
  }
  get title() { return this.handle === 'main-menu' ? 'Menú principal' : this.handle === 'footer' ? 'Menú del pie de página' : this.handle; }
  get id() { return 90000000 + (hashInt(this.handle) % 999999); }
  get links() { return this._cached('links', () => this._links.map((l) => new LinkDrop(this._w, l))); }
  get levels() {
    const depth = (links) => (links.length ? 1 + Math.max(...links.map((l) => depth(l.links || []))) : 0);
    return depth(this._links);
  }
}

export class LinklistsDrop extends BaseDrop {
  liquidMethodMissing(handle) { return linklistDrop(this._w, handle) || undefined; }
}

export function linklistDrop(w, handle) {
  if (handle instanceof LinklistDrop) return handle;
  const links = w.store.menu(String(handle));
  if (!links) return null;
  return cachedDrop(w, 'linklist', handle, () => new LinklistDrop(w, String(handle), links));
}

// ---------------------------------------------------------------------------
// Pages, blogs, articles, policies

export class PageDrop extends BaseDrop {
  constructor(w, p) { super(w); Object.defineProperty(this, '_p', { value: p, enumerable: false }); }
  get id() { return this._p.id; }
  get handle() { return this._p.handle; }
  get title() { return this._p.title; }
  get content() { return this._p.content; }
  get url() { return `/pages/${this._p.handle}`; }
  get author() { return this._p.author; }
  get template_suffix() { return this._p.template_suffix; }
  get published_at() { return this._p.published_at; }
  get metafields() { return new MetafieldsDrop(this._w, this._p.metafields); }
  get object_type() { return 'page'; }
}

export function pageDrop(w, rec) {
  if (!rec) return null;
  return cachedDrop(w, 'page', rec.handle, () => new PageDrop(w, rec));
}

export class PagesDrop extends BaseDrop {
  liquidMethodMissing(handle) { return pageDrop(this._w, this._w.store.page(handle)) || undefined; }
}

export class ArticleDrop extends BaseDrop {
  constructor(w, a) { super(w); Object.defineProperty(this, '_a', { value: a, enumerable: false }); }
  get id() { return this._a.id; }
  get handle() { return this._a.handle; }
  get title() { return this._a.title; }
  get author() { return this._a.author; }
  get user() { return { name: this._a.author, first_name: this._a.author, last_name: '', bio: '', image: null }; }
  get content() { return this._a.content; }
  get excerpt() { return this._a.excerpt; }
  get excerpt_or_content() { return this._a.excerpt || this._a.content; }
  get image() { return this._a.image ? shopImageDrop(this._w, this._a.image) : null; }
  get published_at() { return this._a.published_at; }
  get created_at() { return this._a.published_at; }
  get updated_at() { return this._a.published_at; }
  get tags() { return this._a.tags; }
  get url() { return `/blogs/${this._a.blogHandle}/${this._a.handle}`; }
  get comments() { return []; }
  get comments_count() { return 0; }
  get ['comments_enabled?']() { return false; }
  get comment_post_url() { return `${this.url}/comments`; }
  get moderated() { return false; }
  get blog() { return blogDrop(this._w, this._w.store.blog(this._a.blogHandle)); }
  get metafields() { return new MetafieldsDrop(this._w, null); }
  get object_type() { return 'article'; }
}

export class BlogDrop extends BaseDrop {
  constructor(w, b) {
    super(w);
    Object.defineProperty(this, '_b', { value: b, enumerable: false });
    Object.defineProperty(this, '_page', { value: null, enumerable: false, writable: true });
  }
  get id() { return this._b.id; }
  get handle() { return this._b.handle; }
  get title() { return this._b.title; }
  get url() { return `/blogs/${this._b.handle}`; }
  _allArticles() {
    const tag = this._w.currentTags?.[0];
    const list = this._b.articles.filter((a) => !tag || a.tags.map(handleize).includes(handleize(tag)));
    return list.map((a) => new ArticleDrop(this._w, a));
  }
  get articles() {
    const all = this._allArticles();
    return this._page ? all.slice(this._page.offset, this._page.offset + this._page.limit) : all;
  }
  get articles_count() { return this._allArticles().length; }
  get all_tags() { return [...new Set(this._b.articles.flatMap((a) => a.tags))]; }
  get tags() { return this.all_tags; }
  get ['comments_enabled?']() { return false; }
  get moderated() { return false; }
  get next_article() { return null; }
  get previous_article() { return null; }
  get metafields() { return new MetafieldsDrop(this._w, null); }
  get template_suffix() { return null; }
  __paginate(offset, limit) { this._page = { offset, limit }; }
  __unpaginate() { this._page = null; }
  __paginateTotal() { return this._allArticles().length; }
  get __paginateProp() { return 'articles'; }
}

export function blogDrop(w, rec) {
  if (!rec) return null;
  return cachedDrop(w, 'blog', rec.handle, () => new BlogDrop(w, rec));
}

export class BlogsDrop extends BaseDrop {
  liquidMethodMissing(handle) { return blogDrop(this._w, this._w.store.blog(handle)) || undefined; }
}

export class PolicyDrop extends BaseDrop {
  constructor(w, p) { super(w); Object.assign(this, { id: p.id, title: p.title, url: p.url, body: p.body, handle: p.handle }); }
  toString() { return this.title; }
}

// ---------------------------------------------------------------------------
// Shop, localization, request, template

export class ShopDrop extends BaseDrop {
  get _s() { return this._w.store.shop; }
  get id() { return 84622508276; }
  get name() { return this._s.name; }
  get url() { return this._w.origin; }
  get secure_url() { return this._w.origin; }
  get domain() { return this._s.domain; }
  get permanent_domain() { return 'mibicicleta.myshopify.com'; }
  get email() { return this._s.email || ''; }
  get phone() { return this._s.phone || ''; }
  get description() { return this._s.description || ''; }
  get currency() { return this._s.currency; }
  get money_format() { return this._s.money_format; }
  get money_with_currency_format() { return this._s.money_with_currency_format; }
  get locale() { return 'es'; }
  get enabled_currencies() { return [{ iso_code: 'PEN', name: 'Sol peruano', symbol: 'S/' }]; }
  get enabled_payment_types() { return ['visa', 'master', 'american_express', 'diners_club']; }
  get published_locales() { return [{ iso_code: 'es', name: 'Español', endonym_name: 'español', primary: true, root_url: '/' }]; }
  get customer_accounts_enabled() { return true; }
  get customer_accounts_optional() { return true; }
  get accepts_gift_cards() { return true; }
  get taxes_included() { return true; }
  get password_message() { return ''; }
  get products_count() { return this._w.store.products.length; }
  get collections_count() { return this._w.store.collections.length; }
  get types() { return [...new Set(this._w.store.products.map((p) => p.product_type).filter(Boolean))].sort(); }
  get vendors() { return [...new Set(this._w.store.products.map((p) => p.vendor).filter(Boolean))].sort(); }
  get policies() { return this._w.store.policies.map((p) => new PolicyDrop(this._w, p)); }
  _policy(handle) { const p = this._w.store.policy(handle); return p ? new PolicyDrop(this._w, p) : null; }
  get refund_policy() { return this._policy('refund-policy'); }
  get privacy_policy() { return this._policy('privacy-policy'); }
  get terms_of_service() { return this._policy('terms-of-service'); }
  get shipping_policy() { return this._policy('shipping-policy'); }
  get subscription_policy() { return null; }
  get contact_policy() { return null; }
  get address() {
    return { city: this._s.city || 'Lima', country: this._s.country || 'Peru', country_code: 'PE', province: 'Lima', province_code: 'LIM', address1: '', address2: '', zip: '', company: this._s.name, summary: `${this._s.city || 'Lima'}, ${this._s.country || 'Peru'}` };
  }
  get brand() { return { logo: null, square_logo: null, short_description: '', slogan: '', colors: {}, cover_image: null, metafields: {} }; }
  get metafields() { return new MetafieldsDrop(this._w, null); }
  get metaobjects() { return {}; }
}

const COUNTRY_PE = { iso_code: 'PE', name: 'Perú', unit_system: 'metric', currency: { iso_code: 'PEN', name: 'Sol peruano', symbol: 'S/' }, market: { handle: 'pe', id: 1 } };
const LANGUAGE_ES = { iso_code: 'es', name: 'Spanish', endonym_name: 'español', primary: true, root_url: '/' };

export function localizationObject() {
  return {
    available_countries: [COUNTRY_PE],
    available_languages: [LANGUAGE_ES],
    country: COUNTRY_PE,
    language: LANGUAGE_ES,
    market: { handle: 'pe', id: 1, metafields: {} },
  };
}

export class TemplateDrop extends BaseDrop {
  constructor(w, name, suffix, directory = null) { super(w); this.name = name; this.suffix = suffix || null; this.directory = directory; }
  valueOf() { return this.suffix ? `${this.name}.${this.suffix}` : this.name; }
  toString() { return this.valueOf(); }
}

// ---------------------------------------------------------------------------
// Cart

export class LineItemDrop extends BaseDrop {
  constructor(w, line, index) {
    super(w);
    Object.defineProperty(this, '_l', { value: line, enumerable: false });
    Object.defineProperty(this, '_i', { value: index, enumerable: false });
    Object.defineProperty(this, '_json', { value: w.cart.lineJson(line), enumerable: false });
  }
  get key() { return this._l.key; }
  get id() { return this._l.variant.id; }
  get variant_id() { return this._l.variant.id; }
  get product_id() { return this._l.product.id; }
  get product() { return productDrop(this._w, this._l.product); }
  get variant() { return variantDrop(this._w, this._l.product, this._l.variant); }
  get title() { return this._json.title; }
  get product_title() { return this._l.product.title; }
  get variant_title() { return this._json.variant_title; }
  get options_with_values() { return this._json.options_with_values; }
  get quantity() { return this._l.quantity; }
  get price() { return this._json.price; }
  get original_price() { return this._json.original_price; }
  get final_price() { return this._json.final_price; }
  get line_price() { return this._json.line_price; }
  get final_line_price() { return this._json.final_line_price; }
  get original_line_price() { return this._json.original_line_price; }
  get total_discount() { return 0; }
  get line_level_discount_allocations() { return []; }
  get line_level_total_discount() { return 0; }
  get discount_allocations() { return []; }
  get discounts() { return []; }
  get url() { return this._json.url; }
  get url_to_remove() { return `/cart/change?line=${this._i + 1}&quantity=0`; }
  get image() {
    const v = this.variant.featured_image;
    return v || this.product.featured_image;
  }
  get properties() { return this._l.properties || {}; }
  get selling_plan_allocation() { return null; }
  get unit_price_measurement() { return null; }
  get unit_price() { return null; }
  get sku() { return this._l.variant.sku || null; }
  get vendor() { return this._l.product.vendor; }
  get requires_shipping() { return this._l.variant.requires_shipping; }
  get taxable() { return this._l.variant.taxable; }
  get gift_card() { return false; }
  get successfully_fulfilled_quantity() { return 0; }
  get fulfillment() { return null; }
  get item_components() { return []; }
  get message() { return ''; }
  get has_components() { return false; }
  get quantity_rule() { return { min: 1, max: null, increment: 1 }; }
  get index() { return this._i + 1; }
  toJSON() { return this._json; }
}

export class CartDrop extends BaseDrop {
  get _t() { return this._cached('t', () => this._w.cart.totals()); }
  get items() { return this._cached('items', () => this._t.lines.map((l, i) => new LineItemDrop(this._w, l, i))); }
  get item_count() { return this._t.item_count; }
  get total_price() { return this._t.total_price; }
  get original_total_price() { return this._t.total_price; }
  get items_subtotal_price() { return this._t.total_price; }
  get checkout_charge_amount() { return this._t.total_price; }
  get total_discount() { return 0; }
  get total_weight() { return this._t.total_weight; }
  get cart_level_discount_applications() { return []; }
  get discount_applications() { return []; }
  get note() { return this._w.cart.note; }
  get attributes() { return this._w.cart.attributes; }
  get currency() { return { iso_code: this._w.store.shop.currency || 'PEN', name: 'Sol peruano', symbol: 'S/' }; }
  get requires_shipping() { return this._t.requires_shipping; }
  get ['empty?']() { return this._t.item_count === 0; }
  get taxes_included() { return true; }
  get duties_included() { return false; }
  get token() { return this._w.cart.token; }
  toJSON() { return this._w.cart.json(); }
}

// ---------------------------------------------------------------------------
// Search, predictive search, recommendations

function searchable(p) {
  return normalizeText([p.title, p.vendor, p.product_type, p.tags.join(' '), p.variants.map((v) => `${v.sku} ${v.title}`).join(' '), p.description.replace(/<[^>]+>/g, ' ')].join(' '));
}

export function searchProducts(store, terms) {
  const words = normalizeText(terms).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return store.products.filter((p) => {
    const hay = searchable(p);
    return words.every((w) => hay.includes(w));
  });
}

function titleScore(p, terms) {
  const t = normalizeText(p.title);
  const words = normalizeText(terms).split(/\s+/).filter(Boolean);
  return words.reduce((s, w) => s + (t.includes(w) ? 2 : 0) + (t.startsWith(w) ? 1 : 0), 0);
}

export class SearchDrop extends BaseDrop {
  constructor(w) {
    super(w);
    Object.defineProperty(this, '_page', { value: null, enumerable: false, writable: true });
  }
  get terms() { return this._w.query.get('q') || ''; }
  get performed() { return this.terms.trim().length > 0; }
  get types() {
    const t = this._w.query.get('type');
    return t ? t.split(',').map((x) => x.trim()).filter(Boolean) : ['article', 'page', 'product'];
  }
  _baseProducts() {
    return this._cached('base', () => (this.performed && this.types.includes('product') ? searchProducts(this._w.store, this.terms) : []));
  }
  _resultList() {
    return this._cached('results', () => {
      if (!this.performed) return [];
      let products = applyFacets(this._baseProducts(), readFacetState(this._w.query));
      const sortBy = this.sort_by || 'relevance';
      products = sortBy === 'relevance'
        ? [...products].sort((a, b) => titleScore(b, this.terms) - titleScore(a, this.terms) || a.index - b.index)
        : sortProducts(products, sortBy);
      const out = products.map((p) => productDrop(this._w, p));
      const words = normalizeText(this.terms).split(/\s+/).filter(Boolean);
      if (this.types.includes('page')) {
        for (const pg of this._w.store.pages) {
          const hay = normalizeText(`${pg.title} ${pg.content}`);
          if (words.every((x) => hay.includes(x))) out.push(pageDrop(this._w, pg));
        }
      }
      if (this.types.includes('article')) {
        for (const b of this._w.store.blogs) {
          for (const a of b.articles) {
            const hay = normalizeText(`${a.title} ${a.content}`);
            if (words.every((x) => hay.includes(x))) out.push(new ArticleDrop(this._w, a));
          }
        }
      }
      return out;
    });
  }
  get results() {
    const all = this._resultList();
    return this._page ? all.slice(this._page.offset, this._page.offset + this._page.limit) : all;
  }
  get results_count() { return this._resultList().length; }
  get filters() {
    if (!this.performed) return [];
    return this._cached('filters', () => buildFilters(this._baseProducts(), this._w.query, '/search'));
  }
  get sort_options() { return SEARCH_SORT_OPTIONS.map((o) => ({ ...o })); }
  get sort_by() {
    const s = this._w.query.get('sort_by');
    return s && SEARCH_SORT_OPTIONS.some((o) => o.value === s) ? s : null;
  }
  get default_sort_by() { return 'relevance'; }
  get url() { return buildUrl('/search', cleanQuery(this._w.query)); }
  __paginate(offset, limit) { this._page = { offset, limit }; }
  __unpaginate() { this._page = null; }
  __paginateTotal() { return this._resultList().length; }
  get __paginateProp() { return 'results'; }
}

export class PredictiveSearchDrop extends BaseDrop {
  constructor(w, { q, types, limit }) {
    super(w);
    this.terms = q;
    this.types = types;
    Object.defineProperty(this, '_limit', { value: limit, enumerable: false });
  }
  get performed() { return this.terms.trim().length > 0; }
  get resources() {
    return this._cached('res', () => {
      const w = this._w;
      const q = this.terms;
      const limit = this._limit;
      const has = (t) => this.types.includes(t);
      const nq = normalizeText(q).trim();
      const words = nq.split(/\s+/).filter(Boolean);
      const products = has('product')
        ? searchProducts(w.store, q)
          .sort((a, b) => titleScore(b, q) - titleScore(a, q) || a.index - b.index)
          .slice(0, limit).map((p) => productDrop(w, p))
        : [];
      const collections = has('collection')
        ? w.store.collections.filter((c) => words.length && words.every((x) => normalizeText(c.title).includes(x))).slice(0, limit).map((c) => collectionDrop(w, c.handle))
        : [];
      const pages = has('page')
        ? w.store.pages.filter((p) => words.length && words.every((x) => normalizeText(p.title).includes(x))).slice(0, limit).map((p) => pageDrop(w, p))
        : [];
      const articles = [];
      let queries = [];
      if (has('query') && nq) {
        const suggestions = new Set([q.trim().toLowerCase()]);
        for (const p of w.store.products) {
          const words2 = p.title.toLowerCase().split(/\s+/);
          const idx = words2.findIndex((x) => normalizeText(x).startsWith(words[words.length - 1] || ''));
          if (idx >= 0) suggestions.add(words2.slice(idx, idx + 2).join(' ').replace(/[^\p{L}\p{N}\s-]/gu, ''));
          if (suggestions.size >= Math.min(limit, 4)) break;
        }
        queries = [...suggestions].filter(Boolean).map((text) => {
          const ntext = normalizeText(text);
          const i = ntext.indexOf(nq);
          const styled = i >= 0
            ? `${escapeHtml(text.slice(0, i))}<mark class="predictive-search__highlight">${escapeHtml(text.slice(i, i + nq.length))}</mark>${escapeHtml(text.slice(i + nq.length))}`
            : escapeHtml(text);
          return { text, styled_text: styled, url: `/search?q=${encodeURIComponent(text)}&_pos=1&_psq=${encodeURIComponent(q)}&_ss=e&_v=1.0` };
        });
      }
      return { products, collections, pages, articles, queries };
    });
  }
  toJSON() {
    const r = this.resources;
    return {
      resources: {
        results: {
          products: r.products.map((p) => ({
            ...p.toJSON(),
            url: p.url,
            price: String(p.price / 100),
            image: p.featured_image ? p.featured_image.src : null,
            featured_image: p.featured_image ? { url: p.featured_image.src, alt: p.featured_image.alt, width: p.featured_image.width, height: p.featured_image.height, aspect_ratio: p.featured_image.aspect_ratio } : null,
          })),
          collections: r.collections.map((c) => ({ ...c.toJSON(), url: c.url })),
          pages: r.pages.map((p) => ({ id: p.id, title: p.title, handle: p.handle, url: p.url, body: p.content })),
          articles: [],
          queries: r.queries,
        },
      },
    };
  }
}

export class RecommendationsDrop extends BaseDrop {
  constructor(w, { product, intent, limit }) {
    super(w);
    this.intent = intent;
    Object.defineProperty(this, '_p', { value: product, enumerable: false });
    Object.defineProperty(this, '_limit', { value: limit, enumerable: false });
  }
  get performed() { return true; }
  get products() {
    return this._cached('products', () => {
      const src = this._p;
      if (!src) return [];
      const others = this._w.store.products.filter((p) => p.id !== src.id);
      let ranked;
      if (this.intent === 'complementary') {
        ranked = others.filter((p) => p.product_type !== src.product_type);
      } else {
        ranked = others
          .map((p) => ({ p, shared: p.collections.filter((c) => src.collections.includes(c)).length }))
          .filter((x) => x.shared > 0)
          .sort((a, b) => b.shared - a.shared || a.p.index - b.p.index)
          .map((x) => x.p);
      }
      return ranked.slice(0, this._limit).map((p) => productDrop(this._w, p));
    });
  }
  get products_count() { return this.products.length; }
}
