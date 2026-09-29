# Foundation notes: read this before building a section

This is what Foundation (F) actually ships. It follows SPEC.md §6. Anything that differs from the spec is listed in §0.
Foundation files are read-only for everyone else. If you need a change, put it in your report.

## 0. Deviations from SPEC.md (read these first)

| What | Detail |
|---|---|
| **JS split in two** | Everything in one file would pass the 16 KiB limit. `assets/global.js` holds the core API (utils, focus trap, scroll lock, price helpers, cart API and events, delegated triggers). `assets/global-ui.js` holds the custom elements `side-drawer`, `quantity-input` and `product-form`, plus reveal and `--header-height`. Both load with `defer` in `<head>` in this order: global.js → global-ui.js → carousel.js. |
| **CSS split in two** | `components.css` covers buttons, spinner, forms, badges, chips, price, rating, swatch and qty. `components-ui.css` covers section heading, breadcrumbs, pagination, social/payment icons, drawer, modal, accordion, carousel, free-shipping bar and WhatsApp. Both are always loaded. |
| **Extra F files** | `snippets/css-variables.liquid` prints the settings-driven `:root` tokens and is used by both layouts. `assets/favicon.svg` is the default favicon: the "mi" mark on yellow. |
| `MiBici.strings.freeShippingRemaining` | Contains HTML, e.g. `¡Te faltan <strong>[amount]</strong> para el envío gratis!`. Set it with `innerHTML`. The value in `[amount]` is formatted money, so it is safe. |
| Free-shipping `--progress` | Lives on `.free-ship__track`, not on `.free-ship__fill`, so the fill and the marker share it. |
| Heading dot | Implemented as a red "." glyph (`::after { content: "." }`) so it never wraps onto its own line. `section-heading` skips it when the title ends in `. ? ! : …`. |
| Product card sale | The image badge shows the red **"-NN%"** (best variant). The card's price row is rendered with `show_save: false` (sale price + struck compare price, no pill) so 2-column mobile cards never wrap the price. `product-badges` also accepts `sale_label: true` ("Oferta") for other callers. |
| Product card vendor | Not printed when `product.vendor == shop.name` (many products have vendor "Mi Bicicleta"), but an **empty line is kept** while `card_show_vendor` is on, so titles and prices align across a grid row. |
| `.badge--soldout` | White with a 1px border and ink text (SPEC: surface-2/muted), so "Agotado" stays visible on the grey image tiles. |
| Product without images | `product-card` shows a faint "mi" mark on the surface tile instead of a generic placeholder illustration. Onboarding cards (`product: blank`) still use `placeholder_svg_tag`. |
| Disabled buttons | Filled buttons (`.btn`, `--primary`, `--accent`, `--brand`, `--ink`, `--whatsapp`) turn into a quiet neutral pill (8% of the scheme fg on the scheme bg, muted text) instead of a half-transparent colour. `--outline`, `--ghost` and `--link` fade to 35% (carousel arrows at either end). |
| Reduced motion | Under `prefers-reduced-motion: reduce` **all transitions are 0s** (and animations end immediately). `transitionend` does NOT fire then, so never wait for it; drive state from your own code. |
| Form controls | `.input`, `.textarea` and `.select select` use `--color-border-strong` (#8A8A82, ≥3:1 on white, WCAG 1.4.11). Hover/focus darken to ink. |
| Breadcrumbs | Inline text flow (not flex): long product titles wrap like text and never widen a parent grid/flex column. |
| Quick add | Only when `product.variants.size == 1` and the product is available. |
| `quantity-input` buttons | Use `data-qty="minus|plus"`. Limits are shown with `aria-disabled="true"` rather than `disabled`, so keyboard focus stays on the button. |
| Delivery ranges | `delivery_prov_min` and `delivery_prov_max` are range 0–15. Lima stays 0–10. |
| Cart events | `MiBici.cart.add()` itself dispatches `cart:updated`. `<product-form>` only dispatches `cart:open` afterwards, so you never get a double `cart:updated`. |
| Announcements | global.js already announces cart updates in `#A11yLive`: "Carrito actualizado. N productos" after change/update, and "¡Listo! Lo agregamos…" after add. **Do not announce again** in cart.js. |
| Password layout | Loads base, components and components-ui CSS plus fonts. No product-card.css and no JS. |
| **List reset has zero specificity** | `:where(ul[role="list"], ol[role="list"]) { list-style:none; margin:0; padding:0 }`. Any class you put on a list (`.chip-row--bleed`, `.chip-row`'s 4px block padding, your own margins) now wins. Local workarounds with raised specificity (`ul.x`) are no longer needed. |
| **Carousel slide semantics** | Slides inside a `<ul>/<ol>/[role=list]` track keep native list semantics (no `role=group`: axe `aria-required-children`). Only non-list slides (e.g. `<div class="carousel__track"><div class="carousel__slide">`) get `role=group` + "diapositiva" + "n de N". Use divs when you want the APG slide pattern (the hero). |
| **Carousel autoplay + touch** | Hover-pause listens to mouse pointers only (`pointerenter/leave`), and a touch on the pause button is left to its click, so one tap pauses (label "Reproducir carrusel"). |
| **Carousel track with product cards** | `.carousel__track:has(.product-card)` gets `padding: 6px; margin: -6px` so the card focus ring isn't clipped by the scroller. Slide widths are unchanged; `.carousel--bleed` still wins inline below 990. |
| **Overlay arrows at the ends** | `.carousel--arrows-overlay` prev/next with `aria-disabled="true"` are hidden (opacity 0, visibility hidden) unless keyboard-focused (then they stay at 35%, so focus is never lost). |
| **`cart:updated` after add** | `MiBici.cart.add()` no longer waits for `GET /cart.js` when a returned section exposes the totals: **C** puts `data-cart-item-count="{{ cart.item_count }}" data-cart-total-price="{{ cart.total_price }}"` on `.cart-drawer__inner` / `.main-cart__inner`. Then `detail.cart` is **partial**: `{item_count, total_price, partial: true}`. Otherwise it falls back to `/cart.js` (full cart). Read only `item_count`/`total_price` from an `add` event. Do **not** name it `data-cart-count`: that selector is the header badge that `updateCartCount` overwrites. |
| **Network errors** | `fetchJSON` turns a failed `fetch()` (offline, dropped connection) into `Error(MiBici.strings.networkError)` with `.status = 0`, `.network = true` ("No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo."). `AbortError` is re-thrown untouched. HTTP errors are unchanged. |
| **Free-shipping bar, empty cart** | With total 0 the bar (Liquid and JS) reads "**Envío gratis** desde S/ 220." (`shipping.intro_html`, `MiBici.strings.freeShippingIntro`) instead of "¡Te faltan S/ 220.00…!". |
| **Web fonts don't block rendering** | Google Fonts (and the Adobe kit) load via `<link rel="preload" as="style" onload="this.rel='stylesheet'">` + `<noscript>`. Until they arrive, `--font-heading` / `--font-body` fall to metric-matched Arial faces (`'Urbanist Fallback'`, `'Libre Franklin Fallback'`, `size-adjust` etc. in css-variables), so lines don't reflow on swap. Theme Check reports AssetPreload warnings for these two links; they are intentional. |
| **Product card** | Multi-variant cards: the "Elegir opciones" link is a **white** round button with an `arrow-right` icon (it navigates), so it no longer looks like the yellow `bag-plus` add. The hover image is `display:none` outside `(hover:hover) and (min-width:990px)`, so phones never download it. |
| **Quantity** | `.qty--sm` buttons have an invisible 44×44 hit area (`::after`). Without JS the ± buttons are hidden and the number field widens to 4em. |
| **payment-icons `scope`** | `{% render 'payment-icons', scope: 'cart' %}` rewrites Shopify's fixed `pi-*` ids (title id, `aria-labelledby`, `url(#…)`) to `pi-cart-*`. Use it for the second copy on a page (cart summary; the footer has none). |
| **WhatsApp** | Prefilled text uses `%20` for spaces (`url_encode \| replace: '+', '%20'`). The number drops a leading `00`, and a bare 9-digit mobile starting with 9 gets `51` (snippet and `MiBici.settings.whatsapp`). |
| **Price labels** | The visually-hidden "Precio de oferta" / "Precio habitual" spans carry their own spaces (Liquid and `priceHTML`). |
| **Forced colors** | `@media (forced-colors: active)`: swatches keep their colours, active chips/tabs and the active carousel dot use `Highlight`, the free-shipping fill is `Highlight`. Selected variant pills/swatches are P's (section CSS). |
| **Theme editor** | global-ui.js opens the `<details>` a selected block is or contains (FAQ, product collapsible rows, mobile footer columns) and closes it on deselect only if it opened it (`data-editor-opened`). |
| **Tokens / misc** | `--color-success-strong` (#146C32) for text on the #E8F5EC success tint (`.form-message--success` uses it). The focused skip link is a yellow pill. `cart_checkout_note` defaults to "El envío se calcula en el checkout." (the "Impuestos incluidos." line is C's, shown only when `cart.taxes_included`). `general.collections` is "Categorías". |
| Additions (no conflict) | `.scheme-cream` (pale-yellow band, not a section option); vars `--scheme-surface`, `--scheme-sale`, `--scheme-focus`, `--media-bg`, `--color-border-strong`; `.btn--ghost`, `.btn--whatsapp`; `.chip-row--bleed`, `.carousel--bleed`, `.carousel--arrows-overlay`; `.accordion--card`; `.eyebrow--dot`; `.flow`, `.cluster`, `.page-width--narrow`; `MiBici.priceHTML/updatePrice/updateCartCount/updateFreeShipping/initReveal/measureHeader/getFocusable/emit/define/reducedMotion`; `MiBici.SideDrawer` (class, for extending). |

## 1. Load order and globals (layout/theme.liquid)

```
<head>  meta-tags · Google Fonts (Urbanist 700-900, Libre Franklin 400-700) or Adobe kit
        css-variables · base.css · components.css · components-ui.css · product-card.css
        inline MiBici config → global.js → global-ui.js → carousel.js (all defer)
<body class="template-{name} [template-{suffix}] [has-heading-dot]">
        skip link → #MainContent · {% sections 'header-group' %} · <main id="MainContent">
        {% sections 'footer-group' %} · {% section 'cart-drawer' %} (only when cart_type == drawer)
        {% render 'whatsapp-button', style: 'float' %} · #A11yLive · JSON-LD Organization + WebSite (index)
```

Section CSS/JS is yours. Load it from your section with `{{ 'x.css' | asset_url | stylesheet_tag }}` or `<script src="{{ 'x.js' | asset_url }}" defer></script>`. Your deferred scripts run after global*.js, so `window.MiBici` and `MiBici.SideDrawer` already exist.

`window.MiBici` config:
```js
MiBici.routes   = { root, cart, cart_add, cart_change, cart_update, predictive_search, search,
                    product_recommendations, all_products }      // no ".js" suffix (e.g. "/cart/add")
MiBici.moneyFormat = "S/ {{amount}}"
MiBici.settings = { cartType: 'drawer'|'page', freeShippingThreshold: 22000 /* cents */,
                    freeShippingZone: 'todo el Perú', whatsapp: '<digits or "">',
                    predictiveSearch: true, designMode: false }
MiBici.strings  = { addToCart, soldOut, unavailable, adding, added, cartError, cartUpdated,
                    itemsOne "[count] producto", itemsOther "[count] productos", priceSale, priceRegular,
                    networkError, freeShippingRemaining (HTML, "[amount]"), freeShippingReached (HTML),
                    freeShippingIntro (HTML, empty cart), freeShippingZone,
                    close, loading, copied, decrease, increase, newWindow,
                    carouselPrev, carouselNext, carouselPause, carouselPlay, carouselGoTo "[index]",
                    carouselSlide "[index] de [total]", carouselLabel, carouselSlideLabel }
```

## 2. Tokens (CSS custom properties)

**Settings-driven** (css-variables.liquid): `--color-brand` (#FFD219), `--color-brand-soft`, `--color-ink`, `--color-accent` (#FF0000, decorative only), `--color-sale` (#D10000), `--font-heading`, `--font-body`, `--fw-heading` (800, or 700 with the Adobe kit), `--fw-display` (900/700), `--body-scale`, `--radius-sm/--radius/--radius-lg/--radius-card/--radius-pill` (rounded 8/14/22/16/999 · soft 4/7/11/8/999 · square 0/0/0/0/4), `--logo-width`, `--logo-width-mobile`.

**Static** (base.css): `--color-brand-strong` (yellow hover), `--color-bg`, `--color-surface` (#F5F5F2), `--color-surface-2`, `--color-border`, `--color-border-strong` (form controls), `--color-muted`, `--color-success`, `--color-warning`, `--color-whatsapp`; `--fs-xs … --fs-xl`, `--fs-2xl` (h2), `--fs-3xl` (h1), `--fs-display`; `--space-1 … --space-10` (4 8 12 16 20 24 32 40 56 72); `--shadow-sm/md/lg`; `--page-width` 1320px; `--gutter` 16/24/32; `--grid-gap` 12/24; `--ease`, `--dur` 220ms, `--dur-fast` 150ms.

**JS-maintained**: `--header-height` is the height of `[data-header]` (**H: put `data-header` on your sticky header element**; fallback is the first `<header>`). `--header-group-height` is the sum of all header-group sections. `html { scroll-padding-top }` uses `--header-height`. Sticky offsets: `top: var(--header-height)`.

`--bottom-offset` (default 0) lifts the WhatsApp float. **P**: while the sticky add-to-cart bar is visible, set `document.documentElement.style.setProperty('--bottom-offset', bar.offsetHeight + 'px')`.

Breakpoints are min-width only: `750px`, `990px`, `1200px`. Use `max-width: 749.98px` / `989.98px` when you really need a max.

## 3. Color schemes

Every section needs a `scheme` select (`light|soft|brand|dark`) and adds `class="scheme-{{ section.settings.scheme }}"` to its outer element. That class paints `background` and `color`. Read only these variables:

| var | light | soft | brand | dark |
|---|---|---|---|---|
| `--scheme-bg` / `--scheme-fg` | #fff / ink | surface / ink | yellow / #000 | ink / #fff |
| `--scheme-muted` | #5C5C56 | #5C5C56 | rgba(0,0,0,.72) | rgba(255,255,255,.72) |
| `--scheme-border` | #E2E2DC | #E2E2DC | rgba(0,0,0,.14) | rgba(255,255,255,.16) |
| `--scheme-surface` (cards/boxes) | surface | #fff | #fff | rgba(255,255,255,.08) |
| `--scheme-btn-bg/-fg` (.btn--primary) | ink/#fff | ink/#fff | #000/#fff | yellow/#000 |
| `--scheme-accent-bg/-fg` (.btn--accent) | yellow/#000 | yellow/#000 | #000/yellow | yellow/#000 |
| `--scheme-sale` (sale text) | #D10000 | #D10000 | #A00000 | #FF6464 |
| `--scheme-focus` (focus ring) | ink | ink | #000 | yellow |
| `--media-bg` (image tiles) | surface | #fff | #fff | surface |

`.drawer__panel` and `.modal` always reset to the light scheme. Add a `scheme-*` class to the panel to change that.

Never put white text on yellow. Use red (`--color-accent`) only for dots and markers. Sale text uses `--scheme-sale`, sale backgrounds use `--color-sale`.

## 4. Layout, type and utility classes

* `.page-width` (max 1320 + gutters), `.page-width--narrow` (880).
* `.section` + `style="--pad-top: {{ section.settings.padding_top }}px; --pad-bottom: {{ section.settings.padding_bottom }}px"` (ranges 0–120 step 4). Mobile uses ×0.75 automatically.
* `.product-grid` (2 → 3 @750 → 4 @990), `.product-grid--5` (5 @1200). Use it on a `<ul role="list">` with `<li>` children.
* `.flow` (vertical rhythm, `--flow-space`), `.cluster` (wrapping flex row, `--cluster-gap`).
* `.visually-hidden`, `.skip-link`, `.hide-mobile` (<750), `.hide-desktop` (≥990), `.no-js-hidden` / `.js-only` (hidden without JS), `.no-js-only` (hidden with JS).
* Type: `h1–h4` / `.h1–.h4`, `.display` (hero), `.eyebrow` (+ `.eyebrow--dot`), `.lead`, `.text-muted`, `.text-sale`, `.text-center`, `.rte` (lists with red bullets, yellow-underlined links, tables that scroll).
* `.heading-dot`: adds the red dot when `settings.heading_dot` is on. Don't use it on titles ending in ? / ! / .
* `.media` (`--ratio`, radius, `--media-bg`; img/video/placeholder fill it with cover), `.media--contain`, `.media--blend` (multiply).
* Watermark: add `.has-watermark` on the panel (it sets `position: relative; overflow: hidden; isolation`), then add inside it
  `{% render 'logo', variant: 'mark', tone: 'mono-dark', label: '', class: 'mi-watermark' %}` (use `mono-light` on dark). Modifiers are `.mi-watermark--left` and `--top`. Defaults: bottom-right, 7% opacity, `min(72%, 560px)` wide. Override `width/right/bottom` in your CSS.
* Reveal: add `data-reveal` (optional `style="--reveal-delay: 120ms"`). This is a no-op without JS, under reduced motion and in the theme editor. Content added later is picked up automatically (MutationObserver). **Put it on section wrappers or grid items, not on carousel slides**: off-screen slides would stay hidden until they are swiped in.
* `.icon`: 1em box, `--icon-size` override.
* Logo: `.logo` fills its wrapper (`width: 100%`). **H**: size the wrapper with `width: var(--logo-width-mobile)`, then `var(--logo-width)` from 990px up. `settings.logo` blank → `{% render 'logo' %}` (vector), otherwise `image_url`.
* Screenshots and QA: `preview/shoot.mjs` scrolls through every page before a full-page capture (so `[data-reveal]` content is revealed) and freezes autoplaying carousels on their first slide. See §10.

## 5. Components

**Buttons**: `.btn` + `--primary` (scheme) · `--accent` (scheme) · `--brand` (yellow/#000) · `--ink` (#000/#fff) · `--outline` · `--ghost` · `--link` · `--whatsapp` · sizes `--sm` 40 / `--lg` 56 · `--block` · `--icon` (44 circle, needs `aria-label`; `--icon.btn--sm` 40, `--icon.btn--lg` 52; icon 22 / 20 / 24 px). States: `[disabled]` / `[aria-disabled="true"]` (filled → neutral pill; outline/ghost/link → 35% opacity), `.is-loading` (spinner, label hidden). Presses scale to .98. Inline icons next to a label are 20px.
```html
<button class="btn btn--brand btn--lg btn--block">{% render 'icon', name: 'bag' %} Agregar al carrito</button>
```
**Forms**: `.field` > `.field__label` + `.input|.textarea|.select>select` + `.field__hint`; `.input--pill`; `.checkbox` (`<label class="checkbox"><input type="checkbox|radio"> <span>…</span></label>`); `.form-message.form-message--error|--success` (the icon is added by CSS, don't add one). Inputs are always white with ink text and 16px font.
**Badges**: `.badges` > `.badge.badge--sale|--new|--soldout|--dark|--soft`.
**Chips**: `.chip` (36px pill); active is `.is-active`, `[aria-pressed=true]`, `[aria-selected=true]` or `[aria-current=page]` (inverts scheme fg/bg). `.chip-row` scrolls on mobile and wraps ≥990 unless you add `.chip-row--scroll`. Add `.chip-row--bleed` to bleed to the screen edges below 990.
**Price, rating, swatch**: see snippets. Price sizes `.price--sm|md|lg`.
**Quantity**: see the `quantity-input` snippet. `.qty--sm` is 36px tall (cart lines; its buttons have a 44×44 invisible hit area), md is 44px. Without JS only the number field shows.
**Accordion**:
```html
<details class="accordion [accordion--card]" [open]>
  <summary class="accordion__summary">Pregunta {% render 'icon', name: 'chevron-down' %}</summary>
  <div class="accordion__content rte">…</div>
</details>
```
A `chevron-down` icon rotates 180° when open and a `plus` icon rotates to ×.
**Modal**: `<dialog class="modal [modal--fullscreen]">` with `.modal__close` (absolute top-right) and `.modal__body`. Use native `showModal()`. Scroll lock is yours: call `MiBici.lockScroll()`/`unlockScroll()`.

### Drawer (`<side-drawer>`, global-ui.js)
```html
<button class="btn btn--icon" data-drawer-open="MenuDrawer" aria-controls="MenuDrawer" aria-expanded="false" aria-label="Menú">{% render 'icon', name: 'menu' %}</button>

<side-drawer id="MenuDrawer" class="drawer" data-side="left">        {# right (default) | left | bottom #}
  <div class="drawer__overlay" data-drawer-close></div>
  <div class="drawer__panel" role="dialog" aria-modal="true" aria-labelledby="MenuDrawer-title" tabindex="-1">
    <div class="drawer__header">
      <h2 class="drawer__title" id="MenuDrawer-title">Menú</h2>
      <button type="button" class="drawer__close" data-drawer-close aria-label="{{ 'general.close' | t }}">{% render 'icon', name: 'close' %}</button>
    </div>
    <div class="drawer__body">…</div>
    <div class="drawer__footer">…</div>
  </div>
</side-drawer>
```
Methods: `open(opener?)`, `close()`, `toggle()`, and the getter `isOpen`. `open` does the following:
* closes any other open drawer;
* sets `[open]` and `aria-hidden="false"`, and `aria-expanded` on `[data-drawer-open=id]` and `[aria-controls=id]`;
* locks scroll, traps focus (put `data-drawer-autofocus` on an element to focus it first) and dispatches `drawer:open {id}`.

ESC, overlay and `[data-drawer-close]` all close the drawer, which returns focus to the opener and dispatches `drawer:close`. `data-drawer-close="ID"` closes a specific drawer. Missing `role/aria-modal/tabindex` on the panel are added automatically. Widths: 100% on mobile, 440px ≥750 (right), 380px (left).
**Cart (C)**: `id="CartDrawer"` is required. Either use `<side-drawer id="CartDrawer" class="drawer">` directly, or `class CartDrawer extends MiBici.SideDrawer` and define `cart-drawer`. global.js handles `cart:open` by calling `document.getElementById('CartDrawer').open(opener)` when cartType is `drawer`. If there is no drawer, it navigates to `routes.cart`. You may also listen to `cart:open`; `open()` is idempotent.

### Carousel (`<carousel-slider>`, carousel.js)
```html
<carousel-slider class="carousel [carousel--bleed] [carousel--arrows-overlay]" [data-autoplay="6"] [data-loop]
                 aria-label="Destacados" style="--per-view: 2.15; --gap: 12px;">
  <ul class="carousel__track" role="list">
    <li class="carousel__slide">…</li>
  </ul>
  <div class="carousel__controls">                         {# hidden automatically when everything fits #}
    <button type="button" class="btn btn--icon btn--outline carousel__prev" aria-label="{{ 'general.carousel.previous' | t }}">{% render 'icon', name: 'chevron-left' %}</button>
    <div class="carousel__dots"></div>                     {# buttons generated per page #}
    <button type="button" class="btn btn--icon btn--outline carousel__next" aria-label="{{ 'general.carousel.next' | t }}">{% render 'icon', name: 'chevron-right' %}</button>
  </div>
</carousel-slider>
```
`.carousel--arrows-overlay` puts prev/next over the slides (vertically centred, or at `--arrows-top`) and hides them below 750 px, where people swipe. Set a responsive `--per-view` in your CSS (e.g. `2.15` → `3` @750 → `4` @990). The carousel pages by the number of whole slides in view and syncs dots from the scroll position. Prev/next get `aria-disabled` at the ends unless you set `data-loop`. ←/→ work when focus is on the track, dots or arrows.

Autoplay inserts `.carousel__pause` (btn--icon btn--sm btn--outline) into `.carousel__controls` (or the element). If you add your own `.carousel__pause`, it is used instead. Autoplay pauses on hover/focus, when off-screen and when the tab is hidden. It stops for good after any touch, arrow or dot use. It never runs under reduced motion.

Slides get `.is-active` while in view. Non-list slides (divs) also get `role=group`, `aria-roledescription` "diapositiva" and `aria-label "n de N"` unless they already have a label; `<li>` slides in a list track keep plain list semantics. Events: `carousel:change {page, index}`. Methods: `goTo(slideIndex)`, `goToPage(n)`, `next()`, `prev()`, `refresh()`. Theme editor `shopify:block:select` on a slide scrolls to it and holds autoplay.

## 6. Snippets (all in `snippets/`, params optional unless noted)

| Snippet | Call |
|---|---|
| icon | `{% render 'icon', name: 'cart', size: 20, class: '' %}`: size omitted = 1em. Names: menu close search user cart bag **bag-plus** heart chevron-down/up/left/right arrow-right/left plus minus trash check check-circle truck shield medal whatsapp store clock card lock return wrench bike scooter light tire gear mirror seat pedal grip mudguard helmet glasses tag star star-filled filter sort grid zoom play pause instagram facebook tiktok youtube mail phone map-pin info alert gift bolt share eye box, plus extras **copy link percent external**. The class is `icon icon--{name}`. |
| image | `{% render 'image', image: img, widths: '360,…,2048', sizes: '(min-width: 990px) 50vw, 100vw', lazy: true, priority: false, class: '', alt: '', placeholder: 'image' %}`. `priority: true` → eager + `fetchpriority=high` + preload. Blank → `placeholder_svg_tag`. |
| price | `{% render 'price', product: p, variant: v, size: 'sm'\|'md'\|'lg', show_save: true, show_from: true, class: '' %}` → `<div class="price …" data-price>` (see §7). |
| product-card | `{% render 'product-card', product: p, lazy: true, sizes: '…', heading_tag: 'h3', show_vendor: …, quick_add: …, section_id: section.id, placeholder: 1, class: '' %}`. **Pass `section_id`** so quick-add form ids stay unique. For onboarding placeholders pass `product: blank, placeholder: n` (1–6). Don't omit `product` on product pages: the global `product` would be used. |
| product-badges | `{% render 'product-badges', product: p, variant: v, limit: 2, sale_label: false %}`: outputs `<span class="badge">`s only. Wrap them in your own `.badges`. |
| free-shipping-bar | `{% render 'free-shipping-bar', total: cart.total_price, style: 'card'\|'inline', class: '' %}`: nothing when the threshold is 0. JS keeps it live. |
| quantity-input | `{% render 'quantity-input', id: 'Qty-x', name: 'quantity', value: 1, min: 1, max: '', label: '', line: '', key: '', form: '', size: 'sm'\|'md' %}` (cart lines: `min: 0`, `line: forloop.index`, `key: item.key`). |
| color-swatch | `{% render 'color-swatch', value: option_value_or_string, size: 'sm'\|'md'\|'lg', class: '' %}`: decorative (`aria-hidden`), so always show the name as text. Unknown colors get `.swatch--unknown`. Color option test: `option.name \| downcase \| strip` is `color`, `colour` or `color/colour`. |
| rating | `{% render 'rating', product: p, size: 'sm'\|'md' %}`: renders nothing without `reviews.rating`. |
| breadcrumbs | `{% render 'breadcrumbs', class: '', schema: true %}` (`schema: false` skips JSON-LD if you render it twice). |
| section-heading | `{% render 'section-heading', title:, subtitle:, eyebrow:, link_url:, link_label:, align: 'left'\|'center', tag: 'h2', id:, dot: true, class: '' %}` (link default "Ver todo" → `general.view_all`). |
| whatsapp-button | `{% render 'whatsapp-button', style: 'float'\|'button'\|'link'\|'card', label:, text:, message:, class: '' %}`: **renders nothing when the number setting is blank.** `text` is the card's second line. |
| social-icons | `{% render 'social-icons', class: '' %}` · payment-icons `{% render 'payment-icons', class: '', scope: '' %}` (`scope` makes the ids unique when a page shows the icons twice) · pagination `{% render 'pagination', paginate: paginate, anchor: '#x' %}` · meta-tags (layout only) · logo (see SPEC §2) |

## 7. JavaScript API (window.MiBici)

```js
MiBici.formatMoney(cents[, format])  // {{amount}}, _no_decimals, _with_comma_separator, …
MiBici.debounce(fn, ms)
MiBici.fetchJSON(url, opts)          // JSON body objects are stringified; throws Error(message) with .status/.data
MiBici.parseHTML(html) -> Document
MiBici.announce(text)                // #A11yLive
MiBici.lockScroll() / unlockScroll() // ref-counted
MiBici.trapFocus(container[, el]) / releaseFocus([container])   // stack; Tab cycles, focus can't escape
MiBici.priceHTML(price, compare, {showSave}) / MiBici.updatePrice(priceEl, variant)  // mirrors price.liquid
MiBici.updateCartCount(n) / MiBici.updateFreeShipping(totalCents)                   // called for you on cart:updated
MiBici.initReveal(root) / MiBici.measureHeader()
MiBici.cart.registerSection(id) / unregisterSection(id) / sectionIds()
MiBici.cart.add(formData | {id, quantity, properties} | [items] | {items}) -> {cart, sections, item|items, source}
MiBici.cart.change(lineKeyOrIndex, qty) -> cart (with .sections)   // "1".."9999" = 1-based line index, else key
MiBici.cart.update({variantIdOrKey: qty}, note?) -> cart (with .sections)
MiBici.cart.get() -> cart
```
Cart calls are serialized in a queue, so rapid clicks don't race. `sections` + `sections_url` are appended automatically. Shopify renders at most **5** sections per request.

**Events** (all on `document`, bubbling):
* `cart:updated {cart, sections, source: 'add'|'change'|'update', lineKey?, item|items?}`: after every successful cart call. For `source: 'add'`, `cart` may be partial (`{item_count, total_price, partial: true}`, read from the section's `data-cart-item-count` / `data-cart-total-price`).
* `cart:error {message, source, status}`.
* `cart:open {opener}`.
* `drawer:open` / `drawer:close {id}`.
* `variant:change {sectionId, variant}` is P's to dispatch.
* `product-form:added {detail: result}`, dispatched on the `<product-form>`.
* `carousel:change`, dispatched on the carousel.

**Section re-render pattern (C, and anyone showing cart data):**
```js
class CartDrawerSection extends MiBici.SideDrawer {
  connectedCallback() {
    super.connectedCallback();
    MiBici.cart.registerSection('cart-drawer');          // static section id = file name
    this._onUpdate = (e) => {
      const html = e.detail.sections && e.detail.sections['cart-drawer'];
      if (!html) return;
      const fresh = MiBici.parseHTML(html).querySelector('.cart-drawer__inner');
      const current = this.querySelector('.cart-drawer__inner');
      if (fresh && current) current.replaceWith(fresh);
    };
    document.addEventListener('cart:updated', this._onUpdate);
  }
}
```
For JSON-template sections the id is `section.id` (e.g. `template--123__main`). Render it into a `data-section-id` attribute and register that. If you register many ids, remember the 5-section limit.

**`<product-form>` markup.** It intercepts submit when `cartType === 'drawer'`, or always for "Comprar ahora". On error the message goes into `[data-form-error]` (created if missing).
```liquid
{%- liquid
  # "{{ }}" is NOT interpolated inside tag arguments: build ids with assign.
  assign product_form_id = 'product-form-' | append: section.id
  assign qty_id = 'Quantity-' | append: section.id
-%}
<product-form class="product-form" data-section-id="{{ section.id }}">
  {%- form 'product', product, id: product_form_id, novalidate: 'novalidate' -%}
    <input type="hidden" name="id" value="{{ product.selected_or_first_available_variant.id }}">
    {% render 'quantity-input', id: qty_id, value: 1, min: 1 %}
    <button type="submit" name="add" class="btn btn--brand btn--lg">{{ 'cart.general.add_to_cart' | t }}</button>
    <button type="submit" name="add" class="btn btn--ink btn--lg btn--block" data-redirect="checkout">Comprar ahora</button>
    <p class="form-message form-message--error" data-form-error role="alert" hidden></p>
  {%- endform -%}
</product-form>
```
Buttons outside the form (the sticky bar) use `form="{{ product_form_id }}"` (an HTML attribute, so `{{ }}` is fine there). The clicked button gets `.is-loading` and `aria-busy`, then `.is-added` for 1.8 s. "Comprar ahora" goes to `/checkout` after adding. Without JS, the form posts natively to `/cart/add`. For "Comprar ahora" without JS, add `<input type="hidden" name="return_to" value="/checkout">` if you want it.

**Quantity input** fires a bubbling `change` on its `<input>`. Cart lines: listen for `change` on `.qty__input[data-key]`, then debounce `MiBici.cart.change(input.dataset.key, input.value)`.

**Free shipping**: any `[data-free-shipping]` in the DOM is recomputed on `cart:updated`. Server-rendered bars inside re-rendered sections are already correct.

## 8. Locale keys you can reuse (F namespace, read-only)

`general.close`, `general.loading`, `general.copied`, `general.view_all`, `general.home`, `general.search`, `general.cart`, `general.collections`, `general.breadcrumbs`, `general.payment_methods`, `general.carousel.previous|next|pause|play`, `general.pagination.*`, `general.whatsapp.label|float_text|card_text`, `general.social.follow` (`network:`), `accessibility.skip_to_content|new_window|decrease|increase|quantity`, `products.price.sale|regular|from`, `products.badges.sold_out|sale|new|best_seller|save` (`percent:`), `products.card.quick_add|choose_options` (`title:`), `cart.general.add_to_cart|sold_out|unavailable|adding|added|error|network_error|updated`, `shipping.intro_html` (`amount:`), `shipping.remaining_html` (`amount:`), `shipping.reached_html`, `shipping.zone` (`zone:`), `shipping.progress_label`.
Add new keys only under your own namespace (SPEC §11).

## 9. Settings you will read (settings_schema ids)

`logo`, `logo_width`, `logo_width_mobile`, `favicon` · `color_*` · `adobe_fonts_kit`, `heading_dot`, `body_scale` · `corner_style` · `card_show_vendor`, `card_quick_add`, `card_secondary_image`, `card_image_ratio`, `card_blend_white`, `card_show_swatches` · `cart_type`, `free_shipping_threshold` (soles; ×100 for cents), `free_shipping_zone`, `cart_upsell_collection` (blank → `collections['destacados']`), `cart_upsell_heading`, `cart_show_note`, `cart_checkout_note` · `whatsapp_number` (blank → hide), `whatsapp_message`, `whatsapp_float`, `contact_email|phone|address|hours` · `delivery_lima_min|max` (0–10), `delivery_prov_min|max` (0–15), `delivery_cutoff_hour` (0 = none), `delivery_skip_sunday` · `social_instagram|facebook|tiktok|youtube` · `predictive_search`.

## 10. Preview, style guide and screenshots

The preview harness (`dev/preview/`, full docs in `dev/preview/README.md`) renders the real theme with the mock catalog. The earlier harness caveats (unset `size` rendering as 37, `product: blank` not being blank, `collections.all` being empty) are fixed.

**Living style guide:** `/_styleguide` renders every foundation component with the real snippets, CSS and JS (brand, colour, type, buttons on every scheme, forms, badges/chips, prices/rating, colour swatches, quantity, free-shipping bar, accordion, section headings, product cards in a carousel and a grid, drawers, WhatsApp, the icon set, pagination/breadcrumbs/payment/social). Check it before styling something yourself: if a class already exists there, reuse it.

**Screenshot your pages** (run from `dev/`):
```bash
node preview/server.mjs --port 4200 --quiet &                      # optional; shoot starts its own server otherwise
node preview/shoot.mjs --port 4200 --pages home --out screens/home          # full page, 390 px + 1440 px
node preview/shoot.mjs --port 4200 --pages product,product-color,variant-switch,cart-drawer --out screens/product
node preview/shoot.mjs --port 4200 --pages home --vp mobile --settings whatsapp_number:51900000000 --out screens/home-wa
```
* `shoot.mjs` reuses a server that is already listening on `--port`, otherwise it starts one. Output: `<out>/<page>-<mobile|desktop>.png` plus `<out>/report.json` (console errors, failed requests, Liquid render errors with file/line, mobile overflow offenders, state reached/not reached). **Read the PNGs and the report**; aim for 0 console errors, 0 render errors (other than files other areas haven't written yet) and no `overflow.overflowing`.
* Page names: `home collection collection-all collection-filtered product product-color product-soldout product-agotado product-modelos search search-empty cart cart-empty list-collections page 404 password styleguide`. State names: `cart-drawer cart-drawer-empty menu-drawer predictive filters-drawer variant-switch` (each needs the markup hooks listed in the README).
* Full-page PNGs are tall (the style guide is ~21 000 px on mobile). To inspect details, capture single elements with Playwright (`element.screenshot()`) or crop the PNG.
* `?__settings=id:value,id2:value2` on any preview URL overrides theme settings for that request (e.g. `whatsapp_number:51900000000`, `cart_type:page`, `corner_style:square`, `heading_dot:false`); `shoot.mjs --settings …` appends it to every captured URL.
* Products whose handle starts with `sg-` are preview-only fixtures (`dev/preview/fixtures/products.json`: a fully sold-out product and a multi-variant "Desde" product tagged nuevo + mas-vendido with a demo rating). They are reachable by handle but never listed in collections, search or counts.
* Mock product photos are placeholders on a **white** background, like the real catalog photos, so `card_blend_white` behaves as on Shopify.
