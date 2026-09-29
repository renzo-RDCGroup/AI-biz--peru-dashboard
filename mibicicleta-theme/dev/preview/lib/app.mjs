// App = theme + mock store + cart + engine + renderer, plus storefront route resolution.
import path from 'node:path';
import { Cart } from './cart.mjs';
import { Engine } from './engine.mjs';
import { ErrorLog } from './errors.mjs';
import { FIXTURES_DIR } from './paths.mjs';
import { Renderer, fixtureExists } from './render.mjs';
import { Store } from './store.mjs';
import { Theme } from './theme.mjs';
import { World } from './world.mjs';

export class App {
  constructor({ themeDir, mockPath, fixturesDir = FIXTURES_DIR }) {
    this.theme = new Theme(themeDir);
    this.store = new Store(mockPath);
    this.cart = new Cart(this.store);
    this.errorLog = new ErrorLog();
    this.fixturesDir = fixturesDir;
    this.engine = new Engine(this);
    this.renderer = new Renderer(this);
  }

  pageSuffix(page) {
    if (page.template_suffix) return page.template_suffix;
    const h = page.handle;
    return this.theme.exists(`templates/page.${h}.json`) || this.theme.exists(`templates/page.${h}.liquid`) ? h : null;
  }

  /** URL → route { pageType, template, suffix, objects, handle, status, fixture? } */
  resolveRoute(url) {
    const p = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
    const view = url.searchParams.get('view') || null;
    const route = (pageType, template, extra = {}) => ({
      pageType, template, suffix: view || extra.suffix || null, objects: {}, handle: '', status: 200, ...extra, ...(view ? { suffix: view } : {}),
    });
    const notFound = () => route('404', '404', { status: 404 });
    const store = this.store;
    let m;

    if (p === '/') return route('index', 'index');
    if (p === '/collections') return route('list-collections', 'list-collections');
    if ((m = p.match(/^\/collections\/(vendors|types)$/))) {
      const q = url.searchParams.get('q') || '';
      const key = m[1] === 'vendors' ? 'vendor' : 'product_type';
      const rec = {
        id: 449999999000,
        handle: m[1],
        title: q,
        description: '',
        image: null,
        productHandles: store.products.filter((x) => x[key].toLowerCase() === q.toLowerCase()).map((x) => x.handle),
        sort_order: 'manual',
        published_at: '2026-01-01T00:00:00Z',
        template_suffix: null,
        currentVendor: key === 'vendor' ? q : null,
        currentType: key === 'product_type' ? q : null,
      };
      return route('collection', 'collection', { objects: { collection: rec }, handle: m[1] });
    }
    if ((m = p.match(/^\/collections\/([^/]+)\/products\/([^/]+)$/))) {
      const product = store.product(m[2]);
      if (!product) return notFound();
      return route('product', 'product', { objects: { product, withinCollection: store.collection(m[1]) }, handle: product.handle, suffix: product.template_suffix });
    }
    if ((m = p.match(/^\/collections\/([^/]+)(?:\/([^/]+))?$/))) {
      const col = store.collection(m[1]);
      if (!col) return notFound();
      const tags = m[2] ? m[2].split('+').filter(Boolean) : [];
      return route('collection', 'collection', { objects: { collection: col, tags }, handle: col.handle, suffix: col.template_suffix });
    }
    if ((m = p.match(/^\/products\/([^/]+)$/))) {
      const product = store.product(m[1]);
      if (!product) return notFound();
      return route('product', 'product', { objects: { product }, handle: product.handle, suffix: product.template_suffix });
    }
    if (p === '/search') return route('search', 'search');
    if (p === '/cart') return route('cart', 'cart');
    if ((m = p.match(/^\/pages\/([^/]+)$/))) {
      const page = store.page(m[1]);
      if (!page) return notFound();
      return route('page', 'page', { objects: { page }, handle: page.handle, suffix: this.pageSuffix(page) });
    }
    if ((m = p.match(/^\/blogs\/([^/]+)(?:\/tagged\/([^/]+))?$/))) {
      const blog = store.blog(m[1]);
      if (!blog) return notFound();
      return route('blog', 'blog', { objects: { blog, tags: m[2] ? [m[2]] : [] }, handle: blog.handle });
    }
    if ((m = p.match(/^\/blogs\/([^/]+)\/([^/]+)$/))) {
      const blog = store.blog(m[1]);
      const article = blog?.articles.find((a) => a.handle === m[2]);
      if (!article) return notFound();
      return route('article', 'article', { objects: { blog, article }, handle: article.handle });
    }
    if ((m = p.match(/^\/policies\/([^/]+)$/))) {
      const policy = store.policy(m[1]);
      if (!policy) return notFound();
      return route('policy', 'policy', { objects: { policy }, handle: policy.handle, rawContent: `<div class="shopify-policy__container"><div class="shopify-policy__title"><h1>${policy.title}</h1></div><div class="shopify-policy__body"><div class="rte">${policy.body}</div></div></div>` });
    }
    if (p === '/password') return route('password', 'password');
    if (p === '/404') return notFound();
    if (p === '/_styleguide') {
      const fixture = path.join(this.fixturesDir, 'styleguide.liquid');
      if (!fixtureExists(fixture)) return notFound();
      return route('page', 'page', { suffix: 'styleguide', fixture });
    }
    return notFound();
  }

  world(url, route = this.resolveRoute(url)) {
    return new World(this, { url, route });
  }
}
