/* Mi Bici 2026 — header.js
   <site-header>: sticky modes (always | on-scroll-up | none), --header-height upkeep for the
   non-"always" modes, condensed mobile search (on-scroll-up), keyboard-accessible desktop
   dropdowns (disclosure pattern), cart link label + bump. Needs global.js (window.MiBici).
   The announcement bar has its own file: announcement-bar.js. */
(function () {
  'use strict';

  const M = window.MiBici || {};
  const doc = document;
  const root = doc.documentElement;
  const define = (name, ctor) => {
    if (window.customElements && !customElements.get(name)) customElements.define(name, ctor);
  };
  const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const desktop = window.matchMedia ? matchMedia('(min-width: 990px)') : { matches: true };
  const finePointer = window.matchMedia ? matchMedia('(hover: hover) and (pointer: fine)') : { matches: true };

  class SiteHeader extends HTMLElement {
    connectedCallback() {
      this.mode = this.dataset.sticky || 'always';
      this.header = this.querySelector('[data-header-bar]');
      this.section = this.closest('.shopify-section') || this;
      if (!this.header) return;
      if (!this._bound) {
        // Listeners on our own children: bound once, they live and die with the markup.
        this._bound = true;
        this.bindNav();
        this.bindSearchToggle();
      }
      // Listeners on window/document: bound per connection, removed on disconnect.
      this._off = [];
      this.listen(doc, 'click', (e) => {
        if (!(e.target instanceof Element) || !e.target.closest('[data-nav-item]')) this.closeAll();
      });
      this.listen(doc, 'drawer:open', () => this.closeAll());
      this.listen(doc, 'cart:updated', (e) => this.onCart(e));
      if (desktop.addEventListener) this.listen(desktop, 'change', () => this.closeAll());
      if (this.mode !== 'none') this.initScroll();
    }

    disconnectedCallback() {
      if (this._ro) this._ro.disconnect();
      (this._off || []).forEach((off) => off());
      this._off = [];
    }

    listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      this._off.push(() => target.removeEventListener(type, fn, opts));
    }

    /* Sticky + on-scroll-up ------------------------------------------------ */
    initScroll() {
      this.lastY = window.scrollY;
      this._isHidden = false;
      const onScroll = () => {
        if (this._ticking) return;
        this._ticking = true;
        requestAnimationFrame(() => { this._ticking = false; this.update(); });
      };
      this.listen(window, 'scroll', onScroll, { passive: true });
      if (this.mode === 'on-scroll-up') {
        // The wrapper keeps the full header height while the mobile header is condensed, so
        // folding the search row never shifts the page (which would fight scroll anchoring).
        this.section.classList.add('header-section--fixed-box');
        const measure = () => {
          if (!this.header.classList.contains('is-condensed')) {
            this.section.style.minHeight = Math.ceil(this.header.getBoundingClientRect().height) + 'px';
          }
          this.setHeaderVar();
        };
        if ('ResizeObserver' in window) {
          this._ro = new ResizeObserver(measure);
          this._ro.observe(this.header);
          // global-ui.js observes the header-group sections too and then measures the 0px
          // sentinel; its observer was created first, so ours runs after it and wins.
          doc.querySelectorAll('.shopify-section-group-header-group').forEach((el) => this._ro.observe(el));
        }
        this.listen(window, 'resize', M.debounce ? M.debounce(measure, 150) : measure);
        this.listen(doc, 'shopify:section:load', () => requestAnimationFrame(measure));
        measure();
      }
      this.update();
    }

    // Offset of the header when it is not stuck (height of the header-group sections above it).
    naturalTop() {
      let top = 0;
      let el = this.section.previousElementSibling;
      while (el) {
        if (el.classList && el.classList.contains('shopify-section')) top += el.getBoundingClientRect().height;
        el = el.previousElementSibling;
      }
      return top;
    }

    // Never hide the header under an open panel or while keyboard/search focus is in it.
    busy() {
      const active = doc.activeElement;
      let focused = false;
      if (active && active !== doc.body && this.contains(active)) {
        try { focused = active.matches('input, :focus-visible'); } catch (e) { focused = true; }
      }
      return focused || root.classList.contains('scroll-locked') ||
        !!this.querySelector('.header-nav__item.is-open, predictive-search.is-open, side-drawer[open]');
    }

    update() {
      const y = Math.max(0, window.scrollY);
      const dy = y - this.lastY;
      const top = this.naturalTop();
      const past = y > top + this.section.getBoundingClientRect().height;
      this.section.classList.toggle('is-stuck', y > top + 1);

      if (this.mode === 'on-scroll-up') {
        // After "open search" the row stays unfolded until the page moves on a bit.
        if (this._searchOpen && Math.abs(y - this._searchY) > 120 && !this.busy()) this._searchOpen = false;
        if (!past) {
          this.setHidden(false);
          this.setCondensed(false);
        } else if (dy > 6 && !this.busy()) {
          this.setHidden(true);
          this.setCondensed(true);
        } else if (dy < -6) {
          this.setHidden(false);
        }
      }
      this.lastY = y;
    }

    setHidden(state) {
      if (this._isHidden === state) return;
      this._isHidden = state;
      this.section.classList.toggle('is-header-hidden', state);
      this.section.style.top = state ? -(Math.ceil(this.section.getBoundingClientRect().height) + 16) + 'px' : '';
      if (state) this.closeAll();
      this.setHeaderVar();
    }

    setCondensed(state) {
      const on = state && !this._searchOpen;
      if (this.header.classList.contains('is-condensed') === on) return;
      this.header.classList.toggle('is-condensed', on);
      const toggle = this.querySelector('[data-search-toggle]');
      if (toggle) toggle.setAttribute('aria-expanded', String(!on));
    }

    setHeaderVar() {
      if (this.mode !== 'on-scroll-up') return;
      const h = this._isHidden ? 0 : Math.round(this.header.getBoundingClientRect().height);
      root.style.setProperty('--header-height', h + 'px');
    }

    bindSearchToggle() {
      const toggle = this.querySelector('[data-search-toggle]');
      if (!toggle) return;
      toggle.addEventListener('click', () => {
        this._searchOpen = true;
        this._searchY = window.scrollY;
        this.header.classList.remove('is-condensed');
        toggle.setAttribute('aria-expanded', 'true');
        const input = this.querySelector('input[name="q"]');
        if (input) input.focus({ preventScroll: true });
      });
    }

    /* Cart link: accessible label follows the count; a small bump after adding. */
    onCart(e) {
      const cart = e.detail && e.detail.cart;
      if (!cart) return;
      const n = parseInt(cart.item_count, 10) || 0;
      this.querySelectorAll('[data-cart-link]').forEach((link) => {
        const d = link.dataset;
        const label = n === 0 ? d.labelZero : n === 1 ? d.labelOne : (d.labelOther || '').replace('[count]', n);
        if (label) link.setAttribute('aria-label', label);
        if (e.detail.source === 'add' && !reducedMotion()) {
          link.classList.remove('is-bumped');
          void link.offsetWidth; // restart the animation
          link.classList.add('is-bumped');
        }
      });
    }

    /* Desktop dropdowns (disclosure pattern) -------------------------------- */
    bindNav() {
      this.items = Array.from(this.querySelectorAll('[data-nav-item]'));
      this.topLinks = Array.from(this.querySelectorAll('.header-nav__link'));
      this.items.forEach((item) => {
        const toggle = item.querySelector('[data-nav-toggle]');
        if (!toggle) return;
        toggle.addEventListener('click', () => this.setOpen(item, !item.classList.contains('is-open')));
        // Hover intent (mouse only): short delays so passing over an item doesn't flash it open.
        item.addEventListener('mouseenter', () => {
          if (!finePointer.matches || !desktop.matches) return;
          clearTimeout(item._timer);
          item._timer = setTimeout(() => this.setOpen(item, true), 70);
        });
        item.addEventListener('mouseleave', () => {
          if (!finePointer.matches) return;
          clearTimeout(item._timer);
          item._timer = setTimeout(() => {
            if (!item.contains(doc.activeElement)) this.setOpen(item, false);
          }, 200);
        });
        item.addEventListener('focusout', (e) => {
          if (!item.contains(e.relatedTarget)) this.setOpen(item, false);
        });
      });
      const nav = this.querySelector('.header-nav');
      if (nav) nav.addEventListener('keydown', (e) => this.onNavKey(e));
    }

    setOpen(item, open) {
      clearTimeout(item._timer);
      if (open) this.items.forEach((other) => { if (other !== item) this.setOpen(other, false); });
      item.classList.toggle('is-open', open);
      const toggle = item.querySelector('[data-nav-toggle]');
      if (toggle) toggle.setAttribute('aria-expanded', String(open));
    }

    closeAll() {
      if (this.items) this.items.forEach((item) => { if (item.classList.contains('is-open')) this.setOpen(item, false); });
    }

    // Enter/Space on the chevron toggles (native button). ↓ opens + focuses the first link,
    // ↑↓ Home End move inside the panel, Esc closes and returns to the chevron, ←→ move
    // between top-level links.
    onNavKey(e) {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      const item = target.closest('[data-nav-item]');
      const panel = item && item.querySelector('[data-nav-panel]');
      const inPanel = !!(panel && panel.contains(target));
      const links = panel ? Array.from(panel.querySelectorAll('a[href]')) : [];
      const topItem = target.closest('.header-nav__item');
      const topIndex = topItem ? this.topLinks.indexOf(topItem.querySelector('.header-nav__link')) : -1;
      const toggle = item && item.querySelector('[data-nav-toggle]');

      switch (e.key) {
        case 'Escape':
          if (item && item.classList.contains('is-open')) {
            e.preventDefault();
            this.setOpen(item, false);
            if (toggle) toggle.focus();
          }
          break;
        case 'ArrowDown':
          if (!item || !links.length) break;
          e.preventDefault();
          if (!inPanel) {
            this.setOpen(item, true);
            requestAnimationFrame(() => links[0].focus());
          } else {
            links[(links.indexOf(target) + 1) % links.length].focus();
          }
          break;
        case 'ArrowUp':
          if (!inPanel) break;
          e.preventDefault();
          if (links.indexOf(target) <= 0) { if (toggle) toggle.focus(); }
          else links[links.indexOf(target) - 1].focus();
          break;
        case 'Home':
        case 'End':
          if (!inPanel) break;
          e.preventDefault();
          links[e.key === 'Home' ? 0 : links.length - 1].focus();
          break;
        case 'ArrowRight':
        case 'ArrowLeft': {
          if (inPanel || topIndex < 0) break;
          e.preventDefault();
          const step = e.key === 'ArrowRight' ? 1 : -1;
          const next = this.topLinks[(topIndex + step + this.topLinks.length) % this.topLinks.length];
          this.closeAll();
          if (next) next.focus();
          break;
        }
        default:
      }
    }
  }
  define('site-header', SiteHeader);
})();
