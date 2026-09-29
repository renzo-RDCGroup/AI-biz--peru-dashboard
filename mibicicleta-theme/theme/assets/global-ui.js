/* Mi Bici 2026 — global-ui.js (2/2: custom elements + page behaviours)
   <side-drawer>, <quantity-input>, <product-form>, reveal-on-scroll, --header-height.
   Requires global.js (window.MiBici) to be loaded first. */
(function () {
  'use strict';

  const M = window.MiBici;
  if (!M || !M.cart) return;
  const doc = document;
  const root = doc.documentElement;
  const emit = M.emit;
  const define = M.define;

  /* ---------- <side-drawer> ------------------------------------------- */
  class SideDrawer extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      this.panel = this.querySelector('.drawer__panel') || this;
      if (this.panel !== this && !this.panel.hasAttribute('role')) {
        this.panel.setAttribute('role', 'dialog');
        this.panel.setAttribute('aria-modal', 'true');
      }
      if (!this.panel.hasAttribute('tabindex')) this.panel.setAttribute('tabindex', '-1');
      if (!this.hasAttribute('open')) this.setAttribute('aria-hidden', 'true');
      this.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) {
          e.stopPropagation();
          this.close();
        }
      });
    }

    disconnectedCallback() {
      if (this.isOpen) {
        M.releaseFocus(this.panel);
        M.unlockScroll();
      }
    }

    get isOpen() { return this.hasAttribute('open'); }

    open(opener) {
      if (this.isOpen) return;
      doc.querySelectorAll('side-drawer[open], .drawer[open]').forEach((d) => {
        if (d !== this && typeof d.close === 'function') d.close(true);
      });
      this._opener = opener instanceof HTMLElement ? opener : doc.activeElement;
      this.setAttribute('open', '');
      this.setAttribute('aria-hidden', 'false');
      this.setExpanded(true);
      M.lockScroll();
      M.trapFocus(this.panel || this, this.querySelector('[data-drawer-autofocus]'));
      emit('drawer:open', { id: this.id }, this);
    }

    close(skipFocusReturn) {
      if (!this.isOpen) return;
      this.removeAttribute('open');
      this.setAttribute('aria-hidden', 'true');
      this.setExpanded(false);
      M.releaseFocus(this.panel || this);
      M.unlockScroll();
      const opener = this._opener;
      this._opener = null;
      if (!skipFocusReturn && opener && opener.isConnected && typeof opener.focus === 'function') {
        opener.focus({ preventScroll: true });
      }
      emit('drawer:close', { id: this.id }, this);
    }

    toggle(opener) {
      if (this.isOpen) this.close();
      else this.open(opener);
    }

    setExpanded(state) {
      if (!this.id) return;
      const id = window.CSS && CSS.escape ? CSS.escape(this.id) : this.id;
      doc.querySelectorAll('[data-drawer-open="' + id + '"], [aria-controls="' + id + '"]').forEach((el) => {
        el.setAttribute('aria-expanded', String(state));
      });
    }
  }
  M.SideDrawer = SideDrawer;
  define('side-drawer', SideDrawer);

  /* ---------- <quantity-input> ---------------------------------------- */
  class QuantityInput extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this.input = this.querySelector('input');
      if (!this.input) return;
      this._ready = true;
      this.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-qty]') : null;
        if (!btn || !this.contains(btn)) return;
        e.preventDefault();
        this.step(btn.getAttribute('data-qty') === 'plus' ? 1 : -1);
      });
      this.input.addEventListener('change', () => {
        this.clamp();
        this.sync();
      });
      this.sync();
    }

    get min() { const v = parseInt(this.input.min, 10); return isNaN(v) ? 0 : v; }
    get max() { const v = parseInt(this.input.max, 10); return isNaN(v) ? Infinity : v; }
    get stepSize() { const v = parseInt(this.input.step, 10); return v > 0 ? v : 1; }
    get value() { return parseInt(this.input.value, 10) || 0; }

    clamp() {
      let v = parseInt(this.input.value, 10);
      if (isNaN(v)) v = Math.max(this.min, 1);
      v = Math.min(this.max, Math.max(this.min, v));
      if (String(v) !== this.input.value) this.input.value = v;
      return v;
    }

    step(direction) {
      const before = this.value;
      const next = Math.min(this.max, Math.max(this.min, before + direction * this.stepSize));
      if (next === before) return;
      this.input.value = next;
      this.sync();
      this.input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    sync() {
      const v = this.value;
      const minus = this.querySelector('[data-qty="minus"]');
      const plus = this.querySelector('[data-qty="plus"]');
      // aria-disabled (not disabled) keeps keyboard focus on the button.
      if (minus) minus.setAttribute('aria-disabled', String(v <= this.min));
      if (plus) plus.setAttribute('aria-disabled', String(v >= this.max));
    }
  }
  define('quantity-input', QuantityInput);

  /* ---------- <product-form> ------------------------------------------ */
  class ProductForm extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this.form = this.querySelector('form');
      if (!this.form) return;
      this._ready = true;
      this.form.addEventListener('submit', (e) => this.onSubmit(e));
    }

    get errorEl() {
      let el = this.querySelector('[data-form-error]');
      if (!el && this.form) {
        el = doc.createElement('p');
        el.className = 'form-message form-message--error';
        el.setAttribute('data-form-error', '');
        el.setAttribute('role', 'alert');
        el.hidden = true;
        this.form.appendChild(el);
      }
      return el;
    }

    showError(message) {
      const el = this.errorEl;
      if (!el) return;
      el.textContent = message || '';
      el.hidden = !message;
      clearTimeout(this._errTimer);
      if (message && this.classList.contains('product-card__quick')) {
        this._errTimer = setTimeout(() => { el.hidden = true; }, 5000);
      }
    }

    onSubmit(e) {
      const submitter = e.submitter || this.form.querySelector('[type="submit"]');
      const buyNow = !!(submitter && submitter.getAttribute('data-redirect') === 'checkout');
      if (!buyNow && M.settings.cartType !== 'drawer') return; // native POST → cart page
      e.preventDefault();
      if (this._busy) return;
      if (submitter && (submitter.disabled || submitter.getAttribute('aria-disabled') === 'true')) return;

      this._busy = true;
      this.showError('');
      if (submitter) {
        submitter.classList.add('is-loading');
        submitter.setAttribute('aria-busy', 'true');
      }
      let redirecting = false;

      M.cart.add(new FormData(this.form))
        .then((res) => {
          if (buyNow) {
            redirecting = true;
            window.location.href = '/checkout';
            return;
          }
          M.announce(M.strings.added);
          if (submitter) {
            submitter.classList.add('is-added');
            setTimeout(() => submitter.classList.remove('is-added'), 1800);
          }
          this.dispatchEvent(new CustomEvent('product-form:added', { bubbles: true, detail: res }));
          emit('cart:open', { opener: submitter || null });
        })
        .catch((err) => this.showError((err && err.message) || M.strings.cartError))
        .finally(() => {
          this._busy = false;
          if (submitter && !redirecting) {
            submitter.classList.remove('is-loading');
            submitter.removeAttribute('aria-busy');
          }
        });
    }
  }
  define('product-form', ProductForm);

  /* ---------- Reveal on scroll ---------------------------------------- */
  let revealObserver = null;
  let revealWatcher = null;
  const finishReveal = (el) => {
    el.classList.add('is-revealed');
    // Drop the attribute afterwards so the element's own transitions apply again.
    setTimeout(() => el.removeAttribute('data-reveal'), 1500);
  };
  M.initReveal = function (scope) {
    if (M.settings.designMode || M.reducedMotion() || !('IntersectionObserver' in window)) return;
    const base = scope && scope.querySelectorAll ? scope : doc;
    const els = Array.from(base.querySelectorAll('[data-reveal]:not(.is-revealed)'));
    if (scope instanceof Element && scope.matches('[data-reveal]:not(.is-revealed)')) els.push(scope);
    if (!revealObserver) {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          revealObserver.unobserve(entry.target);
          finishReveal(entry.target);
        });
      }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    }
    const vh = window.innerHeight || root.clientHeight;
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) finishReveal(el); // already visible: never hide it
      else revealObserver.observe(el);
    });
    root.classList.add('reveal-ready');

    // Content injected later (AJAX grids, "Cargar más"…) is picked up automatically.
    if (!revealWatcher && 'MutationObserver' in window) {
      let pending = [];
      revealWatcher = new MutationObserver((mutations) => {
        mutations.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) pending.push(n); }));
        if (!pending.length) return;
        const nodes = pending;
        pending = [];
        requestAnimationFrame(() => nodes.forEach((n) => n.isConnected && M.initReveal(n)));
      });
      revealWatcher.observe(doc.body, { childList: true, subtree: true });
    }
  };

  /* ---------- Header height → --header-height ------------------------- */
  let headerObserver = null;
  let lastH = null;
  let lastG = null;
  M.measureHeader = function () {
    const header = doc.querySelector('[data-header]') || doc.querySelector('.shopify-section-group-header-group header, header');
    const groups = doc.querySelectorAll('.shopify-section-group-header-group');
    // Read everything first, then write only what changed: a :root custom property write between
    // two layout reads forces a full-document style recalc.
    const set = () => {
      const h = header ? Math.round(header.getBoundingClientRect().height) : null;
      let total = 0;
      groups.forEach((g) => { total += g.getBoundingClientRect().height; });
      total = Math.round(total);
      if (h !== null && h !== lastH) { lastH = h; root.style.setProperty('--header-height', h + 'px'); }
      if (total && total !== lastG) { lastG = total; root.style.setProperty('--header-group-height', total + 'px'); }
    };
    set();
    if (headerObserver) headerObserver.disconnect();
    if ('ResizeObserver' in window) {
      headerObserver = new ResizeObserver(set);
      if (header) headerObserver.observe(header);
      groups.forEach((g) => headerObserver.observe(g));
    }
  };

  /* ---------- Boot ----------------------------------------------------- */
  function init() {
    M.initReveal(); // layout reads before measureHeader's writes (no second forced recalc)
    M.measureHeader();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();

  if (!('ResizeObserver' in window)) window.addEventListener('resize', M.debounce(M.measureHeader, 150));

  // Theme editor: re-run per-section setup when a section is re-rendered.
  doc.addEventListener('shopify:section:load', (e) => {
    M.initReveal(e.target);
    M.measureHeader();
  });

  // Theme editor: a selected block must be visible. Open the <details> the block is or contains
  // (FAQ questions, product collapsible rows, mobile footer columns) and close it again on
  // deselect only if we opened it. The brand marquee holds itself (home.js).
  if (M.settings.designMode) {
    const detailsOf = (e) => {
      const t = e.target;
      return t instanceof Element ? (t.matches('details') ? t : t.querySelector('details')) : null;
    };
    doc.addEventListener('shopify:block:select', (e) => {
      const d = detailsOf(e);
      if (d && !d.open) { d.open = true; d.setAttribute('data-editor-opened', ''); }
    });
    doc.addEventListener('shopify:block:deselect', (e) => {
      const d = detailsOf(e);
      if (d && d.hasAttribute('data-editor-opened')) { d.open = false; d.removeAttribute('data-editor-opened'); }
    });
  }
})();
