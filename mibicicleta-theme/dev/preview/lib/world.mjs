// Per-request rendering context ("world"): request info, error list, drop cache and the Shopify
// global objects handed to liquidjs as `globals` (visible inside {% render %} like on Shopify).
import { RequestErrors } from './errors.mjs';
import {
  AllProductsDrop, BaseDrop, BlogsDrop, CartDrop, CollectionsDrop, LinklistsDrop, PagesDrop,
  PredictiveSearchDrop, RecommendationsDrop, SearchDrop, ShopDrop, TemplateDrop, localizationObject,
  productDrop, collectionDrop, pageDrop, blogDrop, shopImageDrop, ArticleDrop, PolicyDrop,
} from './drops.mjs';
import { themeSettings } from './settings.mjs';

const WORLDS = new WeakMap();

export function worldOf(ctx) {
  return ctx ? WORLDS.get(ctx.globals) : undefined;
}

export const ROUTES = Object.freeze({
  root_url: '/',
  account_url: '/account',
  account_login_url: '/account/login',
  account_logout_url: '/account/logout',
  account_register_url: '/account/register',
  account_addresses_url: '/account/addresses',
  account_recover_url: '/account/recover',
  collections_url: '/collections',
  all_products_collection_url: '/collections/all',
  search_url: '/search',
  predictive_search_url: '/search/suggest',
  cart_url: '/cart',
  cart_add_url: '/cart/add',
  cart_change_url: '/cart/change',
  cart_clear_url: '/cart/clear',
  cart_update_url: '/cart/update',
  product_recommendations_url: '/recommendations/products',
  storefront_login_url: '/password',
});

class ImagesDrop extends BaseDrop {
  liquidMethodMissing(name) { return shopImageDrop(this._w, name) || undefined; }
}

const PAGE_TITLES = {
  'list-collections': 'Colecciones',
  cart: 'Tu carrito',
  '404': '404 No encontrado',
  search: 'Buscar',
};

export class World {
  /**
   * @param app     App (theme, store, cart, engine, renderer, errorLog)
   * @param opts    { url: URL, route: {pageType, template, suffix, objects, status, handle} }
   */
  constructor(app, { url, route }) {
    this.app = app;
    this.theme = app.theme;
    this.store = app.store;
    this.registry = app.store.registry;
    this.cart = app.cart;
    this.url = url;
    this.query = url.searchParams;
    this.path = decodeURIComponent(url.pathname);
    this.origin = url.origin;
    this.route = route;
    this.errors = new RequestErrors(app.errorLog, url.pathname + url.search);
    this.dropCache = new Map();
    this.sectionStack = [];
    this.layoutOverride = undefined;
    this.currentPage = null;
    this.currentTags = route.objects?.tags?.length ? route.objects.tags : null;
    this.colorSchemes = {};
    this.globals = this.buildGlobals();
    WORLDS.set(this.globals, this);
  }

  get locale() {
    if (!this._locale) {
      const loc = this.theme.locale();
      if (loc.error) this.errors.error(loc.error, { file: loc.file });
      this._locale = loc.data || {};
    }
    return this._locale;
  }

  get currentSection() {
    return this.sectionStack[this.sectionStack.length - 1] || null;
  }

  buildGlobals() {
    const w = this;
    const r = this.route;
    const o = r.objects || {};
    const g = {};
    const lazy = (name, fn) => {
      let done = false;
      let val;
      Object.defineProperty(g, name, {
        enumerable: true,
        configurable: true,
        get() { if (!done) { val = fn(); done = true; } return val; },
        set(v) { val = v; done = true; },
      });
    };

    lazy('shop', () => new ShopDrop(w));
    lazy('settings', () => themeSettings(w));
    lazy('routes', () => ({ ...ROUTES }));
    lazy('request', () => ({
      page_type: r.pageType,
      path: w.path,
      host: w.url.host,
      origin: w.origin,
      locale: { iso_code: 'es', name: 'Español', endonym_name: 'español', primary: true, root_url: '/' },
      design_mode: false,
      visual_preview_mode: false,
    }));
    lazy('template', () => new TemplateDrop(w, r.template, r.suffix, r.directory || null));
    lazy('cart', () => new CartDrop(w));
    lazy('collections', () => new CollectionsDrop(w));
    lazy('all_products', () => new AllProductsDrop(w));
    lazy('linklists', () => new LinklistsDrop(w));
    lazy('pages', () => new PagesDrop(w));
    lazy('blogs', () => new BlogsDrop(w));
    lazy('images', () => new ImagesDrop(w));
    lazy('localization', () => localizationObject());
    lazy('canonical_url', () => `${w.origin}${w.path}`);
    lazy('product', () => (o.product ? productDrop(w, o.product) : null));
    lazy('collection', () => (o.collection ? collectionDrop(w, o.collection, { isPage: true, tags: o.tags || [] }) : null));
    lazy('page', () => (o.page ? pageDrop(w, o.page) : o.policy ? new PolicyDrop(w, o.policy) : null));
    lazy('blog', () => (o.blog ? blogDrop(w, o.blog) : null));
    lazy('article', () => (o.article ? new ArticleDrop(w, o.article) : null));
    lazy('search', () => (r.pageType === 'search' ? new SearchDrop(w) : null));
    lazy('recommendations', () => new RecommendationsDrop(w, o.recommendations || { product: null, intent: null, limit: 0 }));
    lazy('predictive_search', () => (o.predictive ? new PredictiveSearchDrop(w, o.predictive) : null));
    lazy('current_tags', () => w.currentTags);
    lazy('page_title', () => w.pageTitle());
    lazy('page_description', () => w.pageDescription());
    lazy('content_for_header', () => w.contentForHeader());
    Object.defineProperty(g, 'current_page', { enumerable: true, get: () => w.currentPage || 1 });
    g.content_for_layout = '';
    g.content_for_index = '';
    g.customer = null;
    g.checkout = null;
    g.gift_card = null;
    g.handle = r.handle || '';
    g.additional_checkout_buttons = false;
    g.content_for_additional_checkout_buttons = '';
    g.powered_by_link = '<a target="_blank" rel="nofollow" href="https://www.shopify.com?utm_campaign=poweredby&amp;utm_medium=shopify&amp;utm_source=onlinestore">Tecnología de Shopify</a>';
    g.metaobjects = {};
    return g;
  }

  pageTitle() {
    const g = this.globals;
    const shopName = this.store.shop.name;
    switch (this.route.pageType) {
      case 'index': return shopName;
      case 'product': return g.product?.title || shopName;
      case 'collection': return g.collection?.title || shopName;
      case 'page': return g.page?.title || shopName;
      case 'blog': return g.blog?.title || shopName;
      case 'article': return g.article?.title || shopName;
      case 'search': {
        const s = g.search;
        return s?.performed ? `Buscar: ${s.results_count} resultados encontrados para "${s.terms}"` : PAGE_TITLES.search;
      }
      case 'password': return shopName;
      default: return PAGE_TITLES[this.route.pageType] || shopName;
    }
  }

  pageDescription() {
    const strip = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 320);
    const g = this.globals;
    if (this.route.pageType === 'product') return strip(g.product?.description) || null;
    if (this.route.pageType === 'collection') return strip(g.collection?.description) || null;
    if (this.route.pageType === 'page') return strip(g.page?.content) || null;
    return null;
  }

  contentForHeader() {
    const { css, js } = this.theme.compiledAssets();
    // Minimal bootstrap that a real storefront's content_for_header defines (no analytics, no apps).
    const shopify = {
      shop: 'mibicicleta.myshopify.com',
      locale: 'es',
      currency: { active: this.store.shop.currency || 'PEN', rate: '1.0' },
      country: 'PE',
      theme: { name: 'Preview local', id: 1, schema_name: null, schema_version: null, theme_store_id: null, role: 'unpublished' },
      cdnHost: `${this.url.host}/cdn`,
      routes: { root: '/' },
    };
    let out = `<script>window.Shopify = window.Shopify || {}; Object.assign(window.Shopify, ${JSON.stringify(shopify).replace(/</g, '\\u003c')});</script>`;
    if (css) out += '<link rel="stylesheet" href="/_compiled/styles.css">';
    if (js) out += '<script src="/_compiled/scripts.js" defer="defer"></script>';
    return out;
  }
}
