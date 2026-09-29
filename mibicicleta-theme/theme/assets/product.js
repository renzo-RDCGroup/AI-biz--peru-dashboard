/* Mi Bici 2026 — product.js: <product-info> (variant updates, emits variant:change), <variant-picker>,
   <product-gallery>, <sticky-atc>, <delivery-estimate>, <pickup-availability>, <share-button>. */
(function () {
  'use strict';

  const M = window.MiBici;
  if (!M || !M.define || M._productJS) return;
  M._productJS = true;
  const doc = document;
  const all = (sel, root) => Array.from((root || doc).querySelectorAll(sel));

  /* <variant-picker> */
  class VariantPicker extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      const json = this.querySelector('[data-product-json]');
      try { this.variants = json ? JSON.parse(json.textContent) : []; } catch (e) { this.variants = []; }
    }

    get groups() { return all('[data-option-index]', this); }

    selected() {
      return this.groups.map((el) => {
        if (el.tagName === 'SELECT') return el.value;
        const checked = el.querySelector('input:checked');
        return checked ? checked.value : null;
      });
    }

    find(opts) {
      return this.variants.find((v) => v.options.every((o, i) => o === opts[i])) || null;
    }

    // Mark values sold out / missing given the other selected options.
    refresh(opts) {
      const soldLabel = this.dataset.labelSoldOut || '';
      const naLabel = this.dataset.labelUnavailable || '';
      this.groups.forEach((group) => {
        const i = Number(group.dataset.optionIndex);
        const isSelect = group.tagName === 'SELECT';
        const items = isSelect ? Array.from(group.options) : all('input', group);
        items.forEach((input) => {
          const want = opts.slice();
          want[i] = input.value;
          const match = this.find(want);
          const state = !match ? naLabel : match.available ? '' : soldLabel;
          if (isSelect) {
            input.textContent = (input.dataset.value || input.value) + (state ? ' — ' + state : '');
            return;
          }
          const label = input.nextElementSibling;
          if (!label) return;
          label.classList.toggle('is-unavailable', !!state);
          const status = label.querySelector('[data-value-status]');
          if (status) status.textContent = state ? ' (' + state + ')' : '';
        });
        const current = group.querySelector('[data-selected-value]');
        if (current) current.textContent = opts[i] || '';
      });
    }
  }
  M.define('variant-picker', VariantPicker);

  /* <product-info> */
  class ProductInfo extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      this.sectionId = this.dataset.sectionId;
      this.picker = this.querySelector('variant-picker');
      if (this.picker) this.picker.addEventListener('change', () => this.onChange());
      this.addEventListener('click', (e) => {
        const more = e.target instanceof Element ? e.target.closest('[data-read-more]') : null;
        if (!more) return;
        const target = doc.getElementById((more.getAttribute('href') || '').slice(1));
        if (!target) return;
        e.preventDefault();
        if (target.tagName === 'DETAILS') target.open = true;
        target.scrollIntoView({ behavior: M.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
        const summary = target.querySelector('summary');
        if (summary) summary.focus({ preventScroll: true });
      });
    }

    get form() { return doc.getElementById('product-form-' + this.sectionId); }

    onChange() {
      if (!this.picker || !this.picker.variants) return;
      const opts = this.picker.selected();
      const variant = this.picker.find(opts);
      this.picker.refresh(opts);
      this.render(variant);
    }

    render(v) {
      const s = M.strings;
      const ok = !!(v && v.available);
      this.classList.toggle('is-soldout', !ok);
      const form = this.form;
      const idInput = form && form.querySelector('input[type="hidden"][name="id"]');
      if (idInput) {
        idInput.value = v ? v.id : '';
        idInput.disabled = !ok;
      }

      if (v) all('[data-price]', this).forEach((el) => M.updatePrice(el, v));
      const save = v && v.compare_at_price > v.price ? v.compare_at_price - v.price : 0;
      all('[data-save]', this).forEach((el) => {
        el.hidden = !save;
        const amount = el.querySelector('[data-save-amount]');
        if (amount && save) amount.textContent = M.formatMoney(save);
      });
      all('[data-badge="soldout"]', this).forEach((el) => { el.hidden = !v || ok; });
      all('[data-badge="sale"]', this).forEach((el) => { el.hidden = !save; });

      all('[data-stock]', this).forEach((el) => this.renderStock(el, v));

      all('[data-sku]', this).forEach((el) => {
        el.textContent = (v && v.sku) || '';
        if (el.parentElement) el.parentElement.hidden = !(v && v.sku);
      });

      all('[data-add-button]', this).forEach((btn) => {
        btn.disabled = !ok;
        const label = btn.querySelector('[data-add-label]');
        if (label) label.textContent = ok ? btn.dataset.labelAdd || s.addToCart : v ? s.soldOut : s.unavailable;
      });
      all('[data-buy-now]', this).forEach((btn) => { btn.hidden = !ok; });

      const qty = form && form.querySelector('.qty__input');
      if (qty) {
        if (v && v.stock > 0) {
          qty.max = v.stock;
          if (Number(qty.value) > v.stock) qty.value = v.stock;
        } else qty.removeAttribute('max');
        const stepper = qty.closest('quantity-input');
        if (stepper && stepper.sync) stepper.sync();
      }

      all('[data-sticky-variant]', this).forEach((el) => { if (v) el.textContent = v.title; });

      if (v && v.media) {
        const gallery = this.querySelector('product-gallery');
        if (gallery && gallery.showMedia) gallery.showMedia(v.media);
      }

      if (v && this.dataset.url) {
        history.replaceState(history.state, '', this.dataset.url + '?variant=' + v.id);
      }
      all('pickup-availability', this).forEach((el) => el.update && el.update(v));
      M.emit('variant:change', { sectionId: this.sectionId, variant: v });
    }

    renderStock(el, v) {
      const d = el.dataset;
      const threshold = Number(d.threshold) || 5;
      let state = 'na';
      let text = d.na;
      if (v && !v.available) { state = 'out'; text = d.out; }
      else if (v && v.stock > 0 && v.stock <= threshold) {
        state = 'low';
        text = v.stock === 1 ? d.lowOne : (d.low || '').replace('[count]', v.stock);
      } else if (v) { state = 'in'; text = d.in; }
      el.className = el.className.replace(/\bstock--\w+/, 'stock--' + state);
      const t = el.querySelector('[data-stock-text]');
      if (t) t.textContent = text || '';
    }
  }
  M.define('product-info', ProductInfo);

  /* <product-gallery> */
  class ProductGallery extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      this.slider = this.querySelector('carousel-slider');
      this.thumbs = all('[data-thumb]', this);
      this.thumbs.forEach((btn) => btn.addEventListener('click', () => this.show(Number(btn.dataset.thumb))));
      this.addEventListener('carousel:change', (e) => this.setActive(e.detail.index));

      const start = Number(this.dataset.start) || 0;
      if (start > 0) requestAnimationFrame(() => this.show(start, true));

      if (this.hasAttribute('data-zoom') && window.matchMedia && matchMedia('(hover: hover) and (min-width: 990px)').matches) {
        all('button.product-gallery__zoom', this).forEach((zone) => this.bindZoom(zone));
      }

      this.dialog = this.querySelector('[data-lightbox]');
      if (this.dialog && typeof this.dialog.showModal === 'function') {
        this.addEventListener('click', (e) => {
          const opener = e.target instanceof Element ? e.target.closest('[data-lightbox-open]') : null;
          if (opener) this.openLightbox(Number(opener.dataset.lightboxOpen), opener);
        });
        const close = this.dialog.querySelector('[data-lightbox-close]');
        if (close) close.addEventListener('click', () => this.dialog.close());
        this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
        this.dialog.addEventListener('close', () => {
          M.unlockScroll();
          if (this._opener) this._opener.focus({ preventScroll: true });
        });
      }
    }

    get slides() { return this.slider ? all('.carousel__slide', this.slider) : []; }

    show(index, instant) {
      const slides = this.slides;
      if (!slides[index] || !this.slider) return;
      if (instant && this.slider.track) this.slider.track.scrollLeft = slides[index].offsetLeft - slides[0].offsetLeft;
      else if (this.slider.goTo) this.slider.goTo(index);
      this.setActive(index);
    }

    showMedia(id) {
      const index = this.slides.findIndex((s) => String(s.dataset.mediaId) === String(id));
      if (index > -1) this.show(index);
    }

    setActive(index) {
      this.thumbs.forEach((btn, i) => {
        if (i === index) {
          btn.setAttribute('aria-current', 'true');
          const rail = btn.closest('.product-gallery__thumbs');
          if (rail) {
            const r = rail.getBoundingClientRect();
            const b = btn.getBoundingClientRect();
            if (b.top < r.top || b.bottom > r.bottom) rail.scrollTop += b.top - r.top - 8;
            if (b.left < r.left || b.right > r.right) rail.scrollLeft += b.left - r.left - 8;
          }
        } else btn.removeAttribute('aria-current');
      });
    }

    bindZoom(zone) {
      zone.addEventListener('mousemove', (e) => {
        const r = zone.getBoundingClientRect();
        zone.style.setProperty('--zoom-x', ((e.clientX - r.left) / r.width) * 100 + '%');
        zone.style.setProperty('--zoom-y', ((e.clientY - r.top) / r.height) * 100 + '%');
        zone.classList.add('is-zooming');
      });
      zone.addEventListener('mouseleave', () => zone.classList.remove('is-zooming'));
    }

    openLightbox(index, opener) {
      this._opener = opener || null;
      this.dialog.showModal();
      M.lockScroll();
      const item = this.dialog.querySelector('[data-lightbox-item="' + index + '"]');
      requestAnimationFrame(() => {
        if (item) this.dialog.scrollTop = item.offsetTop - 64;
      });
    }
  }
  M.define('product-gallery', ProductGallery);

  /* <sticky-atc> */
  class StickyAtc extends HTMLElement {
    // Scroll check (not IntersectionObserver): a jump past the buttons must still show the bar.
    connectedCallback() {
      if (this._ready) return;
      const target = doc.getElementById(this.dataset.target);
      if (!target) return;
      this._ready = true;
      let raf = 0;
      const check = () => {
        raf = 0;
        this.toggle(target.getBoundingClientRect().bottom < 0);
      };
      this._onScroll = () => { if (!raf) raf = requestAnimationFrame(check); };
      window.addEventListener('scroll', this._onScroll, { passive: true });
      check();
    }

    disconnectedCallback() {
      window.removeEventListener('scroll', this._onScroll);
      this.toggle(false);
    }

    toggle(show) {
      if (show === !!this._shown) return;
      this._shown = show;
      this.classList.toggle('is-visible', show);
      this.setAttribute('aria-hidden', String(!show));
      if (show) this.removeAttribute('inert');
      else this.setAttribute('inert', '');
      const offset = show ? this.offsetHeight + 'px' : '0px';
      doc.documentElement.style.setProperty('--bottom-offset', offset);
    }
  }
  M.define('sticky-atc', StickyAtc);

  /* <delivery-estimate> */
  class DeliveryEstimate extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      this.render();
      if (Number(this.dataset.cutoff) > 0) this._timer = setInterval(() => this.render(), 60000);
    }

    disconnectedCallback() { clearInterval(this._timer); }

    render() {
      const d = this.dataset;
      const days = (d.days || '').split(',');
      const months = (d.months || '').split(',');
      const skipSunday = d.skipSunday === 'true';
      const cutoff = Number(d.cutoff) || 0;
      const now = new Date();
      const start = new Date(now);
      let left = 0;
      if (cutoff > 0) {
        const cut = new Date(now);
        cut.setHours(cutoff, 0, 0, 0);
        const dispatchToday = now < cut && !(skipSunday && now.getDay() === 0);
        if (dispatchToday) left = Math.ceil((cut - now) / 60000);
        else start.setDate(start.getDate() + 1);
      }
      const addDays = (n) => {
        const x = new Date(start);
        let count = n;
        while (count > 0) {
          x.setDate(x.getDate() + 1);
          if (!(skipSunday && x.getDay() === 0)) count--;
        }
        if (skipSunday && x.getDay() === 0) x.setDate(x.getDate() + 1);
        return x;
      };
      const isToday = (x) => x.toDateString() === now.toDateString();
      const label = (x, withMonth) =>
        isToday(x) ? d.today || '' : days[x.getDay()] + ' ' + x.getDate() + (withMonth ? ' ' + months[x.getMonth()] : '');

      all('[data-range]', this).forEach((el) => {
        const parts = el.dataset.range.split('-').map(Number);
        const a = addDays(parts[0]);
        const b = addDays(parts[1]);
        if (a.toDateString() === b.toDateString()) el.textContent = label(b, true);
        else el.textContent = label(a, a.getMonth() !== b.getMonth()) + ' – ' + label(b, true);
      });

      const box = this.querySelector('[data-countdown]');
      if (!box) return;
      box.hidden = left <= 0;
      if (left <= 0) return;
      const h = Math.floor(left / 60);
      const m = left % 60;
      const time = h > 0
        ? (d.time || '[h] h [m] min').replace('[h]', h).replace('[m]', m)
        : (d.minutes || '[m] min').replace('[m]', m);
      const text = box.querySelector('[data-countdown-text]');
      if (text) text.textContent = (box.dataset.template || '').replace('[time]', time);
    }
  }
  M.define('delivery-estimate', DeliveryEstimate);

  /* <pickup-availability>: injects sections/pickup-availability.liquid */
  class PickupAvailability extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      if (this.dataset.variantId) this.load(this.dataset.variantId);
    }

    update(v) {
      if (!v || !v.available) { this.set(''); return; }
      this.load(v.id);
    }

    load(id) {
      const url = this.dataset.url + '?variant=' + encodeURIComponent(id) + '&section_id=pickup-availability';
      fetch(url)
        .then((r) => (r.ok ? r.text() : ''))
        .then((html) => {
          const fresh = html ? M.parseHTML(html).querySelector('.pickup') : null;
          this.set(fresh ? fresh.outerHTML : '');
        })
        .catch(() => this.set(''));
    }

    /* The drawer goes to <body>: the sticky info column would trap its z-index. */
    set(html) {
      const old = doc.getElementById('PickupDrawer');
      if (old) old.remove();
      this.innerHTML = html;
      const drawer = this.querySelector('side-drawer');
      if (drawer) doc.body.appendChild(drawer);
    }
  }
  M.define('pickup-availability', PickupAvailability);

  /* <share-button> */
  class ShareButton extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      const btn = this.querySelector('button');
      if (!btn) return;
      this._ready = true;
      btn.addEventListener('click', () => this.share());
    }

    share() {
      const url = this.dataset.url || location.href;
      const title = this.dataset.title || doc.title;
      if (navigator.share) {
        navigator.share({ title, url }).catch(() => {});
        return;
      }
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(url).then(() => {
        const msg = this.querySelector('[data-share-msg]');
        if (!msg) return;
        msg.hidden = false;
        clearTimeout(this._t);
        this._t = setTimeout(() => { msg.hidden = true; }, 2500);
      }).catch(() => {});
    }
  }
  M.define('share-button', ShareButton);

})();
