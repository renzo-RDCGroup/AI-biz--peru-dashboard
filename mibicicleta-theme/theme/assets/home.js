/* Mi Bici 2026 — home.js (homepage sections)
   <featured-tabs>   sections/featured-collection.liquid: ARIA tabs (automatic activation,
                     ←/→/Home/End), swaps the server-rendered panels and the "Ver todo" link,
                     refreshes the carousel that becomes visible. Theme editor block select aware.
   <marquee-toggle>  sections/brand-marquee.liquid: pause/play button for the brand ribbon
                     (WCAG 2.2.2); the ribbon also pauses on hover/focus via CSS. */
(function () {
  'use strict';

  const define = (name, ctor) => {
    if (window.customElements && !customElements.get(name)) customElements.define(name, ctor);
  };

  class FeaturedTabs extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this.tablist = this.querySelector('[role="tablist"]');
      if (!this.tablist) return;
      this.tabs = Array.from(this.tablist.querySelectorAll('[role="tab"]'));
      if (this.tabs.length < 2) return;
      this._ready = true;
      const section = this.closest('.featured');
      this.viewAll = section ? section.querySelector('.section-heading__link') : null;

      this.tablist.addEventListener('click', (e) => {
        const tab = e.target instanceof Element ? e.target.closest('[role="tab"]') : null;
        if (tab && this.tabs.includes(tab)) this.select(tab);
      });
      this.tablist.addEventListener('keydown', (e) => this.onKey(e));
      // Theme editor: selecting a tab block shows its panel.
      this.addEventListener('shopify:block:select', (e) => {
        const tab = e.target instanceof Element ? e.target.closest('[role="tab"]') : null;
        if (tab) this.select(tab, false);
      });
    }

    get current() {
      return this.tabs.find((t) => t.getAttribute('aria-selected') === 'true') || this.tabs[0];
    }

    select(tab, focus) {
      if (!tab || tab === this.current) {
        if (tab && focus) tab.focus();
        return;
      }
      this.tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls') || '');
        if (panel) panel.hidden = !on;
      });
      if (focus) tab.focus();
      // Keep the active chip visible in the scrollable row (mobile).
      if (typeof tab.scrollIntoView === 'function' && this.tablist.scrollWidth > this.tablist.clientWidth) {
        tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }

      const panel = document.getElementById(tab.getAttribute('aria-controls') || '');
      const slider = panel ? panel.querySelector('carousel-slider') : null;
      if (slider && typeof slider.refresh === 'function') {
        requestAnimationFrame(() => {
          if (slider.track) slider.track.scrollLeft = 0;
          slider.refresh();
        });
      }

      if (this.viewAll) {
        const url = tab.getAttribute('data-url');
        if (url) {
          this.viewAll.setAttribute('href', url);
          this.viewAll.hidden = false;
        } else {
          this.viewAll.hidden = true;
        }
      }
    }

    onKey(e) {
      const i = this.tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const n = this.tabs.length;
      let next = -1;
      if (e.key === 'ArrowRight') next = (i + 1) % n;
      else if (e.key === 'ArrowLeft') next = (i - 1 + n) % n;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = n - 1;
      if (next < 0) return;
      e.preventDefault();
      this.select(this.tabs[next], true);
    }
  }

  class MarqueeToggle extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this.button = this.querySelector('[data-marquee-toggle]');
      if (!this.button) return;
      this._ready = true;
      this.button.addEventListener('click', () => this.toggle());
    }

    toggle() {
      const paused = !this.classList.contains('is-paused');
      this.classList.toggle('is-paused', paused);
      const label = paused ? this.dataset.playLabel : this.dataset.pauseLabel;
      if (label) this.button.setAttribute('aria-label', label);
    }
  }

  define('featured-tabs', FeaturedTabs);
  define('marquee-toggle', MarqueeToggle);
})();
