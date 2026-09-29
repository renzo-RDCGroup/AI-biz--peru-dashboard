/* Mi Bici 2026 — carousel.js
   <carousel-slider class="carousel" [data-autoplay="6"] [data-loop]>
     .carousel__track > .carousel__slide …
     optional: .carousel__prev / .carousel__next buttons, .carousel__dots (filled by JS),
               .carousel__controls (hosts the auto-inserted pause button), .carousel__pause
   Native scroll-snap does the swiping; this adds paging, dots, keyboard and autoplay. */
(function () {
  'use strict';

  const strings = () => (window.MiBici && window.MiBici.strings) || {};
  const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ICONS = {
    pause: '<path d="M9 5.5v13m6-13v13"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  };
  const svg = (name) =>
    '<svg class="icon icon--' + name + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICONS[name] + '</svg>';

  class CarouselSlider extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this.track = this.querySelector('.carousel__track');
      if (!this.track) return;
      this._ready = true;

      this.prevBtn = this.own('.carousel__prev');
      this.nextBtn = this.own('.carousel__next');
      this.dotsEl = this.own('.carousel__dots');
      this.controlsEl = this.own('.carousel__controls');
      this.loop = this.hasAttribute('data-loop');
      this.autoplayMs = (parseFloat(this.getAttribute('data-autoplay')) || 0) * 1000;
      this.page = 0;

      if (!this.hasAttribute('role')) this.setAttribute('role', 'region');
      if (!this.hasAttribute('aria-roledescription')) this.setAttribute('aria-roledescription', strings().carouselLabel || 'carrusel');

      this._onScroll = () => {
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => {
          this._raf = null;
          this.update();
        });
      };
      this.track.addEventListener('scroll', this._onScroll, { passive: true });
      if (this.prevBtn) this.prevBtn.addEventListener('click', () => { this.prev(); this.userStop(); });
      if (this.nextBtn) this.nextBtn.addEventListener('click', () => { this.next(); this.userStop(); });
      this.addEventListener('keydown', (e) => this.onKey(e));
      this.addEventListener('shopify:block:select', (e) => this.onBlockSelect(e));
      this.addEventListener('shopify:block:deselect', () => { this._editorHold = false; this.start(); });

      if ('ResizeObserver' in window) {
        this._ro = new ResizeObserver(() => this.refresh());
        this._ro.observe(this.track);
      } else {
        this._onResize = () => this.refresh();
        window.addEventListener('resize', this._onResize);
      }
      this.refresh();
      if (this.autoplayMs > 0 && !reducedMotion()) this.setupAutoplay();
    }

    disconnectedCallback() {
      this.stop();
      if (this._ro) this._ro.disconnect();
      if (this._io) this._io.disconnect();
      if (this._onResize) window.removeEventListener('resize', this._onResize);
      if (this._onVisibility) document.removeEventListener('visibilitychange', this._onVisibility);
    }

    /* Element lookup that ignores nested carousels. */
    own(selector) {
      return Array.from(this.querySelectorAll(selector)).find((el) => el.closest('carousel-slider') === this) || null;
    }

    get slides() {
      return Array.from(this.track.children).filter((el) => !el.hidden && el.offsetParent !== null);
    }

    metrics() {
      const slides = this.slides;
      const t = this.track;
      const max = Math.max(0, t.scrollWidth - t.clientWidth);
      let step = t.clientWidth || 1;
      if (slides.length > 1) step = slides[1].offsetLeft - slides[0].offsetLeft || step;
      else if (slides[0]) step = slides[0].offsetWidth || step;
      const perView = Math.max(1, Math.floor((t.clientWidth + 2) / step));
      const pageWidth = perView * step;
      const pages = max > 2 ? Math.ceil(max / pageWidth - 0.05) + 1 : 1;
      return { slides, max, step, perView, pageWidth, pages };
    }

    currentPage(m) {
      const x = this.track.scrollLeft;
      if (x >= m.max - 2) return m.pages - 1;
      return Math.min(m.pages - 1, Math.round(x / m.pageWidth));
    }

    scrollToX(left) {
      this.track.scrollTo({ left: Math.max(0, left), behavior: reducedMotion() ? 'auto' : 'smooth' });
    }

    goToPage(page) {
      const m = this.metrics();
      const p = Math.max(0, Math.min(m.pages - 1, page));
      this.scrollToX(Math.min(p * m.pageWidth, m.max));
    }

    goTo(index) {
      const m = this.metrics();
      const slide = m.slides[index];
      if (!slide || !m.slides[0]) return;
      this.scrollToX(Math.min(slide.offsetLeft - m.slides[0].offsetLeft, m.max));
    }

    next(wrap) {
      const m = this.metrics();
      const p = this.currentPage(m);
      if (p >= m.pages - 1) {
        if (this.loop || wrap) this.goToPage(0);
        return;
      }
      this.goToPage(p + 1);
    }

    prev() {
      const m = this.metrics();
      const p = this.currentPage(m);
      if (p <= 0) {
        if (this.loop) this.goToPage(m.pages - 1);
        return;
      }
      this.goToPage(p - 1);
    }

    refresh() {
      const m = this.metrics();
      const s = strings();
      this.buildDots(m.pages);
      const scrollable = m.pages > 1;
      this.classList.toggle('is-scrollable', scrollable);
      if (this.controlsEl) this.controlsEl.hidden = !scrollable;
      [this.prevBtn, this.nextBtn].forEach((btn) => {
        if (btn && (!this.controlsEl || !this.controlsEl.contains(btn))) btn.hidden = !scrollable;
      });
      m.slides.forEach((slide, i) => {
        if (slide.hasAttribute('aria-label') || slide.hasAttribute('aria-labelledby')) return;
        slide.setAttribute('role', 'group');
        slide.setAttribute('aria-roledescription', s.carouselSlideLabel || 'diapositiva');
        slide.setAttribute('aria-label', (s.carouselSlide || '[index] / [total]').replace('[index]', i + 1).replace('[total]', m.slides.length));
      });
      this.update();
    }

    buildDots(pages) {
      if (!this.dotsEl || this._dotCount === pages) return;
      this._dotCount = pages;
      this.dotsEl.innerHTML = '';
      this.dotsEl.hidden = pages < 2;
      if (pages < 2) return;
      const label = strings().carouselGoTo || '[index]';
      for (let i = 0; i < pages; i++) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'carousel__dot';
        dot.setAttribute('aria-label', label.replace('[index]', i + 1));
        dot.addEventListener('click', () => { this.goToPage(i); this.userStop(); });
        this.dotsEl.appendChild(dot);
      }
    }

    update() {
      const m = this.metrics();
      const page = this.currentPage(m);
      const active = Math.min(m.slides.length - 1, Math.round(this.track.scrollLeft / m.step));
      m.slides.forEach((slide, i) => slide.classList.toggle('is-active', i >= active && i < active + m.perView));
      if (this.dotsEl) {
        Array.from(this.dotsEl.children).forEach((dot, i) => {
          if (i === page) dot.setAttribute('aria-current', 'true');
          else dot.removeAttribute('aria-current');
        });
      }
      if (!this.loop) {
        if (this.prevBtn) this.prevBtn.setAttribute('aria-disabled', String(page <= 0));
        if (this.nextBtn) this.nextBtn.setAttribute('aria-disabled', String(page >= m.pages - 1));
      }
      if (page !== this.page) {
        this.page = page;
        this.dispatchEvent(new CustomEvent('carousel:change', { bubbles: true, detail: { page, index: active } }));
      }
    }

    onKey(e) {
      const t = e.target;
      const own = t === this.track || t === this.prevBtn || t === this.nextBtn || (this.dotsEl && this.dotsEl.contains(t));
      if (!own) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); this.next(); this.userStop(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.prev(); this.userStop(); }
    }

    onBlockSelect(e) {
      const slide = e.target instanceof Element ? e.target.closest('.carousel__slide') : null;
      const index = slide ? this.slides.indexOf(slide) : -1;
      this._editorHold = true;
      this.stop();
      if (index > -1) this.goTo(index);
    }

    /* ---------- Autoplay (never under reduced motion) ------------------ */
    setupAutoplay() {
      let btn = this.own('.carousel__pause');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'carousel__pause btn btn--icon btn--sm btn--outline';
        (this.controlsEl || this).appendChild(btn);
      }
      this.pauseBtn = btn;
      btn.addEventListener('click', () => {
        this.userPaused = !this.userPaused;
        if (this.userPaused) this.stop();
        else this.start();
        this.renderPause();
      });

      this.addEventListener('mouseenter', () => { this._hover = true; this.stop(); });
      this.addEventListener('mouseleave', () => { this._hover = false; this.start(); });
      this.addEventListener('focusin', () => { this._focus = true; this.stop(); });
      this.addEventListener('focusout', (e) => {
        if (e.relatedTarget && this.contains(e.relatedTarget)) return;
        this._focus = false;
        this.start();
      });
      this.addEventListener('touchstart', () => this.userStop(), { passive: true });

      if ('IntersectionObserver' in window) {
        this._io = new IntersectionObserver((entries) => {
          this._offscreen = !entries[0].isIntersecting;
          if (this._offscreen) this.stop();
          else this.start();
        });
        this._io.observe(this);
      }
      this._onVisibility = () => (document.hidden ? this.stop() : this.start());
      document.addEventListener('visibilitychange', this._onVisibility);

      this.renderPause();
      this.start();
    }

    renderPause() {
      if (!this.pauseBtn) return;
      const s = strings();
      const paused = !!this.userPaused;
      this.pauseBtn.innerHTML = svg(paused ? 'play' : 'pause');
      this.pauseBtn.setAttribute('aria-label', paused ? s.carouselPlay || 'Play' : s.carouselPause || 'Pause');
    }

    /* A deliberate interaction (arrows, dots, swipe) stops autoplay for good. */
    userStop() {
      if (!this.autoplayMs || this.userPaused) return;
      this.userPaused = true;
      this.stop();
      this.renderPause();
    }

    start() {
      this.stop();
      if (!this.autoplayMs || reducedMotion() || this.userPaused || this._hover || this._focus || this._offscreen || this._editorHold || document.hidden) return;
      if (this.metrics().pages < 2) return;
      this._timer = setInterval(() => this.next(true), this.autoplayMs);
    }

    stop() {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  if (window.customElements && !customElements.get('carousel-slider')) {
    customElements.define('carousel-slider', CarouselSlider);
  }
  if (window.MiBici) window.MiBici.CarouselSlider = CarouselSlider;
})();
