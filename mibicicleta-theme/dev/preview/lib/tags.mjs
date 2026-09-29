// Shopify-specific Liquid tags on top of liquidjs:
// schema / javascript / stylesheet / doc (raw, no output), style, section, sections, layout,
// form, paginate, content_for. render / include / liquid / comment / raw come from liquidjs
// (render resolves snippets through Engine#_parsePartialFile).
import { Drop, Hash, Tag, TypeGuards, evalToken, toValue } from 'liquidjs';
import { buildUrl, cleanQuery } from './facets.mjs';
import { escapeAttr, toInt } from './util.mjs';
import { worldOf } from './world.mjs';

// ---------------------------------------------------------------------------
// helpers

function parseBody(tag, remainTokens, parser, endName) {
  const templates = [];
  while (remainTokens.length) {
    const token = remainTokens.shift();
    if (TypeGuards.isTagToken(token) && token.name === endName) return templates;
    templates.push(parser.parseToken(token, remainTokens));
  }
  throw new Error(`tag ${tag.token.getText()} not closed`);
}

function skipBody(tag, remainTokens, endName) {
  while (remainTokens.length) {
    const token = remainTokens.shift();
    if (TypeGuards.isTagToken(token) && token.name === endName) return;
  }
  throw new Error(`tag ${tag.token.getText()} not closed`);
}

/** Read "a, b, key: value, key2: value2" → { positional: [ValueToken], hash: Hash } */
function readArgs(tokenizer, liquid) {
  const positional = [];
  for (;;) {
    tokenizer.skipBlank();
    if (tokenizer.peek() === ',') { tokenizer.advance(); tokenizer.skipBlank(); }
    if (tokenizer.end()) break;
    const begin = tokenizer.p;
    const ident = tokenizer.readIdentifier();
    tokenizer.skipBlank();
    const isHash = ident.content && tokenizer.peek() === ':';
    tokenizer.p = begin;
    if (isHash) break;
    const v = tokenizer.readValue();
    if (!v) break;
    positional.push(v);
  }
  return { positional, hash: new Hash(tokenizer, liquid.options.keyValueSeparator) };
}

// ---------------------------------------------------------------------------
// raw-ish blocks

class RawNoOutputTag extends Tag {
  constructor(token, remainTokens, liquid) {
    super(token, remainTokens, liquid);
    skipBody(this, remainTokens, `end${token.name}`);
  }
  * render() { return ''; }
}

class StyleTag extends Tag {
  constructor(token, remainTokens, liquid, parser) {
    super(token, remainTokens, liquid);
    this.templates = parseBody(this, remainTokens, parser, 'endstyle');
  }
  * render(ctx, emitter) {
    const html = yield this.liquid.renderer.renderTemplates(this.templates, ctx);
    emitter.write(`<style data-shopify>${html}</style>`);
  }
}

// ---------------------------------------------------------------------------
// sections

class SectionTag extends Tag {
  constructor(token, remainTokens, liquid) {
    super(token, remainTokens, liquid);
    this.value = this.tokenizer.readValue();
    if (!this.value) throw new Error('section tag expects a section name');
  }
  * render(ctx, emitter) {
    const w = worldOf(ctx);
    const name = String(toValue(yield evalToken(this.value, ctx)));
    emitter.write(yield w.app.renderer.renderStatic(w, name));
  }
}

class SectionsTag extends Tag {
  constructor(token, remainTokens, liquid) {
    super(token, remainTokens, liquid);
    this.value = this.tokenizer.readValue();
    if (!this.value) throw new Error('sections tag expects a section group name');
  }
  * render(ctx, emitter) {
    const w = worldOf(ctx);
    const name = String(toValue(yield evalToken(this.value, ctx)));
    emitter.write(yield w.app.renderer.renderGroup(w, name));
  }
}

class ContentForTag extends Tag {
  constructor(token, remainTokens, liquid) {
    super(token, remainTokens, liquid);
    const { positional, hash } = readArgs(this.tokenizer, liquid);
    this.kind = positional[0];
    this.hash = hash;
  }
  * render(ctx, emitter) {
    const w = worldOf(ctx);
    const kind = String(toValue(yield evalToken(this.kind, ctx)));
    const args = yield this.hash.render(ctx);
    const section = ctx.getSync(['section']);
    emitter.write(yield w.app.renderer.renderContentFor(w, kind, args, section));
  }
}

class LayoutTag extends Tag {
  constructor(token, remainTokens, liquid) {
    super(token, remainTokens, liquid);
    this.none = token.args.trim() === 'none';
    if (!this.none) this.value = this.tokenizer.readValue();
  }
  * render(ctx) {
    const w = worldOf(ctx);
    if (!w) return;
    w.layoutOverride = this.none ? null : String(toValue(yield evalToken(this.value, ctx)));
  }
}

// ---------------------------------------------------------------------------
// form

const FORMS = {
  product: { action: () => '/cart/add', id: (o) => `product_form_${o?.id ?? ''}`, cls: 'shopify-product-form', enctype: true },
  cart: { action: () => '/cart', id: () => 'cart_form', cls: 'shopify-cart-form', enctype: true },
  contact: { action: (o, id) => `/contact#${id}`, id: () => 'contact_form', cls: 'contact-form' },
  customer: { action: (o, id) => `/contact#${id}`, id: () => 'contact_form', cls: 'contact-form' },
  create_customer: { action: () => '/account', id: () => 'create_customer' },
  customer_login: { action: () => '/account/login', id: () => 'customer_login' },
  guest_login: { action: () => '/account/login', id: () => 'customer_login_guest' },
  recover_customer_password: { action: () => '/account/recover', id: () => 'recover_customer_password' },
  reset_customer_password: { action: () => '/account/reset', id: () => 'reset_customer_password' },
  activate_customer_password: { action: () => '/account/activate', id: () => 'activate_customer_password' },
  customer_address: { action: () => '/account/addresses', id: () => 'address_form_new' },
  localization: { action: () => '/localization', id: () => 'localization_form', enctype: true },
  new_comment: { action: (o) => `${o?.url || ''}/comments`, id: () => 'comment_form', cls: 'comment-form' },
  storefront_password: { action: () => '/password', id: () => 'login_form', cls: 'storefront-password-form' },
  currency: { action: () => '/cart/update', id: () => 'currency_form', cls: 'shopify-currency-form', enctype: true },
};

class FormErrorsDrop extends Drop {
  constructor(fields) {
    super();
    this.messages = Object.fromEntries(fields.map((f) => [f, f === 'email' ? 'no es válido.' : 'no puede estar en blanco.']));
    this.translated_fields = Object.fromEntries(fields.map((f) => [f, { email: 'Correo electrónico', password: 'Contraseña', body: 'Mensaje', name: 'Nombre', form: 'Formulario' }[f] || f]));
    this.size = fields.length;
    Object.defineProperty(this, '_fields', { value: fields, enumerable: false });
  }
  [Symbol.iterator]() { return this._fields[Symbol.iterator](); }
  get first() { return this._fields[0]; }
}

class FormDrop extends Drop {
  constructor(data) { super(); Object.assign(this, data); }
}

function formState(w, type, formId) {
  const q = w.query;
  const sim = q.get('__form');
  const simType = q.get('__form_type');
  const matches = !simType || simType === type;
  const postedParam = type === 'customer' ? 'customer_posted' : type === 'contact' ? 'contact_posted' : null;
  const posted = (postedParam && q.get(postedParam) === 'true') || (sim === 'posted' && matches);
  let errors = null;
  if (sim === 'errors' && matches) errors = new FormErrorsDrop(type === 'storefront_password' ? ['password'] : ['email']);
  const fieldErr = q.get('__form_errors');
  if (fieldErr && matches) errors = new FormErrorsDrop(fieldErr.split(','));
  return {
    id: formId,
    'posted_successfully?': !!posted,
    errors,
    email: null,
    body: null,
    name: null,
    phone: null,
    author: null,
    first_name: null,
    last_name: null,
    password_needed: type === 'storefront_password' || type === 'customer_login',
    set_as_default_checkbox: '<input type="checkbox" id="address_default_address_new" name="address[default]" value="1">',
  };
}

class FormTag extends Tag {
  constructor(token, remainTokens, liquid, parser) {
    super(token, remainTokens, liquid);
    const { positional, hash } = readArgs(this.tokenizer, liquid);
    this.typeToken = positional[0];
    this.objectToken = positional[1] || null;
    this.hash = hash;
    this.templates = parseBody(this, remainTokens, parser, 'endform');
  }

  * render(ctx, emitter) {
    const w = worldOf(ctx);
    const type = String(toValue(yield evalToken(this.typeToken, ctx)));
    const object = this.objectToken ? yield evalToken(this.objectToken, ctx) : null;
    const attrs = yield this.hash.render(ctx);
    const def = FORMS[type];
    if (!def) w?.errors.warn(`Unknown form type "${type}"`, { file: this.token.file });
    const d = def || { action: () => '#', id: () => `${type}_form` };
    const id = attrs.id ?? d.id(object);
    const out = [['method', 'post'], ['action', attrs.action ?? d.action(object, id)], ['id', id], ['accept-charset', 'UTF-8']];
    const cls = attrs.class ?? d.cls;
    if (cls) out.push(['class', cls]);
    if (d.enctype) out.push(['enctype', 'multipart/form-data']);
    const hidden = [['form_type', type], ['utf8', '✓']];
    for (const [k, v] of Object.entries(attrs)) {
      if (['id', 'class', 'action'].includes(k)) continue;
      if (k === 'return_to') { hidden.push(['return_to', v]); continue; }
      if (v === undefined || v === null || v === false) continue;
      out.push([k, v === true ? k : v]);
    }
    if (type === 'localization') {
      hidden.push(['_method', 'put']);
      if (!attrs.return_to) hidden.push(['return_to', w ? w.path : '/']);
    }
    const attrHtml = out.map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ');
    const hiddenHtml = hidden.map(([k, v]) => `<input type="hidden" name="${escapeAttr(k)}" value="${escapeAttr(v)}" />`).join('');
    const form = new FormDrop(w ? formState(w, type, id) : {});
    ctx.push({ form });
    let body;
    try {
      body = yield this.liquid.renderer.renderTemplates(this.templates, ctx);
    } finally {
      ctx.pop();
    }
    let tail = '';
    if (type === 'product' && object && w) {
      tail = `<input type="hidden" name="product-id" value="${escapeAttr(object.id)}" />`;
      const sec = w.currentSection;
      if (sec) tail += `<input type="hidden" name="section-id" value="${escapeAttr(sec.id)}" />`;
    }
    emitter.write(`<form ${attrHtml}>${hiddenHtml}${body}${tail}</form>`);
  }
}

// ---------------------------------------------------------------------------
// paginate

function splitPath(text) {
  // "collection.products" / "section.settings.collection.products" / "collections"
  const segs = [];
  const re = /([A-Za-z_][\w-]*\??)|\[\s*(['"])(.*?)\2\s*\]/g;
  let m;
  while ((m = re.exec(text))) segs.push(m[1] ?? m[3]);
  return segs;
}

function overridePath(obj, segs, value) {
  if (!segs.length) return value;
  const [head, ...rest] = segs;
  return new Proxy(obj, {
    get(t, p) {
      if (p === head) return overridePath(Reflect.get(t, p, t), rest, value);
      return Reflect.get(t, p, t);
    },
    has(t, p) { return p === head || Reflect.has(t, p); },
  });
}

function paginationParts(current, pages, windowSize, urlFor) {
  const parts = [];
  if (pages <= 1) return parts;
  let hellip = false;
  for (let page = 1; page <= pages; page++) {
    if (page === current) {
      parts.push({ title: page, url: null, is_link: false });
      hellip = false;
    } else if (page === 1 || page === pages || (page > current - windowSize && page < current + windowSize)) {
      parts.push({ title: page, url: urlFor(page), is_link: true });
      hellip = false;
    } else if (!hellip) {
      parts.push({ title: '&hellip;', url: null, is_link: false });
      hellip = true;
    }
  }
  return parts;
}

class PaginateTag extends Tag {
  constructor(token, remainTokens, liquid, parser) {
    super(token, remainTokens, liquid);
    const tk = this.tokenizer;
    this.collection = tk.readValue();
    if (!this.collection) throw new Error('paginate: expected a collection');
    this.collectionText = this.collection.getText();
    tk.skipBlank();
    const by = tk.readIdentifier();
    if (by.content !== 'by') throw new Error('paginate: expected "by"');
    tk.skipBlank();
    this.size = tk.readValue();
    this.hash = new Hash(tk, liquid.options.keyValueSeparator);
    this.templates = parseBody(this, remainTokens, parser, 'endpaginate');
  }

  * render(ctx, emitter) {
    const w = worldOf(ctx);
    const pageSize = Math.max(1, toInt(toValue(yield evalToken(this.size, ctx)), 1));
    const opts = yield this.hash.render(ctx);
    const windowSize = toInt(opts.window_size, 3) || 3;
    const segs = splitPath(this.collectionText);
    const last = segs[segs.length - 1];

    // Drops that paginate themselves (collection.products, search.results, blog.articles, collections)
    // keep the state on the instance, so snippets reading the global object see the current page too.
    const paginable = (x) => x && typeof x.__paginate === 'function';
    let owner = null;
    const full = yield evalToken(this.collection, ctx);
    if (segs.length === 1 && paginable(full) && full.__paginateProp === null) owner = full;
    else if (segs.length > 1) {
      let parent = ctx.getSync([segs[0]]);
      for (const s of segs.slice(1, -1)) parent = parent == null ? parent : ctx.readProperty(parent, s);
      if (paginable(parent) && parent.__paginateProp === last) owner = parent;
    }

    let total;
    let shadow = null;
    const page = Math.max(1, toInt(w?.query.get('page'), 1));
    const offset = (page - 1) * pageSize;
    if (owner) {
      owner.__unpaginate();
      total = owner.__paginateTotal();
      owner.__paginate(offset, pageSize);
    } else {
      let arr = toValue(full);
      if (arr && !Array.isArray(arr) && typeof arr[Symbol.iterator] === 'function') arr = [...arr];
      arr = Array.isArray(arr) ? arr : [];
      total = arr.length;
      const slice = arr.slice(offset, offset + pageSize);
      const root = ctx.getSync([segs[0]]);
      shadow = { [segs[0]]: segs.length === 1 ? slice : overridePath(root, segs.slice(1), slice) };
    }

    const pages = Math.ceil(total / pageSize);
    const base = w ? cleanQuery(w.query) : new URLSearchParams();
    const urlFor = (n) => {
      const q = new URLSearchParams(base);
      q.set('page', String(n));
      return buildUrl(w ? w.path : '', q);
    };
    const paginate = {
      current_page: page,
      current_offset: offset,
      items: total,
      page_size: pageSize,
      pages,
      page_param: 'page',
      previous: page > 1 ? { title: '&laquo; Anterior', url: urlFor(page - 1), is_link: true } : null,
      next: page < pages ? { title: 'Siguiente &raquo;', url: urlFor(page + 1), is_link: true } : null,
      parts: paginationParts(page, pages, windowSize, urlFor),
    };
    const prevPage = w?.currentPage;
    if (w) w.currentPage = page;
    ctx.push({ paginate, ...(shadow || {}) });
    try {
      const html = yield this.liquid.renderer.renderTemplates(this.templates, ctx);
      emitter.write(html);
    } finally {
      ctx.pop();
      if (owner) owner.__unpaginate();
      if (w) w.currentPage = prevPage;
    }
  }
}

export function registerTags(engine) {
  const { liquid } = engine;
  for (const name of ['schema', 'javascript', 'stylesheet', 'doc']) liquid.registerTag(name, RawNoOutputTag);
  liquid.registerTag('style', StyleTag);
  liquid.registerTag('section', SectionTag);
  liquid.registerTag('sections', SectionsTag);
  liquid.registerTag('content_for', ContentForTag);
  liquid.registerTag('layout', LayoutTag);
  liquid.registerTag('form', FormTag);
  liquid.registerTag('paginate', PaginateTag);
}

