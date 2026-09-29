/* Mi Bici 2026 — global.js (1/2: core API)
   window.MiBici: formatMoney, debounce, fetchJSON, parseHTML, announce, lock/unlockScroll,
   trapFocus/releaseFocus, priceHTML/updatePrice, cart API + cart events, delegated
   drawer/cart triggers. Custom elements live in global-ui.js (loaded right after).
   Docs: dev/FOUNDATION_NOTES.md. Vanilla ES2019+, no dependencies. */
(function () {
  'use strict';

  const M = (window.MiBici = window.MiBici || {});
  M.routes = M.routes || {};
  M.settings = M.settings || {};
  M.strings = M.strings || {};
  const doc = document;
  const root = doc.documentElement;

  const emit = (name, detail, target) =>
    (target || doc).dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail || {} }));
  const define = (name, ctor) => {
    if (window.customElements && !customElements.get(name)) customElements.define(name, ctor);
  };
  M.emit = emit;
  M.define = define;
  M.reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- Utilities ---------------------------------------------- */
  M.formatMoney = function (cents, format) {
    if (typeof cents === 'string') cents = cents.replace('.', '');
    const value = parseInt(cents, 10) || 0;
    const fmt = format || M.moneyFormat || 'S/ {{amount}}';
    const re = /\{\{\s*(\w+)\s*\}\}/;
    const match = fmt.match(re);
    const num = (n, precision, thousands, decimal) => {
      const fixed = (Math.abs(n) / 100).toFixed(precision).split('.');
      const int = fixed[0].replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1' + thousands);
      return (n < 0 ? '-' : '') + (fixed[1] ? int + decimal + fixed[1] : int);
    };
    let out;
    switch (match ? match[1] : 'amount') {
      case 'amount_no_decimals': out = num(value, 0, ',', '.'); break;
      case 'amount_with_comma_separator': out = num(value, 2, '.', ','); break;
      case 'amount_no_decimals_with_comma_separator': out = num(value, 0, '.', ','); break;
      case 'amount_with_apostrophe_separator': out = num(value, 2, "'", '.'); break;
      case 'amount_with_space_separator': out = num(value, 2, ' ', ','); break;
      default: out = num(value, 2, ',', '.');
    }
    return match ? fmt.replace(re, out) : out;
  };

  M.debounce = function (fn, ms) {
    let timer;
    return function () {
      const args = arguments;
      const ctx = this;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(ctx, args), ms == null ? 300 : ms);
    };
  };

  M.fetchJSON = async function (url, opts) {
    const o = Object.assign({ credentials: 'same-origin' }, opts || {});
    o.headers = Object.assign({ Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, o.headers || {});
    if (o.body && typeof o.body === 'object' && !(o.body instanceof FormData) && !(o.body instanceof URLSearchParams)) {
      o.body = JSON.stringify(o.body);
      o.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, o);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    const badStatus = data && typeof data === 'object' && Number(data.status) >= 400;
    if (!res.ok || badStatus) {
      let message = '';
      if (data && typeof data === 'object') {
        if (typeof data.description === 'string') message = data.description;
        else if (typeof data.errors === 'string') message = data.errors;
        else if (typeof data.message === 'string') message = data.message;
      }
      const err = new Error(message || M.strings.cartError || res.statusText || 'Error');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  };

  M.parseHTML = (html) => new DOMParser().parseFromString(html || '', 'text/html');

  M.announce = function (text) {
    const live = doc.getElementById('A11yLive');
    if (!live || !text) return;
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 60);
  };

  /* Scroll lock (ref-counted so nested overlays work) */
  let locks = 0;
  M.lockScroll = function () {
    if (locks++ > 0) return;
    const gap = window.innerWidth - root.clientWidth;
    if (gap > 0) root.style.setProperty('--scrollbar-width', gap + 'px');
    root.classList.add('scroll-locked');
  };
  M.unlockScroll = function () {
    if (locks === 0) return;
    if (--locks > 0) return;
    root.classList.remove('scroll-locked');
    root.style.removeProperty('--scrollbar-width');
  };

  /* Focus trap (stack: the most recent trap wins) */
  const FOCUSABLE = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  const traps = [];
  M.getFocusable = (container) =>
    Array.from(container.querySelectorAll(FOCUSABLE)).filter(
      (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]')
    );
  M.trapFocus = function (container, focusEl) {
    if (!container) return;
    M.releaseFocus(container);
    traps.push(container);
    if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
    // Retried for a few frames: a container that was visibility:hidden a moment ago (drawer
    // opening, esp. under reduced motion) can't take focus until its styles settle.
    let tries = 0;
    const attempt = () => {
      if (traps[traps.length - 1] !== container) return;
      const target = focusEl || M.getFocusable(container)[0] || container;
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
      if (!container.contains(doc.activeElement) && ++tries < 20) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  };
  M.releaseFocus = function (container) {
    if (!traps.length) return;
    if (!container) { traps.pop(); return; }
    const i = traps.indexOf(container);
    if (i > -1) traps.splice(i, 1);
  };
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !traps.length) return;
    const trap = traps[traps.length - 1];
    const items = M.getFocusable(trap);
    if (!items.length) { e.preventDefault(); trap.focus(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = doc.activeElement;
    if (e.shiftKey && (active === first || !trap.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !trap.contains(active))) { e.preventDefault(); first.focus(); }
  });
  doc.addEventListener('focusin', (e) => {
    if (!traps.length || !(e.target instanceof Element)) return;
    const trap = traps[traps.length - 1];
    if (trap.contains(e.target) || e.target.closest('dialog[open]')) return;
    (M.getFocusable(trap)[0] || trap).focus();
  });

  /* ---------- Price helpers (mirror snippets/price.liquid) ------------- */
  M.priceHTML = function (price, compare, opts) {
    const s = M.strings;
    const onSale = compare > price;
    let html = onSale ? '<span class="visually-hidden">' + (s.priceSale || '') + '</span>' : '';
    html += '<span class="price__current">' + M.formatMoney(price) + '</span>';
    if (onSale) {
      html += '<span class="visually-hidden">' + (s.priceRegular || '') + '</span><s class="price__compare">' + M.formatMoney(compare) + '</s>';
      if (!opts || opts.showSave !== false) html += '<span class="price__save">-' + Math.round(((compare - price) * 100) / compare) + '%</span>';
    }
    return html;
  };
  M.updatePrice = function (el, variant) {
    if (!el || !variant) return;
    const compare = variant.compare_at_price || 0;
    el.classList.toggle('price--sale', compare > variant.price);
    el.classList.toggle('price--soldout', variant.available === false);
    el.innerHTML = M.priceHTML(variant.price, compare, { showSave: el.dataset.showSave !== 'false' });
  };

  /* ---------- Cart API ------------------------------------------------- */
  const sectionIds = new Set();
  let queue = Promise.resolve();
  const enqueue = (task) => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };
  const jsUrl = (key, fallback) => (M.routes[key] || fallback).replace(/\/$/, '') + '.js';
  const sectionsPayload = () => {
    const ids = Array.from(sectionIds);
    return ids.length ? { sections: ids.join(','), sections_url: location.pathname } : {};
  };
  const fail = (err, source) => {
    const message = (err && err.message) || M.strings.cartError || 'Error';
    emit('cart:error', { message, source, status: err && err.status });
    throw err instanceof Error ? err : new Error(message);
  };

  M.cart = {
    registerSection(id) { if (id) sectionIds.add(String(id)); },
    unregisterSection(id) { sectionIds.delete(String(id)); },
    sectionIds() { return Array.from(sectionIds); },

    get() { return M.fetchJSON(jsUrl('cart', '/cart'), { cache: 'no-store' }); },

    add(input) {
      return enqueue(async () => {
        const extra = sectionsPayload();
        let body;
        if (input instanceof FormData) {
          body = input;
          Object.keys(extra).forEach((k) => body.set(k, extra[k]));
        } else {
          const items = Array.isArray(input) ? input : input && input.items ? input.items : [input];
          body = Object.assign({ items }, extra);
        }
        try {
          const data = await M.fetchJSON(jsUrl('cart_add', '/cart/add'), { method: 'POST', body });
          const cart = await M.cart.get();
          const result = { cart, sections: (data && data.sections) || {}, source: 'add' };
          if (data && Array.isArray(data.items)) result.items = data.items;
          else result.item = data;
          emit('cart:updated', result);
          return result;
        } catch (err) {
          return fail(err, 'add');
        }
      });
    },

    change(lineKey, quantity) {
      return enqueue(async () => {
        const body = Object.assign({ quantity: Math.max(0, parseInt(quantity, 10) || 0) }, sectionsPayload());
        // Small integers are 1-based line indexes; anything else is a line key (or variant id).
        if (/^\d{1,4}$/.test(String(lineKey))) body.line = parseInt(lineKey, 10);
        else body.id = String(lineKey);
        try {
          const cart = await M.fetchJSON(jsUrl('cart_change', '/cart/change'), { method: 'POST', body });
          emit('cart:updated', { cart, sections: cart.sections || {}, source: 'change', lineKey });
          return cart;
        } catch (err) {
          return fail(err, 'change');
        }
      });
    },

    update(updates, note) {
      return enqueue(async () => {
        const body = Object.assign({ updates: updates || {} }, sectionsPayload());
        if (typeof note === 'string') body.note = note;
        try {
          const cart = await M.fetchJSON(jsUrl('cart_update', '/cart/update'), { method: 'POST', body });
          emit('cart:updated', { cart, sections: cart.sections || {}, source: 'update' });
          return cart;
        } catch (err) {
          return fail(err, 'update');
        }
      });
    },
  };

  /* Count badges + free-shipping bars follow every cart change. */
  M.updateCartCount = function (count) {
    const n = parseInt(count, 10) || 0;
    doc.querySelectorAll('[data-cart-count]').forEach((el) => {
      el.textContent = n > 99 ? '99+' : String(n);
      el.hidden = n === 0;
    });
  };

  M.updateFreeShipping = function (total, scope) {
    const s = M.strings;
    (scope || doc).querySelectorAll('[data-free-shipping]').forEach((el) => {
      const threshold = parseInt(el.getAttribute('data-threshold'), 10) || M.settings.freeShippingThreshold || 0;
      if (!threshold) return;
      const sum = parseInt(total, 10) || 0;
      const remaining = Math.max(threshold - sum, 0);
      const pct = Math.min(100, Math.round((sum / threshold) * 100));
      el.classList.toggle('is-complete', remaining === 0);
      const track = el.querySelector('.free-ship__track');
      if (track) {
        track.style.setProperty('--progress', pct + '%');
        track.setAttribute('aria-valuenow', String(pct));
      }
      const text = el.querySelector('[data-free-shipping-text]');
      if (!text) return;
      let html = remaining > 0
        ? (s.freeShippingRemaining || '').replace('[amount]', M.formatMoney(remaining))
        : s.freeShippingReached || '';
      if (M.settings.freeShippingZone && s.freeShippingZone) html += ' <span class="free-ship__zone">' + s.freeShippingZone + '</span>';
      text.innerHTML = html;
    });
  };

  doc.addEventListener('cart:updated', (e) => {
    const d = e.detail || {};
    if (!d.cart) return;
    M.updateCartCount(d.cart.item_count);
    M.updateFreeShipping(d.cart.total_price);
    if (d.source === 'add') return; // product-form announces "added"
    const n = d.cart.item_count || 0;
    const count = (n === 1 ? M.strings.itemsOne : M.strings.itemsOther) || '';
    M.announce([M.strings.cartUpdated, count.replace('[count]', n)].filter(Boolean).join('. '));
  });

  /* cart:open → open the drawer, or go to the cart page. */
  doc.addEventListener('cart:open', (e) => {
    const drawer = doc.getElementById('CartDrawer');
    if (M.settings.cartType === 'drawer' && drawer) {
      if (typeof drawer.open === 'function') drawer.open((e.detail && e.detail.opener) || null);
      return;
    }
    if (M.routes.cart) window.location.href = M.routes.cart;
  });

  /* Delegated triggers */
  doc.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;

    const opener = t.closest('[data-drawer-open]');
    if (opener) {
      const drawer = doc.getElementById(opener.getAttribute('data-drawer-open'));
      if (drawer && typeof drawer.open === 'function') {
        e.preventDefault();
        drawer.open(opener);
      }
      return;
    }

    const closer = t.closest('[data-drawer-close]');
    if (closer) {
      const id = closer.getAttribute('data-drawer-close');
      const drawer = id ? doc.getElementById(id) : closer.closest('side-drawer, .drawer');
      if (drawer && typeof drawer.close === 'function') {
        e.preventDefault();
        drawer.close();
      }
      return;
    }

    const cartOpener = t.closest('[data-cart-open]');
    if (cartOpener && M.settings.cartType === 'drawer' && doc.getElementById('CartDrawer')) {
      e.preventDefault();
      emit('cart:open', { opener: cartOpener });
    }
  });
})();
