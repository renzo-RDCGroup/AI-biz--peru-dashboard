/* Mi Bici 2026 — facets.js (collection + search results)
   <facet-results data-section-id> wraps main-collection / main-search:
   · filter forms ([data-facets-form]), sort select ([data-sort-select]) and filter links
     ([data-facet-link]: active chips, "Limpiar") re-render through the Section Rendering API
     (?section_id=), then swap every [data-swap] zone, the filter groups and history.replaceState.
   · "Cargar más" ([data-load-more]) appends the next page to [data-results-grid].
   · Sticky toolbar gets .is-stuck (shadow) once it sticks under the header.
   Page-wide: [data-readmore] description toggles (collection banner) and centring of the active
   chip in [data-chip-row]. Loaded by several sections: the guard below runs it once. */
(function () {
  'use strict';

  if (window.MiBiciFacets) return;
  window.MiBiciFacets = true;
  const M = window.MiBici;
  if (!M) return;
  const doc = document;
  const PRICE_DELAY = 700;
  const CHECK_DELAY = 120;

  const cleanParams = (params) => {
    ['page', 'section_id', 'sections'].forEach((k) => params.delete(k));
    return params;
  };
  const paramsFromForm = (form) => {
    const params = new URLSearchParams();
    new FormData(form).forEach((value, key) => {
      if (typeof value === 'string' && value.trim() !== '') params.append(key, value.trim());
    });
    return params;
  };
  const paramsFromHref = (href) => {
    try { return new URL(href, location.href).searchParams; } catch (e) { return new URLSearchParams(); }
  };

  class FacetResults extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      this.sectionId = this.dataset.sectionId;
      this.cache = new Map();
      this.timer = null;

      this.addEventListener('change', (e) => this.onChange(e));
      this.addEventListener('input', (e) => this.onInput(e));
      this.addEventListener('submit', (e) => this.onSubmit(e));
      this.addEventListener('click', (e) => this.onClick(e));
      this.initToolbar();
    }

    disconnectedCallback() {
      if (this._onScroll) window.removeEventListener('scroll', this._onScroll);
    }

    /* ---------- Events --------------------------------------------------- */
    onChange(e) {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.matches('[data-sort-select]')) {
        this.apply(this.currentParams());
        return;
      }
      const form = t.closest('[data-facets-form]');
      if (!form) return;
      if (t.matches('[data-price-input]')) this.schedule(form, PRICE_DELAY);
      else this.schedule(form, CHECK_DELAY, t);
    }

    onInput(e) {
      const t = e.target;
      if (t instanceof Element && t.matches('[data-price-input]')) {
        const form = t.closest('[data-facets-form]');
        if (form) this.schedule(form, PRICE_DELAY);
      }
    }

    onSubmit(e) {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.matches('[data-sort-form]')) {
        e.preventDefault();
        this.apply(this.currentParams());
        return;
      }
      if (!form.matches('[data-facets-form]')) return;
      e.preventDefault();
      // Pending (debounced) change → apply now. Then the drawer's "Ver N productos" closes it.
      if (this.timer) this.flush(form);
      const drawer = form.closest('side-drawer');
      if (drawer && typeof drawer.close === 'function') drawer.close();
    }

    onClick(e) {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      const link = t.closest('a[data-facet-link]');
      if (link && this.contains(link)) {
        e.preventDefault();
        clearTimeout(this.timer);
        this.timer = null;
        this.apply(cleanParams(paramsFromHref(link.href)), link);
        return;
      }
      const more = t.closest('[data-load-more]');
      if (more) {
        e.preventDefault();
        this.loadMore(more);
        return;
      }
      const toggle = t.closest('[data-facet-more]');
      if (toggle) {
        const list = doc.getElementById(toggle.getAttribute('aria-controls'));
        if (!list) return;
        const open = !list.classList.contains('is-expanded');
        list.classList.toggle('is-expanded', open);
        toggle.setAttribute('aria-expanded', String(open));
        if (!toggle.dataset.labelMore) toggle.dataset.labelMore = toggle.textContent.trim();
        toggle.textContent = open ? toggle.dataset.labelLess : toggle.dataset.labelMore;
      }
    }

    /* ---------- Params ----------------------------------------------------- */
    get sortSelect() { return this.querySelector('[data-sort-select]'); }

    // The sort select lives outside the filter forms; the default order stays out of the URL.
    withSort(params) {
      const select = this.sortSelect;
      params.delete('sort_by');
      if (select && select.value && select.value !== select.dataset.default) params.set('sort_by', select.value);
      return params;
    }

    currentParams() {
      return this.withSort(cleanParams(new URLSearchParams(location.search)));
    }

    schedule(form, delay, source) {
      clearTimeout(this.timer);
      this.pendingForm = form;
      this.pendingSource = source || null;
      this.timer = setTimeout(() => this.flush(form), delay);
    }

    flush(form) {
      clearTimeout(this.timer);
      this.timer = null;
      const params = paramsFromForm(form || this.pendingForm);
      this.apply(this.withSort(cleanParams(params)), this.pendingSource);
    }

    /* ---------- Render ----------------------------------------------------- */
    url(params, extra) {
      const p = new URLSearchParams(params);
      if (extra) Object.keys(extra).forEach((k) => p.set(k, extra[k]));
      const qs = p.toString();
      return location.pathname + (qs ? '?' + qs : '');
    }

    async fetchSection(params, extra) {
      const url = this.url(params, Object.assign({ section_id: this.sectionId }, extra || {}));
      if (this.cache.has(url)) return this.cache.get(url);
      if (this.controller) this.controller.abort();
      const controller = (this.controller = 'AbortController' in window ? new AbortController() : null);
      const res = await fetch(url, { credentials: 'same-origin', signal: controller ? controller.signal : undefined });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const html = await res.text();
      if (this.cache.size > 20) this.cache.clear();
      this.cache.set(url, html);
      return html;
    }

    async apply(params, source) {
      const token = (this.token = (this.token || 0) + 1);
      this.setLoading(true);
      try {
        const html = await this.fetchSection(params);
        if (token !== this.token) return;
        const fresh = M.parseHTML(html).querySelector('facet-results');
        if (!fresh) throw new Error('No section');
        this.swap(fresh, source);
        history.replaceState(history.state, '', this.url(params));
        const count = this.querySelector('[data-swap="count"]');
        if (count) M.announce(count.textContent.trim());
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        window.location.href = this.url(params); // fall back to a normal page load
      } finally {
        if (token === this.token) this.setLoading(false);
      }
    }

    setLoading(on) {
      this.classList.toggle('is-loading', on);
      const body = this.querySelector('[data-swap="results"]');
      if (body) body.setAttribute('aria-busy', String(on));
    }

    swap(fresh, source) {
      const active = doc.activeElement;
      const activeId = active && active !== doc.body && this.contains(active) ? active.id : '';
      const lostFocus = () => !this.contains(doc.activeElement) || doc.activeElement === doc.body;

      // 1. Zones (top-level ones only: nested zones travel with their parent).
      fresh.querySelectorAll('[data-swap]').forEach((zone) => {
        if (zone.parentElement && zone.parentElement.closest('[data-swap]')) return;
        const cur = this.querySelector('[data-swap="' + zone.getAttribute('data-swap') + '"]');
        if (cur) cur.innerHTML = zone.innerHTML;
      });

      // 2. Filter groups, per form. The group being edited keeps its inputs (only counts
      //    and disabled states change); the others are replaced but keep their open state.
      this.querySelectorAll('form[data-facets-form]').forEach((form) => {
        const next = fresh.querySelector('#' + CSS.escape(form.id));
        const wrap = form.querySelector('.facets__groups');
        const nextWrap = next && next.querySelector('.facets__groups');
        if (!wrap || !nextWrap) return;
        const keep = new Set();
        let prev = null;
        Array.from(nextWrap.children).forEach((group) => {
          keep.add(group.id);
          let cur = group.id ? doc.getElementById(group.id) : null;
          if (cur && !wrap.contains(cur)) cur = null;
          if (cur && (cur.contains(active) || (source && cur.contains(source)))) {
            this.syncGroup(cur, group);
          } else if (cur) {
            group.open = cur.open;
            cur.replaceWith(group);
            cur = group;
          } else {
            cur = group;
            if (prev) prev.after(group);
            else wrap.prepend(group);
          }
          prev = cur;
        });
        Array.from(wrap.children).forEach((el) => { if (!keep.has(el.id)) el.remove(); });
      });

      // 3. Focus: back to the same control, else to the results count.
      if (lostFocus()) {
        const target = (activeId && doc.getElementById(activeId)) || this.querySelector('[data-results-focus]');
        if (target && target.offsetParent !== null) target.focus({ preventScroll: true });
      }
    }

    syncGroup(cur, next) {
      next.querySelectorAll('input[id]').forEach((input) => {
        const mine = doc.getElementById(input.id);
        if (!mine || mine.type === 'number') return;
        mine.disabled = input.disabled;
        mine.checked = input.checked;
        const label = mine.closest('.facet__option');
        const nextLabel = input.closest('.facet__option');
        if (label && nextLabel) {
          label.classList.toggle('is-disabled', nextLabel.classList.contains('is-disabled'));
          const count = label.querySelector('[data-count]');
          const nextCount = nextLabel.querySelector('[data-count]');
          if (count && nextCount) count.textContent = nextCount.textContent;
        }
      });
      const summary = cur.querySelector('.facet__summary');
      const nextSummary = next.querySelector('.facet__summary');
      if (summary && nextSummary) summary.innerHTML = nextSummary.innerHTML;
    }

    /* ---------- Load more -------------------------------------------------- */
    async loadMore(button) {
      if (button.classList.contains('is-loading')) return;
      button.classList.add('is-loading');
      button.setAttribute('aria-busy', 'true');
      const params = cleanParams(new URLSearchParams(location.search));
      try {
        const html = await this.fetchSection(params, { page: button.dataset.nextPage });
        const fresh = M.parseHTML(html).querySelector('facet-results');
        const grid = this.querySelector('[data-results-grid]');
        const nextGrid = fresh && fresh.querySelector('[data-results-grid]');
        if (!grid || !nextGrid) throw new Error('No grid');
        const added = Array.from(nextGrid.children);
        added.forEach((li) => grid.appendChild(doc.adoptNode(li)));
        if (added.length) grid.hidden = false;

        // Extra lists (search: pages / articles) grow too.
        fresh.querySelectorAll('[data-append-list]').forEach((list) => {
          const mine = this.querySelector('[data-append-list="' + list.getAttribute('data-append-list') + '"]');
          if (!mine) return;
          Array.from(list.children).forEach((li) => mine.appendChild(doc.adoptNode(li)));
          if (mine.children.length && mine.parentElement) mine.parentElement.hidden = false;
        });

        const more = this.querySelector('[data-results-more]');
        const nextMore = fresh.querySelector('[data-results-more]');
        if (more && nextMore) more.replaceWith(doc.adoptNode(nextMore));
        else if (more) more.remove();

        const first = added[0] && added[0].querySelector('a[href]:not([tabindex="-1"])');
        if (first) first.focus({ preventScroll: true });
        const status = this.querySelector('.results-more__status');
        if (status) M.announce(status.textContent.trim());
      } catch (err) {
        const next = new URLSearchParams(params);
        next.set('page', button.dataset.nextPage);
        window.location.href = this.url(next);
      } finally {
        button.classList.remove('is-loading');
        button.removeAttribute('aria-busy');
      }
    }

    /* ---------- Sticky toolbar --------------------------------------------- */
    initToolbar() {
      const bar = this.querySelector('[data-toolbar]');
      if (!bar) return;
      let raf = 0;
      const update = () => {
        raf = 0;
        const top = parseFloat(getComputedStyle(bar).top) || 0;
        const rect = bar.getBoundingClientRect();
        const box = this.getBoundingClientRect();
        bar.classList.toggle('is-stuck', rect.top <= top + 1 && box.top < top && box.bottom > rect.bottom);
      };
      this._onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
      window.addEventListener('scroll', this._onScroll, { passive: true });
      update();
    }
  }
  M.define('facet-results', FacetResults);

  /* ---------- Page-wide helpers ------------------------------------------- */
  // Collection description "Leer más": the button is shown only when the text overflows.
  const initReadMore = () => {
    doc.querySelectorAll('[data-readmore]').forEach((btn) => {
      const target = doc.getElementById(btn.getAttribute('data-readmore'));
      if (!target) return;
      const overflowing = target.scrollHeight > target.clientHeight + 2;
      target.classList.toggle('is-clamped', overflowing);
      btn.hidden = !overflowing && !target.classList.contains('is-expanded');
    });
  };
  doc.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('[data-readmore]') : null;
    if (!btn) return;
    const target = doc.getElementById(btn.getAttribute('data-readmore'));
    if (!target) return;
    const open = !target.classList.contains('is-expanded');
    target.classList.toggle('is-expanded', open);
    btn.setAttribute('aria-expanded', String(open));
    if (!btn.dataset.labelMore) btn.dataset.labelMore = btn.textContent.trim();
    btn.textContent = open ? btn.dataset.labelLess : btn.dataset.labelMore;
  });

  // Scroll horizontally-scrolling chip rows so the current chip is visible.
  const centreChips = () => {
    doc.querySelectorAll('[data-chip-row]').forEach((row) => {
      const current = row.querySelector('[aria-current="page"]');
      if (!current || row.scrollWidth <= row.clientWidth) return;
      const item = current.closest('li') || current;
      row.scrollLeft = Math.max(0, item.offsetLeft - (row.clientWidth - item.offsetWidth) / 2);
    });
  };

  const init = () => {
    initReadMore();
    centreChips();
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(initReadMore);
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
  doc.addEventListener('shopify:section:load', init);
})();
