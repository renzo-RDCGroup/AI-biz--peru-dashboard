/* Mi Bici 2026 — predictive-search.js
   <predictive-search> wraps a search <form> with input[name="q"]. As you type (debounced 250 ms)
   it fetches the "predictive-search" section through the Section Rendering API and injects it
   into [data-predictive-panel] (created when missing). The input is an ARIA 1.2 combobox:
   ↑/↓ move aria-activedescendant through [role="option"], Enter opens the active option (or
   submits the search), Esc closes (a second Esc clears), outside click / Tab away close.
   Results are cached per query; stale requests are aborted. Does nothing when the theme
   setting predictive_search is off (the form still posts to /search). */
(function () {
  'use strict';

  const M = window.MiBici;
  if (!M) return;
  const doc = document;
  let uid = 0;

  class PredictiveSearch extends HTMLElement {
    connectedCallback() {
      if (this._ready) {
        this.bindGlobal();
        return;
      }
      this.form = this.querySelector('form');
      this.input = this.querySelector('input[name="q"]');
      if (!this.form || !this.input || (M.settings && M.settings.predictiveSearch === false)) return;
      this._ready = true;
      this._idPrefix = 'ps' + (++uid);
      this.cache = new Map();
      this.options = [];
      this.active = -1;

      this.panel = this.querySelector('[data-predictive-panel]');
      if (!this.panel) {
        this.panel = doc.createElement('div');
        this.panel.className = 'predictive-search';
        this.panel.id = this._idPrefix + '-panel';
        this.panel.hidden = true;
        this.panel.setAttribute('data-predictive-panel', '');
        this.appendChild(this.panel);
      }
      this.backdrop = this.querySelector('[data-predictive-close]');
      this.status = this.querySelector('[data-predictive-status]');
      this.clearBtn = this.querySelector('[data-search-clear]');
      if (!this.input.hasAttribute('role')) {
        this.input.setAttribute('role', 'combobox');
        this.input.setAttribute('aria-expanded', 'false');
        this.input.setAttribute('aria-autocomplete', 'list');
        this.input.setAttribute('aria-controls', this.panel.id);
      }

      this.debounced = M.debounce(() => this.search(), 250);
      this.input.addEventListener('input', () => { this.syncClear(); this.debounced(); });
      this.input.addEventListener('focus', () => {
        if (this.input.value.trim() && this.panel.innerHTML.trim()) this.open();
      });
      this.input.addEventListener('keydown', (e) => this.onKey(e));
      this.addEventListener('focusout', (e) => {
        if (!this.contains(e.relatedTarget)) this.close();
      });
      // Pressing inside the results must not blur the input (Safari doesn't focus links, so
      // the blur would close the panel before the click lands).
      this.panel.addEventListener('mousedown', (e) => e.preventDefault());
      if (this.backdrop) this.backdrop.addEventListener('click', () => this.close());
      if (this.clearBtn) {
        this.clearBtn.addEventListener('click', () => {
          this.input.value = '';
          this.syncClear();
          this.close();
          this.panel.innerHTML = '';
          this.input.focus();
        });
      }
      this._onDocClick = (e) => {
        if (this.isOpen && e.target instanceof Node && !this.contains(e.target)) this.close();
      };
      this._onResize = M.debounce(() => { if (this.isOpen) this.position(); }, 100);
      this.syncClear();
      this.bindGlobal();
    }

    // Document/window listeners: added per connection, removed on disconnect.
    bindGlobal() {
      doc.addEventListener('click', this._onDocClick);
      window.addEventListener('resize', this._onResize);
    }

    disconnectedCallback() {
      if (!this._ready) return;
      doc.removeEventListener('click', this._onDocClick);
      window.removeEventListener('resize', this._onResize);
      if (this.controller) this.controller.abort();
      this.close();
    }

    get isOpen() { return this.classList.contains('is-open'); }

    syncClear() {
      if (this.clearBtn) this.clearBtn.hidden = !this.input.value;
    }

    url(q) {
      const params = new URLSearchParams();
      params.set('q', q);
      params.set('resources[type]', 'product,collection,query');
      params.set('resources[limit]', '6');
      params.set('resources[limit_scope]', 'each');
      params.set('resources[options][unavailable_products]', 'last');
      params.set('resources[options][fields]', 'title,product_type,variants.title,variants.sku,vendor,tag');
      params.set('section_id', 'predictive-search');
      return (M.routes.predictive_search || '/search/suggest') + '?' + params.toString();
    }

    search() {
      const q = this.input.value.trim();
      if (!q) {
        this.close();
        this.panel.innerHTML = '';
        return;
      }
      if (this.cache.has(q)) {
        this.render(this.cache.get(q));
        return;
      }
      if (this.controller) this.controller.abort();
      const controller = new AbortController();
      this.controller = controller;
      this.classList.add('is-loading');
      this.setAttribute('aria-busy', 'true');
      fetch(this.url(q), { signal: controller.signal, credentials: 'same-origin' })
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.text();
        })
        .then((text) => {
          const section = M.parseHTML(text).querySelector('[data-predictive-results]');
          // Unique ids per search box: "ps-…" → "<prefix>-ps-…".
          const html = section
            ? section.outerHTML.replace(/\b(id|aria-labelledby|aria-controls)="ps-/g, '$1="' + this._idPrefix + '-ps-')
            : '';
          this.cache.set(q, html);
          if (this.input.value.trim() === q) this.render(html);
        })
        .catch((err) => {
          if (err && err.name === 'AbortError') return;
          this.close();
        })
        .finally(() => {
          if (this.controller !== controller) return;
          this.classList.remove('is-loading');
          this.removeAttribute('aria-busy');
        });
    }

    render(html) {
      this.panel.innerHTML = html;
      this.options = Array.from(this.panel.querySelectorAll('[role="option"]'));
      this.active = -1;
      this.input.removeAttribute('aria-activedescendant');
      if (!html) {
        this.close();
        return;
      }
      const listbox = this.panel.querySelector('[role="listbox"]');
      if (listbox && listbox.id) this.input.setAttribute('aria-controls', listbox.id);
      // Options are reached with the arrow keys, never with Tab.
      this.options.forEach((o) => o.setAttribute('tabindex', '-1'));
      if (doc.activeElement === this.input || this.contains(doc.activeElement)) this.open();
      this.say();
    }

    say() {
      if (!this.status) return;
      const products = this.panel.querySelectorAll('.psearch__product').length;
      const d = this.dataset;
      const n = this.options.length;
      let text = d.statusNone || '';
      if (products || n > 1) text = n === 1 ? d.statusOne || '' : (d.statusTemplate || '').replace('[count]', n);
      this.status.textContent = '';
      setTimeout(() => { this.status.textContent = text; }, 80);
    }

    position() {
      const rect = this.getBoundingClientRect();
      const header = this.closest('header');
      const bottom = header ? header.getBoundingClientRect().bottom : rect.bottom;
      this.style.setProperty('--ps-top', Math.max(0, Math.round(bottom)) + 'px');
      this.style.setProperty('--ps-max-h', Math.max(220, Math.round(window.innerHeight - rect.bottom - 20)) + 'px');
    }

    open() {
      if (!this.panel.innerHTML.trim()) return;
      this.position();
      this.panel.hidden = false;
      if (this.backdrop) this.backdrop.hidden = false;
      this.classList.add('is-open');
      this.input.setAttribute('aria-expanded', 'true');
    }

    close() {
      if (!this.isOpen && this.panel.hidden) return;
      this.panel.hidden = true;
      if (this.backdrop) this.backdrop.hidden = true;
      this.classList.remove('is-open');
      this.input.setAttribute('aria-expanded', 'false');
      this.setActive(-1);
    }

    setActive(index) {
      this.options.forEach((o, i) => o.setAttribute('aria-selected', String(i === index)));
      this.active = index;
      const opt = this.options[index];
      if (opt) {
        this.input.setAttribute('aria-activedescendant', opt.id);
        opt.scrollIntoView({ block: 'nearest' });
      } else {
        this.input.removeAttribute('aria-activedescendant');
      }
    }

    onKey(e) {
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          if (!this.options.length) return;
          e.preventDefault();
          if (!this.isOpen) {
            this.open();
            return;
          }
          const n = this.options.length;
          const step = e.key === 'ArrowDown' ? 1 : -1;
          // From the input, ↓ lands on the first option and ↑ on the last; wraps around.
          const next = this.active < 0 ? (step > 0 ? 0 : n - 1) : (this.active + step + n) % n;
          this.setActive(next);
          break;
        }
        case 'Enter': {
          const opt = this.isOpen ? this.options[this.active] : null;
          if (opt && opt.href) {
            e.preventDefault();
            window.location.href = opt.href;
          }
          break;
        }
        case 'Escape':
          if (this.isOpen) {
            e.preventDefault();
            e.stopPropagation();
            this.close();
          } else if (this.input.value) {
            e.preventDefault();
            this.input.value = '';
            this.syncClear();
            this.panel.innerHTML = '';
          }
          break;
        default:
      }
    }
  }

  if (window.customElements && !customElements.get('predictive-search')) {
    customElements.define('predictive-search', PredictiveSearch);
  }
})();
