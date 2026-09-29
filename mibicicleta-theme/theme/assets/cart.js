/* Mi Bici 2026 — cart.js · <cart-drawer> (extends MiBici.SideDrawer) + <cart-page>.
   Shared: section re-render on `cart:updated` (keeps scroll, focus, pending qty, errors),
   debounced qty change / remove via MiBici.cart.change with inline errors, free-shipping bike
   glide + celebration, highlight of just-added lines. global.js already announces updates. */
(function () {
  'use strict';

  const M = window.MiBici;
  if (!M || !M.cart || !M.SideDrawer || M.CartDrawer) return;
  const doc = document;
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
  const FOCUS_ROLES = {
    remove: '[data-cart-remove]',
    minus: '[data-qty="minus"]',
    plus: '[data-qty="plus"]',
    input: '.qty__input',
    title: '[data-line-focus]',
  };

  const CartMixin = (Base) => class extends Base {
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      if (this._cartReady) return;
      this._cartReady = true;
      this.sectionId = this.getAttribute('data-section');
      if (this.sectionId) M.cart.registerSection(this.sectionId);
      this._onUpdated = (e) => this.onCartUpdated(e);
      doc.addEventListener('cart:updated', this._onUpdated);
      if (!this._bound) {
        this._bound = true;
        this._timers = {};
        this._pending = {};
        this._busy = new Set();
        this._errors = {};
        this.addEventListener('change', (e) => this.onChange(e));
        this.addEventListener('input', (e) => {
          if (e.target.matches && e.target.matches('[data-cart-note]')) this._noteDraft = e.target.value;
        });
        this.addEventListener('click', (e) => this.onClick(e));
        // Enter in a quantity field must not submit the cart form (its default button is checkout).
        this.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || !(e.target instanceof Element) || !e.target.matches('.qty__input[data-key]')) return;
          e.preventDefault();
          e.target.dispatchEvent(new Event('change', { bubbles: true }));
        });
        // Back/forward cache (e.g. back from checkout): the cart may have changed meanwhile.
        window.addEventListener('pageshow', (e) => { if (e.persisted && this.isConnected) this.refresh({}); });
      }
      if (this.onReady) this.onReady();
    }

    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      doc.removeEventListener('cart:updated', this._onUpdated);
      if (this.sectionId) M.cart.unregisterSection(this.sectionId);
      this._cartReady = false;
    }

    lineFor(key) {
      return key ? this.querySelector('[data-line-key="' + esc(key) + '"]') : null;
    }

    /* ---------- Line interactions ---------------------------------------- */
    onChange(e) {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.matches('[data-cart-note]')) { this.saveNote(t.value); return; }
      if (!t.matches('.qty__input[data-key]')) return;
      const key = t.getAttribute('data-key');
      this.clearError(key);
      clearTimeout(this._timers[key]);
      this._pending[key] = t.value;
      this._timers[key] = setTimeout(() => {
        delete this._timers[key];
        const qty = this._pending[key];
        delete this._pending[key];
        this.changeLine(key, qty);
      }, 300);
    }

    onClick(e) {
      const remove = e.target instanceof Element ? e.target.closest('[data-cart-remove]') : null;
      if (!remove || !this.contains(remove)) return;
      e.preventDefault();
      const key = remove.getAttribute('data-key');
      const line = remove.closest('[data-line-key]');
      if (line) line.classList.add('is-removing');
      clearTimeout(this._timers[key]);
      delete this._timers[key];
      delete this._pending[key];
      this.changeLine(key, 0);
    }

    setBusy(key, on) {
      if (on) this._busy.add(key);
      else this._busy.delete(key);
      const line = this.lineFor(key);
      if (!line) return;
      line.classList.toggle('is-loading', on);
      if (on) line.setAttribute('aria-busy', 'true');
      else {
        line.removeAttribute('aria-busy');
        line.classList.remove('is-removing');
      }
    }

    changeLine(key, qty) {
      const requested = Math.max(0, parseInt(qty, 10) || 0);
      this.setBusy(key, true);
      return M.cart.change(key, requested)
        .then((cart) => {
          this.setBusy(key, false);
          // Shopify may cap the quantity at the available stock instead of failing.
          const item = ((cart && cart.items) || []).find((i) => i.key === key);
          if (requested > 0 && item && item.quantity < requested) this.setError(key, this.stockMessage(item.quantity));
        })
        .catch((err) => {
          this.setBusy(key, false);
          // Nothing changed on the server: put the last saved quantity back.
          const line = this.lineFor(key);
          const input = line && line.querySelector('.qty__input');
          if (input) {
            input.value = input.defaultValue;
            const stepper = input.closest('quantity-input');
            if (stepper && typeof stepper.sync === 'function') stepper.sync();
          }
          this.setError(key, (err && err.message) || M.strings.cartError);
        });
    }

    stockMessage(n) {
      const tpl = this.getAttribute('data-stock-msg') || '';
      return tpl ? tpl.replace('[quantity]', n) : M.strings.cartError;
    }

    setError(key, message) {
      if (!key) return;
      if (message) this._errors[key] = message;
      else delete this._errors[key];
      const line = this.lineFor(key);
      const el = line && line.querySelector('[data-line-error]');
      if (!el) return;
      el.textContent = message || '';
      el.hidden = !message;
    }

    clearError(key) { this.setError(key, ''); }

    saveNote(note) {
      this._noteDraft = note;
      const url = (M.routes.cart_update || '/cart/update').replace(/\/$/, '') + '.js';
      M.fetchJSON(url, { method: 'POST', body: { note } })
        .then(() => { if (this._noteDraft === note) this._noteDraft = null; })
        .catch(() => {});
    }

    /* ---------- Re-render -------------------------------------------------- */
    onCartUpdated(e) {
      const d = (e && e.detail) || {};
      const html = this.sectionId && d.sections ? d.sections[this.sectionId] : null;
      if (html) this.renderHTML(html, d);
      else this.refresh(d);
    }

    /* Fallback when the section wasn't part of the cart response (e.g. 5-section limit). */
    refresh(d) {
      if (!this.sectionId) return Promise.resolve();
      const url = window.location.pathname + '?section_id=' + encodeURIComponent(this.sectionId);
      return fetch(url, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.statusText))))
        .then((html) => this.renderHTML(html, d || {}))
        .catch(() => {});
    }

    renderHTML(html, d) {
      const sel = this.innerSelector;
      const fresh = M.parseHTML(html).querySelector(sel);
      const current = this.querySelector(sel);
      if (!fresh || !current) return;
      const focus = this.focusToken();
      const scroller = current.querySelector('[data-cart-scroll]');
      const top = scroller ? scroller.scrollTop : 0;

      current.replaceWith(fresh);

      const newScroller = fresh.querySelector('[data-cart-scroll]');
      if (newScroller && top) newScroller.scrollTop = top;
      // Re-apply client-side state the server doesn't know about yet.
      Object.keys(this._pending).forEach((key) => {
        const input = this.lineFor(key) && this.lineFor(key).querySelector('.qty__input');
        if (!input) return;
        input.value = this._pending[key];
        const stepper = input.closest('quantity-input');
        if (stepper && typeof stepper.sync === 'function') stepper.sync();
      });
      this._busy.forEach((key) => this.setBusy(key, true));
      Object.keys(this._errors).forEach((key) => {
        if (this.lineFor(key)) this.setError(key, this._errors[key]);
        else delete this._errors[key];
      });
      const note = fresh.querySelector('[data-cart-note]');
      if (note && this._noteDraft != null) note.value = this._noteDraft;

      this.restoreFocus(focus, d);
      if (d.source === 'add') this.flashAdded(d);
      if (this.afterRender) this.afterRender(d);
    }

    /* Briefly highlight the line(s) just added and bring them into view. */
    flashAdded(d) {
      const items = d.items || (d.item ? [d.item] : []);
      items.forEach((item, i) => {
        const line = item && this.lineFor(item.key);
        if (!line) return;
        line.classList.add('is-added');
        setTimeout(() => line.classList.remove('is-added'), 2000);
        if (i === 0 && line.closest('[data-cart-scroll]')) line.scrollIntoView({ block: 'nearest' });
      });
    }

    focusToken() {
      const a = doc.activeElement;
      if (!a || a === doc.body || !this.contains(a)) return null;
      const line = a.closest('[data-line-key]');
      if (!line) return { id: a.id || null };
      let role = 'title';
      if (a.matches('[data-cart-remove]')) role = 'remove';
      else if (a.hasAttribute('data-qty')) role = a.getAttribute('data-qty');
      else if (a.matches('.qty__input')) role = 'input';
      const lines = Array.from(this.querySelectorAll('[data-line-key]'));
      return { key: line.getAttribute('data-line-key'), role, index: lines.indexOf(line) };
    }

    restoreFocus(token, d) {
      if (!token) return;
      let el = null;
      if (token.key) {
        const line = this.lineFor(token.key);
        if (line) el = line.querySelector(FOCUS_ROLES[token.role] || FOCUS_ROLES.title);
        else {
          // The line was removed: move to the line that took its place (or the new last one).
          const lines = this.querySelectorAll('[data-line-key]');
          const next = lines[Math.min(token.index, lines.length - 1)];
          if (next) el = next.querySelector(FOCUS_ROLES.title);
        }
      } else if (token.id) {
        const byId = doc.getElementById(token.id);
        if (byId && this.contains(byId)) el = byId;
      }
      if (!el && d && d.source === 'add') {
        // Added from the upsell: its button is gone, focus the new line instead.
        const added = d.item || (d.items && d.items[0]);
        const line = added && this.lineFor(added.key);
        if (line) el = line.querySelector(FOCUS_ROLES.title);
      }
      if (!el) el = this.querySelector('[data-cart-heading]');
      if (el) el.focus();
    }

    /* ---------- Free-shipping bike ----------------------------------------- */
    shipProgress() {
      const track = this.querySelector('.free-ship__track');
      return track ? Math.min(100, parseInt(track.getAttribute('aria-valuenow'), 10) || 0) : null;
    }

    /* Glide the marker from the last progress the shopper saw to the current one. */
    glide(delay) {
      const track = this.querySelector('.free-ship__track');
      const bar = track && track.closest('[data-free-shipping]');
      if (!bar) { this._shown = 0; return; }
      const ship = bar.closest('.cart-ship') || bar;
      const target = this.shipProgress();
      const from = this._shown == null ? 0 : this._shown;
      this._shown = target;
      if (from === target || M.reducedMotion()) return;
      const complete = target >= 100;
      clearTimeout(this._rideT);
      track.style.setProperty('--progress', from + '%');
      if (complete) bar.classList.remove('is-complete');
      void track.offsetWidth; // commit the start position so the transition runs
      setTimeout(() => {
        ship.classList.add('is-riding');
        track.style.setProperty('--progress', target + '%');
        this._rideT = setTimeout(() => {
          ship.classList.remove('is-riding');
          if (!complete) return;
          bar.classList.add('is-complete');
          if (from < 100) {
            ship.classList.remove('is-celebrating');
            void ship.offsetWidth;
            ship.classList.add('is-celebrating');
            setTimeout(() => ship.classList.remove('is-celebrating'), 1600);
          }
        }, 900);
      }, delay || 30);
    }
  };

  /* ---------- <cart-drawer> ------------------------------------------------ */
  class CartDrawer extends CartMixin(M.SideDrawer) {
    get innerSelector() { return '.cart-drawer__inner'; }

    onReady() {
      if (this._drawerReady) return;
      this._drawerReady = true;
      window.addEventListener('pageshow', (e) => {
        if (e.persisted) M.cart.get().then((cart) => M.updateCartCount(cart.item_count)).catch(() => {});
      });
      // Theme editor: show the drawer while its section is selected.
      const mine = (e) => this.isConnected && e.detail && e.detail.sectionId === this.sectionId;
      doc.addEventListener('shopify:section:select', (e) => { if (mine(e)) this.open(); });
      doc.addEventListener('shopify:section:deselect', (e) => { if (mine(e)) this.close(); });
    }

    open(opener) {
      // Added from the cart page itself: the page already shows it, no need for the drawer.
      if (opener instanceof Element && opener.closest('.main-cart__inner')) return;
      const wasOpen = this.isOpen;
      super.open(opener);
      if (!wasOpen) this.glide(280); // let the panel slide in first
    }

    afterRender() {
      if (this.isOpen) this.glide();
    }
  }

  /* ---------- <cart-page> -------------------------------------------------- */
  class CartPage extends CartMixin(HTMLElement) {
    get innerSelector() { return '.main-cart__inner'; }

    onReady() {
      this._shown = this.shipProgress();
      this.setupSticky();
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      if (this._io) this._io.disconnect();
      doc.documentElement.style.removeProperty('--bottom-offset');
    }

    afterRender() {
      this.glide();
      this.setupSticky();
    }

    /* Mobile: show the sticky checkout bar while the summary's button is below the fold. */
    setupSticky() {
      if (this._io) this._io.disconnect();
      const bar = this.querySelector('[data-cart-sticky]');
      const target = this.querySelector('.cart-summary .cart-totals__checkout');
      const root = doc.documentElement;
      if (!bar || !target || !('IntersectionObserver' in window)) {
        root.style.removeProperty('--bottom-offset');
        return;
      }
      this._io = new IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        const show = !entry.isIntersecting && entry.boundingClientRect.top > 0;
        bar.classList.toggle('is-visible', show);
        const h = show ? bar.offsetHeight : 0;
        if (h) root.style.setProperty('--bottom-offset', h + 'px');
        else root.style.removeProperty('--bottom-offset');
      });
      this._io.observe(target);
    }
  }

  M.CartDrawer = CartDrawer;
  M.CartPage = CartPage;
  M.define('cart-drawer', CartDrawer);
  M.define('cart-page', CartPage);
})();
