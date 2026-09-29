/* Mi Bici 2026 — announcement-bar.js
   <announcement-bar>: seamless marquee (adds aria-hidden, untabbable copies until the screen is
   covered, slides by exactly one copy; pause button; CSS pauses on hover/focus; keyboard focus
   parks the track and scrolls the focused link into view) or one message
   at a time (prev/next; any interaction stops the rotation; never auto-rotates under reduced
   motion). Discount-code chips copy to the clipboard with "¡Copiado!" feedback. */
(function () {
  'use strict';

  const M = window.MiBici || {};
  const doc = document;
  const define = (name, ctor) => {
    if (window.customElements && !customElements.get(name)) customElements.define(name, ctor);
  };
  const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const announce = (text) => { if (M.announce) M.announce(text); };

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
      const area = doc.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      doc.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
      area.remove();
      if (ok) resolve(); else reject(new Error('copy'));
    });
  }

  /* ---------- <announcement-bar> ------------------------------------------- */
  class AnnouncementBar extends HTMLElement {
    connectedCallback() {
      this.track = this.querySelector('[data-track]');
      this.viewport = this.querySelector('.announcement__viewport');
      this.rotate = this.dataset.mode === 'rotate';
      if (!this._bound) {
        // Listeners on the element itself / its children: bound once.
        this._bound = true;
        this.addEventListener('click', (e) => {
          const chip = e.target instanceof Element ? e.target.closest('[data-copy-code]') : null;
          if (chip) this.copy(chip);
        });
        if (this.rotate) this.bindRotate();
        else this.bindMarquee();
      }
      // Timers / observers: started per connection, stopped on disconnect.
      if (this.rotate) this.play();
      else this.observe();
      this.classList.add('is-ready');
    }

    disconnectedCallback() {
      this.stop();
      if (this._ro) this._ro.disconnect();
      if (this._onResize) window.removeEventListener('resize', this._onResize);
    }

    copy(chip) {
      const code = chip.getAttribute('data-copy-code') || '';
      copyText(code).then(() => {
        chip.classList.add('is-copied');
        announce((M.strings && M.strings.copied) || '');
        clearTimeout(chip._timer);
        chip._timer = setTimeout(() => chip.classList.remove('is-copied'), 1800);
      }).catch(() => {});
    }

    /* Marquee ------------------------------------------------------------- */
    bindMarquee() {
      const pause = this.querySelector('[data-announcement-pause]');
      if (pause) pause.addEventListener('click', () => this.setPaused(!this.classList.contains('is-paused')));
      // Keyboard focus: CSS parks the track at 0 and drops the edge masks (:has(:focus-visible));
      // scroll the focused link or chip fully into view with room for its ring (start first if it
      // is wider than the bar). Back to 0 when focus leaves so the loop stays seamless.
      // Mouse/touch focus (not :focus-visible) never moves anything.
      const vp = this.viewport;
      if (!vp) return;
      vp.addEventListener('focusin', (e) => {
        const t = e.target;
        let visible = false;
        try { visible = t instanceof Element && t.matches(':focus-visible'); } catch (err) { visible = false; }
        if (!visible) return;
        requestAnimationFrame(() => {
          const r = t.getBoundingClientRect();
          const b = vp.getBoundingClientRect();
          const m = 8;
          if (r.left < b.left + m || r.width > b.width - 2 * m) vp.scrollLeft += r.left - b.left - m;
          else if (r.right > b.right - m) vp.scrollLeft += r.right - b.right + m;
        });
      });
      vp.addEventListener('focusout', (e) => {
        if (!reducedMotion() && !vp.contains(e.relatedTarget)) vp.scrollLeft = 0;
      });
    }

    observe() {
      if (!this.track || !this.viewport) return;
      const schedule = () => {
        cancelAnimationFrame(this._raf);
        this._raf = requestAnimationFrame(() => this.fill());
      };
      if ('ResizeObserver' in window) {
        this._ro = new ResizeObserver(schedule);
        this._ro.observe(this.viewport);
      } else {
        this._onResize = schedule;
        window.addEventListener('resize', schedule);
      }
      if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(schedule);
      this.fill();
    }

    // Enough copies that sliding by one copy never reveals a gap: N ≥ 1 + viewport / copy.
    fill() {
      const lists = this.track.querySelectorAll('[data-list]');
      const first = lists[0];
      if (!first) return;
      const width = first.getBoundingClientRect().width;
      if (!width) return;
      const needed = Math.ceil(this.viewport.clientWidth / width) + 1;
      for (let i = lists.length; i < needed && i < 12; i++) {
        const clone = first.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        clone.setAttribute('data-clone', '');
        clone.querySelectorAll('[data-shopify-editor-block]').forEach((el) => el.removeAttribute('data-shopify-editor-block'));
        clone.querySelectorAll('a, button').forEach((el) => el.setAttribute('tabindex', '-1'));
        this.track.appendChild(clone);
      }
      this.style.setProperty('--marquee-shift', width.toFixed(2) + 'px');
    }

    setPaused(paused) {
      this.classList.toggle('is-paused', paused);
      const btn = this.querySelector('[data-announcement-pause]');
      if (btn) btn.setAttribute('aria-pressed', String(paused));
    }

    /* Rotate -------------------------------------------------------------- */
    bindRotate() {
      this.items = Array.from(this.querySelectorAll('[data-list]:not([data-clone]) > .announcement__item'));
      this.index = 0;
      this.show(0);
      if (this.items.length < 2) return;
      const prev = this.querySelector('[data-announcement-prev]');
      const next = this.querySelector('[data-announcement-next]');
      // Any deliberate interaction stops the rotation for good (like the carousels).
      if (prev) prev.addEventListener('click', () => { this.stopped = true; this.stop(); this.show(this.index - 1); });
      if (next) next.addEventListener('click', () => { this.stopped = true; this.stop(); this.show(this.index + 1); });
      this.addEventListener('touchstart', () => { this.stopped = true; this.stop(); }, { passive: true });
      ['mouseenter', 'focusin'].forEach((t) => this.addEventListener(t, () => { this._hold = true; }));
      this.addEventListener('mouseleave', () => { this._hold = this.contains(doc.activeElement); });
      this.addEventListener('focusout', (e) => { if (!this.contains(e.relatedTarget)) this._hold = false; });
    }

    play() {
      this.stop();
      if (this.stopped || !this.items || this.items.length < 2 || reducedMotion()) return;
      const seconds = Math.max(3, parseInt(this.dataset.interval, 10) || 5);
      this._timer = setInterval(() => {
        if (!this._hold && !doc.hidden) this.show(this.index + 1);
      }, seconds * 1000);
    }

    stop() { clearInterval(this._timer); this._timer = null; }

    show(i) {
      if (!this.items || !this.items.length) return;
      const n = this.items.length;
      this.index = ((i % n) + n) % n;
      this.items.forEach((el, k) => el.classList.toggle('is-active', k === this.index));
    }

    // Theme editor: show and hold the selected block; resume when it is deselected.
    select(block, selected) {
      if (this.rotate) {
        if (!selected) { this.play(); return; }
        this.stop();
        const i = this.items ? this.items.indexOf(block) : -1;
        if (i > -1) this.show(i);
      } else {
        this.setPaused(selected);
      }
    }
  }
  define('announcement-bar', AnnouncementBar);

  ['shopify:block:select', 'shopify:block:deselect'].forEach((type) => {
    doc.addEventListener(type, (e) => {
      const bar = e.target instanceof Element ? e.target.closest('announcement-bar') : null;
      if (bar && bar.select) bar.select(e.target, type === 'shopify:block:select');
    });
  });

})();
