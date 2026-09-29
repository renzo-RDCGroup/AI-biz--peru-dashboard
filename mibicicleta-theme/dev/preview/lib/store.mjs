// Mock catalog: loads dev/mock/store.json and normalizes it into plain records that the drops wrap.
import fs from 'node:fs';
import path from 'node:path';
import { ImageRegistry } from './images.mjs';
import { FIXTURES_DIR } from './paths.mjs';
import { escapeHtml, handleize, hashInt } from './util.mjs';

const DEFAULT_SHOP = {
  name: 'Mi Bicicleta',
  domain: 'mibicicleta.pe',
  currency: 'PEN',
  money_format: 'S/ {{amount}}',
  money_with_currency_format: 'S/ {{amount}} PEN',
  locale: 'es',
};

function toHtml(text) {
  if (!text) return '';
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  return String(text).split(/\n{2,}/).map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
}

export const DEFAULT_FIXTURE_PRODUCTS = path.join(FIXTURES_DIR, 'products.json');

export class Store {
  /**
   * @param mockPath         dev/mock/store.json (the real catalog sample)
   * @param fixturesPath     preview-only products (fixtures/products.json): reachable by handle/id
   *                         (all_products, /products/x, cart) but never listed anywhere. null = none.
   */
  constructor(mockPath, fixturesPath = DEFAULT_FIXTURE_PRODUCTS) {
    this.mockPath = mockPath;
    const raw = JSON.parse(fs.readFileSync(mockPath, 'utf8'));
    this.raw = raw;
    this.registry = new ImageRegistry();
    this.shop = { ...DEFAULT_SHOP, ...(raw.shop || {}) };
    this.buildProducts(raw.products || []);
    this.addFixtureProducts(fixturesPath);
    this.buildCollections(raw.collections || []);
    this.menus = raw.menus || {};
    this.shopImages = raw.shop_images || [];
    for (const name of this.shopImages) this.registry.shop(name);
    this.buildPages(raw.pages || []);
    this.buildBlogs(raw.blogs || null);
    this.policies = [
      ['refund-policy', 'Política de reembolso'],
      ['privacy-policy', 'Política de privacidad'],
      ['terms-of-service', 'Términos del servicio'],
      ['shipping-policy', 'Política de envío'],
    ].map(([handle, title], i) => ({
      id: 70000000000 + i,
      handle,
      title,
      url: `/policies/${handle}`,
      body: `<p>${escapeHtml(title)} — contenido de ejemplo del preview local (la política real vive en Shopify).</p>`,
    }));
  }

  buildProducts(list) {
    this.products = [];
    this.productsByHandle = new Map();
    this.productsById = new Map();
    this.variantsById = new Map();
    list.forEach((p, index) => {
      const product = this.normalizeProduct(p, index);
      this.products.push(product);
    });
  }

  /** Preview-only products: indexed by handle/id/variant id, but not pushed to this.products. */
  addFixtureProducts(file) {
    if (!file || !fs.existsSync(file)) return;
    let list = [];
    try { list = JSON.parse(fs.readFileSync(file, 'utf8')).products || []; } catch (e) {
      console.warn(`[preview] ignoring ${file}: ${e.message}`);
      return;
    }
    list.forEach((p, i) => {
      if (this.productsByHandle.has(p.handle)) return;
      const product = this.normalizeProduct(p, 100000 + i);
      product.fixture = true;
    });
  }

  normalizeProduct(p, index) {
    const options = (p.options || []).map((o, i) => ({ name: o.name, position: i + 1, values: o.values || [] }));
    const images = (p.images || []).map((src, i) => {
      const id = 40000000000000 + (hashInt(`${p.id}:${i}`) % 999999999);
      const entry = this.registry.product({
        handle: p.handle,
        title: p.title,
        type: p.product_type,
        position: i + 1,
        count: p.images.length,
        cdn: src,
        id,
        productId: p.id,
      });
      return { id, src, position: i + 1, width: entry.width, height: entry.height, alt: null, entry, product_id: p.id };
    });
    const product = {
      id: p.id,
      handle: p.handle,
      title: p.title,
      vendor: p.vendor || '',
      product_type: p.product_type || '',
      tags: p.tags || [],
      created_at: p.created_at || '2026-01-01T00:00:00Z',
      published_at: p.published_at || p.created_at || '2026-01-01T00:00:00Z',
      updated_at: p.updated_at || p.created_at || '2026-01-01T00:00:00Z',
      description: toHtml(p.description || ''),
      options: options.length ? options : [{ name: 'Title', position: 1, values: ['Default Title'] }],
      images,
      collections: p.collections || [],
      template_suffix: p.template_suffix || null,
      metafields: p.metafields || null,
      index,
      variants: [],
    };
    product.variants = (p.variants || []).map((v, vi) => {
      const opts = v.options && v.options.length ? v.options : [v.title];
      const variant = {
        id: v.id,
        product_id: p.id,
        title: v.title,
        price: v.price ?? 0,
        compare_at_price: v.compare_at_price ?? null,
        available: v.available !== false,
        inventory_quantity: v.inventory_quantity ?? 0,
        inventory_policy: v.inventory_policy || 'deny',
        inventory_management: v.inventory_management ?? null,
        sku: v.sku || '',
        barcode: v.barcode ?? null,
        options: opts,
        option1: opts[0] ?? null,
        option2: opts[1] ?? null,
        option3: opts[2] ?? null,
        weight: v.grams ?? v.weight ?? 0,
        requires_shipping: v.requires_shipping !== false,
        taxable: v.taxable !== false,
        image_position: v.image_position ?? null,
        position: vi + 1,
      };
      this.variantsById.set(String(v.id), { variant, product });
      return variant;
    });
    this.productsByHandle.set(product.handle, product);
    this.productsById.set(String(product.id), product);
    return product;
  }

  buildCollections(list) {
    this.collections = [];
    this.collectionsByHandle = new Map();
    list.forEach((c, i) => {
      const col = {
        id: 450000000000 + i,
        handle: c.handle,
        title: c.title,
        description: toHtml(c.description || ''),
        image: c.image || null,
        mockCount: c.count ?? null,
        productHandles: this.products.filter((p) => p.collections.includes(c.handle)).map((p) => p.handle),
        sort_order: c.sort_order || 'manual',
        published_at: '2026-01-01T00:00:00Z',
        template_suffix: c.template_suffix || null,
      };
      this.collections.push(col);
      this.collectionsByHandle.set(col.handle, col);
    });
    // Collections referenced by products but absent from the list (e.g. frontpage) still exist.
    for (const p of this.products) {
      for (const h of p.collections) {
        if (!this.collectionsByHandle.has(h)) {
          const col = {
            id: 450000000000 + this.collections.length,
            handle: h,
            title: h.replace(/-/g, ' ').replace(/^\w/, (m) => m.toUpperCase()),
            description: '',
            image: null,
            productHandles: this.products.filter((x) => x.collections.includes(h)).map((x) => x.handle),
            sort_order: 'manual',
            published_at: '2026-01-01T00:00:00Z',
            template_suffix: null,
          };
          this.collections.push(col);
          this.collectionsByHandle.set(h, col);
        }
      }
    }
    this.allCollection = {
      id: 449999999999,
      handle: 'all',
      title: 'Productos',
      description: '',
      image: null,
      productHandles: this.products.map((p) => p.handle),
      sort_order: 'manual',
      published_at: '2026-01-01T00:00:00Z',
      template_suffix: null,
      virtual: true,
    };
  }

  buildPages(list) {
    this.pages = list.map((p, i) => ({
      id: 110000000000 + i,
      handle: p.handle,
      title: p.title,
      content: toHtml(p.body || p.content || ''),
      author: p.author || null,
      template_suffix: p.template_suffix ?? null,
      published_at: p.published_at || '2026-01-01T00:00:00Z',
    }));
    this.pagesByHandle = new Map(this.pages.map((p) => [p.handle, p]));
  }

  buildBlogs(list) {
    const blogs = list || [{ handle: 'news', title: 'Noticias', articles: [] }];
    this.blogs = blogs.map((b, i) => ({
      id: 120000000000 + i,
      handle: b.handle,
      title: b.title,
      articles: (b.articles || []).map((a, j) => ({
        id: 130000000000 + i * 1000 + j,
        handle: a.handle || handleize(a.title),
        title: a.title,
        author: a.author || 'Mi Bicicleta',
        content: toHtml(a.content || a.body || ''),
        excerpt: toHtml(a.excerpt || ''),
        tags: a.tags || [],
        image: a.image || null,
        published_at: a.published_at || '2026-01-01T00:00:00Z',
        blogHandle: b.handle,
      })),
    }));
    this.blogsByHandle = new Map(this.blogs.map((b) => [b.handle, b]));
  }

  product(handle) { return this.productsByHandle.get(String(handle)) || null; }
  collection(handle) {
    if (handle === 'all') return this.allCollection;
    return this.collectionsByHandle.get(String(handle)) || null;
  }
  page(handle) { return this.pagesByHandle.get(String(handle)) || null; }
  blog(handle) { return this.blogsByHandle.get(String(handle)) || null; }
  variant(id) { return this.variantsById.get(String(id)) || null; }
  menu(handle) { return this.menus[handle] || null; }
  policy(handle) { return this.policies.find((p) => p.handle === handle) || null; }
}
