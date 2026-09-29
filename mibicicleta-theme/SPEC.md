# Mi Bicicleta — Shopify theme "Mi Bici 2026" · Build spec & contracts

This file is the single source of truth for everyone building this theme. If something
here conflicts with your instinct, follow this file. If this file is silent, follow the
closest existing pattern in `theme/` and Shopify's Dawn conventions.

Repo layout:

```
mibicicleta-theme/
  SPEC.md                ← this file
  theme/                 ← the Shopify theme root (what gets zipped & uploaded)
  dev/                   ← tooling (never uploaded)
    brand/               logo-lockup.svg, logo-mark.svg (vector, from the brand manual)
    mock/store.json      real catalog sample (from Admin API) for local preview
    locale-fragments/    one JSON per builder area, merged into theme/locales/es.default.json
    tools/check.mjs      Theme Check (node tools/check.mjs [pathPrefix...])
    tools/sizes.mjs      16 KiB per-file budget
    tools/merge-locales.mjs
    preview/             local Shopify-Liquid renderer + mock server + Playwright screenshots
```

Run tools from `mibicicleta-theme/dev`: `node tools/check.mjs sections/header` etc.

---

## 1. Context

* Store: **Mi Bicicleta** — `mibicicleta.pe` (Shopify, currency **PEN**, money format `S/ {{amount}}`,
  Spanish / Peru, tuteo). Bike **and scooter** accessories & spare parts, Lima.
* Catalog: ~217 products, cheap tickets (S/ 9 – S/ 230). Brands: Rockbros (authorized seller),
  Neco, Wellgo, CIGNA, Nedong, Shinetour. Many products have 1 variant; some have `Color`
  (values like `Amarillo`, `Rojo Negro`, `NEGRO BRILLO / BLANCO`) or `Modelo` (codes `BW`, `BR`…).
* Inventory: most variants are `inventory_policy: continue` with `inventory_quantity: 0` → they are
  **available**. Never print "0 en stock". Low-stock messaging only when
  `inventory_management == 'shopify'` AND `inventory_policy == 'deny'` AND qty ≤ threshold.
* Internal tags exist (`sin-precio`, `nombre-inferido`) — **never display tags** to shoppers
  except the explicit badge tags listed in §7.
* Collections (handles): `luces` (Luces y seguridad), `llantas-y-camaras`, `pinones-y-transmision`,
  `espejos`, `asientos` (Asientos y tubos), `pedales`, `grips` (Grips y puños), `tapabarros`,
  `cascos` (Cascos y protección), `accesorios`, `rockbros`, `neco`, `destacados`, `componentes`, `frontpage`.
* Menus: `main-menu` (Luces, Llantas y cámaras, Piñones y transmisión, Espejos, Componentes ▸
  [Asientos y tubos, Pedales, Grips y puños, Tapabarros], Accesorios, Rockbros), `footer`.
* Shop images in Files (16:9, 2048×1152, AI-generated Lima street scenes), referenced in JSON as
  `shopify://shop_images/<name>`: `mibi-ia-luces-lima-anochecer.png`, `mibi-ia-cascos-lima.png`,
  `mibi-ia-llantas-scooter-lima.png`, `mibi-ia-asientos-lima.png`, `mibi-ia-espejos-lima.png`.
* **Verified business facts** (Admin API, 2026-09-29) — the ONLY promises the theme may make by default:
  * Shipping zone "Domestic" = all of Peru. Standard rate **S/ 14**. **Free when order total ≥ S/ 220.**
  * "Vendedor autorizado Rockbros" / "Productos originales" (existing store copy).
  * "7 días para cambiar, sin abrir" (existing store copy).
  * "Consultas y pedidos por WhatsApp" — but **the WhatsApp number is unknown**: setting defaults
    to blank, and every WhatsApp UI must render **nothing** when it is blank. Never invent a number.
  * "Si no sabes cuál es, escríbenos con una foto." (existing store copy)
  * Delivery-time windows are NOT verified → any delivery estimate UI must be driven by settings
    and must say in its schema `info`: "⚠️ Confirma estos plazos antes de publicar."
* No reviews app is installed. Rating UI reads the standard `product.metafields.reviews.rating`
  and renders nothing when absent. **Never fabricate reviews/testimonials** or presets with fake
  customer quotes.
* Customer accounts are the new (hosted) accounts → no `templates/customers/*` needed; the header
  account icon links to `routes.account_url` (only if `shop.customer_accounts_enabled`).

UX reference the client liked (Qué Patas pet shop): scrolling black announcement bar with a
discount code; clean white header; product page with vertical thumbnails, sale badge, big red
sale price + struck compare price, stock indicator, color swatches, size pills, delivery cutoff,
qty stepper; and especially the **cart drawer**: free-shipping box with progress bar and moving
marker, line items with variant lines + compare price + qty stepper + "Eliminar", an upsell card
with "Agregar", totals (Descuentos, Subtotal), big "Finalizar pedido", "Seguir comprando".

## 2. Brand (from MANUAL_DE_MARCA_MI_BICICLETA.pdf)

* Colors: **Yellow `#FFD219`** (Pantone 116 C) · **Black `#000000`** · **Red `#FF0000`** (485 C).
* Logo: "mi" imagotipo (continuous rounded strokes; the **red dot** over the i = a light / beacon)
  + "Bicicleta" wordmark. Correct applications: black+red dot on yellow/white; white+red dot on
  black; all-white on red. Never recolor, stretch, outline, or put on green. Min web size 22px.
  Use `{% render 'logo', variant: 'lockup'|'mark', tone: 'dark'|'light'|'mono-light'|'mono-dark' %}`
  (already written: `theme/snippets/logo.liquid`).
* Type: brand heading font is *All Round Gothic Bold* (commercial, Adobe Fonts); body *Franklin Gothic Book*.
  Web stack (Google Fonts, chosen by side-by-side render against the wordmark):
  **Urbanist** 700/800/900 for headings/prices/buttons (near-identical geometry: single-story "a",
  same B/c/e/t) and **Libre Franklin** 400/500/600/700 for body. A theme setting lets the merchant
  paste an Adobe Fonts kit id to use the real All Round Gothic.
* Signature motifs to reuse (sparingly, tastefully):
  1. **The red dot**: headings may end with a red dot (like the manual's "2." section numbers) —
     class `.heading-dot` (CSS adds a red circle after the text). Cart count badge is a red dot.
  2. **"mi" watermark**: huge logo mark at ~6–8% opacity bleeding off the edge of yellow panels
     (`{% render 'logo', variant: 'mark', tone: 'mono-dark', label: '', class: 'mi-watermark' %}`).
  3. Circles/rounded shapes: pill buttons & inputs, circular category bubbles, rounded cards.

## 3. Design tokens (CSS custom properties; defined by foundation in `layout/theme.liquid` + `base.css`)

Colors (settings-driven where noted):
```
--color-brand: #FFD219        (setting color_brand)     yellow surfaces, primary CTA
--color-brand-strong: #F2C200 (hover of yellow)
--color-brand-soft: #FFF6CF   (setting color_brand_soft) free-shipping box, banners, collection header
--color-ink: #0B0B0B          (setting color_ink)       text, dark surfaces (logo stays #000)
--color-accent: #FF0000       (setting color_accent)    decorative only: dots, markers, cart badge
--color-sale: #D10000         (setting color_sale)      sale TEXT (pure #FF0000 fails AA on white)
--color-bg: #FFFFFF
--color-surface: #F5F5F2      product image backgrounds, cards
--color-surface-2: #ECECE6
--color-border: #E2E2DC
--color-muted: #5C5C56        secondary text (≥ 4.5:1 on white and on surface)
--color-success: #17803A      "Disponible", reached free shipping
--color-warning: #9A5B00      low stock
```
Contrast rules: never white text on yellow. Red badges use `--color-sale` bg + white bold text.

Color schemes — every section has a `select` setting `scheme` with options
`light | soft | brand | dark` and adds class `scheme-{{ section.settings.scheme }}` to its outer
element. Foundation defines each scheme as variables components must use:
```
--scheme-bg, --scheme-fg, --scheme-muted, --scheme-border,
--scheme-btn-bg, --scheme-btn-fg          (for .btn--primary)
--scheme-accent-bg, --scheme-accent-fg    (for .btn--accent)
light: #fff / ink / muted / border / btn ink→#fff / accent yellow→#000
soft:  #F5F5F2 (surface) / … same as light
brand: yellow / #000 / rgba(0,0,0,.72) / rgba(0,0,0,.14) / btn #000→#fff / accent #000→yellow
dark:  #0B0B0B / #fff / rgba(255,255,255,.72) / rgba(255,255,255,.16) / btn yellow→#000 / accent yellow→#000
```

Type scale (root font-size 16px; do NOT use Dawn's 62.5% trick):
```
--font-heading: 'Urbanist', 'Helvetica Neue', Arial, sans-serif;  --fw-heading: 800;
--font-body: 'Libre Franklin', 'Helvetica Neue', Arial, sans-serif;
--fs-xs .75rem · --fs-sm .875rem · --fs-base 1rem · --fs-md 1.125rem · --fs-lg 1.25rem · --fs-xl 1.5rem
--fs-2xl clamp(1.625rem, 1.3rem + 1.4vw, 2.25rem)  (h2)
--fs-3xl clamp(2rem, 1.5rem + 2.4vw, 3.25rem)      (h1)
--fs-display clamp(2.5rem, 1.5rem + 4.6vw, 4.75rem) (hero)
line-height: body 1.55, headings 1.05–1.15; letter-spacing headings -0.01em; eyebrow +0.08em uppercase.
```
Space: `--space-1..10` = 4, 8, 12, 16, 20, 24, 32, 40, 56, 72 px.
Radius: `--radius-sm 8px · --radius 14px · --radius-lg 22px · --radius-pill 999px` (setting
`corner_style`: rounded (default) | soft (halved) | square (0, pills stay pills? no → 4px)).
Shadow: `--shadow-sm 0 1px 2px rgba(0,0,0,.06)`, `--shadow-md 0 8px 24px rgba(0,0,0,.10)`,
`--shadow-lg 0 24px 60px rgba(0,0,0,.18)`.
Layout: `--page-width 1320px`; gutters `--gutter` 16px (<750) · 24px (≥750) · 32px (≥1200).
Breakpoints (mobile-first, `min-width` only): **750px** (tablet), **990px** (desktop), **1200px** (wide).
Motion: `--ease cubic-bezier(.2,.7,.2,1)`, `--dur 220ms`. Everything must respect
`prefers-reduced-motion: reduce` (no marquee motion, no autoplay, no reveal animations).
Header height is exposed as `--header-height` (JS keeps it updated) for sticky offsets.

## 4. Global constraints (all builders)

1. **Shopify Online Store 2.0**: JSON templates, sections with `{% schema %}`, blocks with
   `{{ block.shopify_attributes }}`, `{% render %}` (never `{% include %}`), `image_url` +
   `image_tag` (never `img_url`), `{% form %}` for Shopify forms, `routes.*` for URLs (never hardcode
   `/cart`, `/search` etc. — Theme Check `HardcodedRoutes`).
2. **Theme Check clean**: 0 errors. Run `node tools/check.mjs <your paths>` before finishing.
   Schema `name` ≤ **25 characters** (Shopify rejects the whole upload otherwise). Setting ids unique
   per schema. `range` settings: default within [min,max], ≤ 101 steps. `richtext` defaults wrapped in `<p>`.
   `select` defaults must be one of the option values. Section groups: header sections need
   `"enabled_on": {"groups": ["header"]}` (or `disabled_on`) as appropriate.
3. **File size ≤ 16 KiB** each (`node tools/sizes.mjs`). Split into snippets / multiple CSS/JS files.
4. **Language**: all shopper-facing text in Spanish (Peru, tú). Shopper-facing strings in Liquid
   go through `{{ 'area.key' | t }}` with keys you add to YOUR locale fragment
   `dev/locale-fragments/<area>.json` (namespaced under your area — see §11). Section/setting
   labels in schemas are plain Spanish strings (no `t:`). Default copy that the merchant edits lives
   in section settings (plain Spanish).
5. **Accessibility**: semantic landmarks, one `<h1>` per page, visible focus (`:focus-visible`
   ring: 3px `--color-ink` outline + 2px offset; on dark schemes use yellow), 44×44 min tap targets,
   `aria-expanded`/`aria-controls` on toggles, focus trap in drawers/modals, ESC closes, images need
   alt (fallback to product title), `aria-live` for cart updates, forms with labels.
6. **Performance**: no jQuery, no frameworks. Vanilla JS custom elements, `defer`. Lazy-load
   below-the-fold images (`loading="lazy"`), `fetchpriority="high"` for the first hero image and
   main product image. Always pass `widths` + `sizes` to `image_tag`.
7. **No fabricated content** (see §1). Placeholders when a setting is empty must look intentional
   (e.g. `placeholder_svg_tag` on `--color-surface`), never lorem ipsum in shipped JSON templates.
8. **Graceful degradation**: core flows (add to cart, filters, search) work without JS via normal
   form submits; JS enhances.
9. **No console errors.** Guard every `querySelector` result. Custom elements: check
   `customElements.get(name)` before `define`.
10. Class names: plain BEM-ish (`block__element--modifier`), no framework prefixes. Reuse
    foundation classes (§6) rather than re-styling buttons/inputs/badges per section.

## 5. File ownership (who writes what)

| Area | Owner | Files |
|---|---|---|
| Foundation | F | `layout/theme.liquid`, `layout/password.liquid`, `config/settings_schema.json`, `config/settings_data.json`, `assets/base.css`, `assets/components.css`, `assets/product-card.css`, `assets/global.js`, `assets/carousel.js`, snippets: `icon`, `logo` (done), `image`, `price`, `product-card`, `product-badges`, `free-shipping-bar`, `quantity-input`, `color-swatch`, `rating`, `meta-tags`, `breadcrumbs`, `social-icons`, `payment-icons`, `whatsapp-button`, `pagination`, `section-heading`; `dev/locale-fragments/00-foundation.json` |
| Header | H | `sections/announcement-bar.liquid`, `sections/header.liquid`, `sections/header-group.json`, `sections/predictive-search.liquid`, snippets `header-nav`, `menu-drawer`, `header-search`; `assets/section-header.css`, `assets/header.js`, `assets/predictive-search.js`, `assets/section-predictive-search.css`; fragment `10-header.json` |
| Cart | C | `sections/cart-drawer.liquid`, `sections/main-cart.liquid`, `templates/cart.json`, snippets `cart-line-item`, `cart-upsell`, `cart-totals`; `assets/component-cart.css`, `assets/cart.js`; fragment `20-cart.json` |
| Product | P | `sections/main-product.liquid`, `sections/product-recommendations.liquid`, `sections/pickup-availability.liquid`, `templates/product.json`, snippets `product-gallery`, `product-info-block`, `variant-picker`, `delivery-estimate`, `sticky-atc`, `product-accordion`; `assets/section-main-product.css`, `assets/product.js`; fragment `30-product.json` |
| Collection & search | CO | `sections/main-collection-banner.liquid`, `sections/main-collection.liquid`, `sections/main-search.liquid`, `sections/main-list-collections.liquid`, `templates/collection.json`, `templates/search.json`, `templates/list-collections.json`, snippets `facets`, `facets-active`, `sort-by`; `assets/section-collection.css`, `assets/facets.js`; fragment `40-collection.json` |
| Home sections | HO | `sections/hero-slideshow.liquid`, `sections/search-hero.liquid`, `sections/category-grid.liquid`, `sections/usp-strip.liquid`, `sections/featured-collection.liquid`, `sections/promo-banners.liquid`, `sections/brand-marquee.liquid`, `sections/image-with-text.liquid`, `sections/faq.liquid`, `sections/newsletter.liquid`, `sections/rich-text.liquid`, `templates/index.json`; `assets/section-hero.css`, `assets/section-home.css` (+ `section-home-2.css` if needed), `assets/home.js`; fragment `50-home.json` |
| Footer & pages | FP | `sections/footer.liquid`, `sections/footer-group.json`, `sections/main-page.liquid`, `sections/contact-form.liquid`, `sections/main-blog.liquid`, `sections/main-article.liquid`, `sections/main-404.liquid`, `sections/main-password.liquid`, `sections/custom-liquid.liquid`, `sections/apps.liquid`, `templates/page.json`, `templates/page.contact.json`, `templates/blog.json`, `templates/article.json`, `templates/404.json`, `templates/password.json`, `templates/gift_card.liquid`; `assets/section-footer.css`, `assets/section-pages.css`; fragment `60-pages.json` |
| Preview harness | HA | everything under `dev/preview/` |

Rules: write ONLY your files. Need something from another area? Use its documented contract
below; if missing, implement a local fallback inside your own files and note it in your final
report — do not edit other areas' files. Foundation files are read-only for section builders
(report requests instead).

Sections that the merchant may reuse anywhere (`featured-collection`, `usp-strip`, `rich-text`,
`image-with-text`, `faq`, `newsletter`, `promo-banners`, `custom-liquid`, `product-recommendations`)
must have `presets` and must not use `enabled_on` restrictions except where needed.

## 6. Foundation contracts (F implements; everyone uses)

### 6.1 Layout (`layout/theme.liquid`)
* `<html lang="{{ request.locale.iso_code }}" class="no-js">`; inline script flips `no-js`→`js`.
* Head: meta charset/viewport, `{% render 'meta-tags' %}`, canonical, favicon (setting), preconnect to
  fonts.googleapis.com & fonts.gstatic.com, Google Fonts `<link>` for
  `Urbanist:wght@700;800;900` + `Libre+Franklin:wght@400;500;600;700` (`display=swap`) — OR the Adobe
  Fonts kit `https://use.typekit.net/{{ settings.adobe_fonts_kit }}.css` when that setting is set (then
  `--font-heading: 'all-round-gothic', …`). CSS variables `<style>` block from settings.
  `base.css`, `components.css`, `product-card.css` via `stylesheet_tag`. `global.js` + `carousel.js` with `defer`.
  `{{ content_for_header }}`.
* Inline config script BEFORE global.js:
  ```js
  window.MiBici = window.MiBici || {};
  MiBici.routes = { root, cart, cart_add, cart_change, cart_update, predictive_search, search,
                    product_recommendations };            // from routes.*_url
  MiBici.moneyFormat = {{ shop.money_format | json }};
  MiBici.settings = { cartType: 'drawer'|'page', freeShippingThreshold: <cents>,
                      freeShippingZone: '…', whatsapp: '<digits or empty>' };
  MiBici.strings = { addToCart, soldOut, unavailable, adding, added, cartError, freeShippingRemaining
                     ('¡Te faltan [amount] para el envío gratis!'), freeShippingReached, … }  // via | t | json
  ```
* Body: skip link → `#MainContent`; `{% sections 'header-group' %}`;
  `<main id="MainContent" class="content" role="main" tabindex="-1">{{ content_for_layout }}</main>`;
  `{% sections 'footer-group' %}`; `{% if settings.cart_type == 'drawer' %}{% section 'cart-drawer' %}{% endif %}`;
  `{% render 'whatsapp-button', style: 'float' %}`; `<div id="A11yLive" class="visually-hidden" aria-live="polite"></div>`.
* JSON-LD Organization on the index page.

### 6.2 Settings (`config/settings_schema.json`, ids are the contract)
* `theme_info` (name "Mi Bici 2026", version "1.0.0", author "RDC Group").
* Logo: `logo` (image_picker; empty = inline SVG logo), `logo_width` (range 100–260, default 168),
  `logo_width_mobile` (range 90–200, default 132), `favicon` (image_picker).
* Colors: `color_brand`, `color_brand_soft`, `color_ink`, `color_accent`, `color_sale` (defaults §3).
* Typography: `adobe_fonts_kit` (text, blank), `heading_dot` (checkbox, default true — red dot on
  section headings), `body_scale` (range 90–110 %, default 100).
* Shape: `corner_style` (select rounded|soft|square, default rounded).
* Product cards: `card_show_vendor` (checkbox, true), `card_quick_add` (true), `card_secondary_image`
  (true, hover swap on desktop), `card_image_ratio` (select square|portrait|natural, square),
  `card_blend_white` (checkbox true: `mix-blend-mode: multiply` so white-background photos blend
  into `--color-surface`), `card_show_swatches` (true).
* Cart: `cart_type` (select drawer|page, drawer), `free_shipping_threshold` (number, default 220,
  info "Monto en soles. Verificado en Configuración › Envíos: gratis desde S/ 220 en todo el Perú."
  — use `number` type), `free_shipping_zone` (text, "todo el Perú"), `cart_upsell_collection`
  (collection, default blank → falls back to `collections['destacados']`), `cart_upsell_heading`
  (text "Complétalo con"), `cart_show_note` (checkbox, false), `cart_checkout_note` (text,
  "Impuestos incluidos. El envío se calcula en el checkout.").
* Contact: `whatsapp_number` (text, blank, info "Solo dígitos con código de país, ej. 51987654321.
  Vacío = se ocultan todos los botones de WhatsApp."), `whatsapp_message` (text "Hola Mi Bicicleta,
  tengo una consulta"), `whatsapp_float` (checkbox, true), `contact_email` (text, blank),
  `contact_phone` (text, blank), `contact_address` (text, blank), `contact_hours` (text, blank).
* Delivery estimate: `delivery_lima_min` (range 0–10, default 1), `delivery_lima_max` (default 3),
  `delivery_prov_min` (default 3), `delivery_prov_max` (default 7), `delivery_cutoff_hour`
  (range 0–23, default 0 = no cutoff countdown), `delivery_skip_sunday` (checkbox, true); header
  info "⚠️ Confirma estos plazos antes de publicar."
* Social: `social_instagram`, `social_facebook`, `social_tiktok`, `social_youtube` (text, blank).
* Search: `predictive_search` (checkbox, true).
* `settings_data.json`: `current` with these defaults (+ nothing else).

### 6.3 CSS classes (F defines in base.css / components.css / product-card.css)
* Layout: `.page-width`, `.section` (uses `padding-block: var(--pad-top) var(--pad-bottom)`;
  sections set `style="--pad-top: {{ section.settings.padding_top }}px; --pad-bottom: …"` where
  `padding_top`/`padding_bottom` are ranges 0–120 step 4; on mobile F scales them ×0.75 via
  `calc`), `.scheme-light|soft|brand|dark`, `.visually-hidden`, `.skip-link`, `.hide-mobile`
  (<750 hidden), `.hide-desktop` (≥990 hidden), `.no-js-hidden`, `.js-only`.
* Type: `h1–h4`/`.h1–.h4`, `.display`, `.eyebrow`, `.lead`, `.text-muted`, `.text-center`,
  `.heading-dot` (adds the red dot after text when `settings.heading_dot`; F adds class
  `body.has-heading-dot`), `.rte` (rich text: lists, links, tables, h2-h4 inside descriptions).
* Section heading snippet: `{% render 'section-heading', title: …, subtitle: …, link_url: …,
  link_label: …, align: 'left'|'center', tag: 'h2' %}` → `.section-heading` flex row (title +
  "Ver todo →" link on the right).
* Buttons: `.btn` (pill, min-height 48px, padding 0 24px, Urbanist 800, 1rem, gap for icons) +
  `.btn--primary` (scheme btn vars) · `.btn--accent` (scheme accent vars) · `.btn--brand` (always
  yellow bg / black text, hover `--color-brand-strong`) · `.btn--ink` (always black / white) ·
  `.btn--outline` (transparent, 2px currentColor border) · `.btn--link` (text + underline) ·
  sizes `.btn--sm` (40px) `.btn--lg` (56px) · `.btn--block` · `.btn--icon` (44×44 circle, icon only;
  needs aria-label) · states `[disabled]`/`[aria-disabled=true]` (40% opacity, not-allowed) and
  `.is-loading` (label hidden, centered spinner via `::after`).
* Forms: `.field` (+ `.field__label`, `.field__hint`), `.input`, `.textarea`, `.select` (wrapper
  with chevron; the `<select>` inside), `.checkbox`, `.input--pill`, `.form-message`
  (`--error` red, `--success` green, with icon).
* Badges: `.badge` + `--sale` (sale-red bg, white), `--new` (yellow, black), `--soldout`
  (surface-2, muted), `--dark` (ink, white), `--soft` (brand-soft, ink). `.badges` container.
* Chips: `.chip` (pill, 1px border, 36px), `.chip.is-active`/`[aria-pressed=true]` (ink bg, white),
  `.chip-row` (flex; horizontal scroll with hidden scrollbar on mobile; wraps on ≥990 unless
  `.chip-row--scroll`).
* Price (output of `price` snippet): `.price` `.price__current` `.price__compare` (`<s>`)
  `.price__save` (red pill "-30%") `.price__from`; modifiers `.price--sale`, `.price--soldout`,
  sizes `.price--sm|md|lg`.
* Rating: `.rating` (5 stars, CSS-masked, `--rating: 4.6`), `.rating__count`.
* Swatch: `.swatch` (circle, `--swatch-color` / `--swatch-image`, 1px inset ring), sizes
  `.swatch--sm` (16) `.swatch--md` (28) `.swatch--lg` (40).
* Quantity: `<quantity-input class="qty">` → `.qty__btn` `.qty__input` (height 44, pill border).
* Drawer: `<side-drawer id="…" class="drawer" [data-side="left|right|bottom"]>` →
  `.drawer__overlay` `.drawer__panel` (`__header`, `__title`, `__body`, `__footer`, `__close`).
  Open state attribute `open` (+ `aria-hidden`). Width: 100% mobile, 440px ≥750 (cart), 380px menu.
* Accordion: `<details class="accordion"><summary class="accordion__summary">… {% render 'icon',
  name: 'chevron-down' %}</summary><div class="accordion__content">…</div></details>`.
* Carousel: `<carousel-slider class="carousel" [data-autoplay="6"] [data-loop]>` containing
  `.carousel__track` (scroll-snap, `overflow-x:auto`, hidden scrollbar) > `.carousel__slide`
  items; optional `.carousel__prev` / `.carousel__next` buttons (`.btn--icon`) and
  `.carousel__dots` (`button.carousel__dot` generated by JS if container present); `--per-view`
  CSS var controls slide width (`calc((100% - gaps) / per-view)`), set responsively by the section.
  JS in `carousel.js`: prev/next scroll by one page, dot sync from scroll position, keyboard,
  autoplay with a pause/play button (`.carousel__pause`, auto-inserted when autoplay) that stops on
  hover/focus/touch, never autoplays under reduced motion.
* Grid: `.product-grid` (2 cols → 3 @750 → 4 @990; `.product-grid--5` → 5 @1200; gap 12px/24px).
* Media: `.media` (position:relative, overflow hidden, `aspect-ratio: var(--ratio, 1)`,
  `border-radius: var(--radius)`, bg `--color-surface`; child img `object-fit: cover`, 100%),
  `.media--contain` (object-fit contain), `.media--blend img` (multiply).
* Reveal: add `data-reveal` to blocks → fade/slide-up when visible (IntersectionObserver in
  global.js adds `.is-revealed`); no-op with reduced motion or `no-js`.
* `.mi-watermark` (absolute, pointer-events none, opacity .07, color inherit).
* Icons: `.icon` (1em box, `stroke: currentColor`, `fill: none`, `vertical-align: middle`).

### 6.4 Snippets (signatures)
* `icon` — `{% render 'icon', name: 'cart', size: 20, class: 'x' %}`. Inline SVG, 24×24 viewBox,
  stroke 1.75, round caps/joins, `aria-hidden="true" focusable="false"`. Required names:
  `menu close search user cart bag heart chevron-down chevron-up chevron-left chevron-right arrow-right
  arrow-left plus minus trash check check-circle truck shield medal whatsapp store clock card lock
  return wrench bike scooter light tire gear mirror seat pedal grip mudguard helmet glasses tag star
  star-filled filter sort grid zoom play pause instagram facebook tiktok youtube mail phone map-pin
  info alert gift bolt share eye box`. (Category icons: light, tire, gear, mirror, seat, pedal, grip,
  mudguard, helmet, glasses, bag, scooter, bike.) Brand/social icons may be filled paths.
* `image` — `{% render 'image', image: img, widths: '360,540,720,900,1080,1296,1512,1728,2048',
  sizes: '(min-width: 990px) 50vw, 100vw', lazy: true, priority: false, class: '', alt: '' %}` →
  `image_url` + `image_tag` with srcset; `priority: true` → `loading="eager" fetchpriority="high"`;
  blank image → `{{ 'image' | placeholder_svg_tag: 'placeholder-svg' }}`.
* `price` — `{% render 'price', product: p, variant: v (optional; default selected_or_first_available),
  size: 'sm'|'md'|'lg', show_save: true, show_from: true %}` → markup in §6.3; "Desde" prefix when
  `price_varies` and no explicit variant; save % = round((compare-price)/compare*100);
  visually-hidden labels "Precio de oferta"/"Precio habitual"; `data-price` attribute on root so JS
  can swap innerHTML on variant change. Money via `| money`.
* `product-card` — `{% render 'product-card', product: p, lazy: true, sizes: '…', heading_tag: 'h3',
  show_vendor: settings.card_show_vendor, quick_add: settings.card_quick_add, class: '' %}`.
  Blank product → placeholder card (onboarding). Structure:
  ```html
  <article class="product-card" data-product-id="…">
    <div class="product-card__media media [media--blend]">
      <a class="product-card__link" href="{{ product.url }}" tabindex="-1" aria-hidden="true"> img (+ secondary img) </a>
      <div class="product-card__badges badges">{% render 'product-badges', product: p %}</div>
      [quick add: <product-form class="product-card__quick"> form with hidden id + .btn--icon (bag+plus) </product-form>
       — only if 1 available variant; multi-variant → <a class="btn btn--icon product-card__quick-link" href="…" aria-label="Elegir opciones: {{title}}">;
       sold out → none]
    </div>
    <div class="product-card__info">
      [<p class="product-card__vendor">] <h3 class="product-card__title"><a href="…" class="product-card__title-link">title</a></h3>
      [rating] {% render 'price', size: 'sm' %} [swatches: up to 5 color dots + "+N"]
    </div>
  </article>
  ```
  The title link gets a `::after` stretched hit area covering the card (the quick-add button sits
  above it with z-index). Title clamps to 2 lines.
* `product-badges` — `{% render 'product-badges', product: p, variant: v %}`: sale "-NN%" (if any
  variant on sale; use max %), "Agotado" (not available), "Nuevo" (tag `nuevo`), "Más vendido"
  (tag `mas-vendido`). Max 2 badges shown (priority: agotado, sale, nuevo, más vendido).
* `free-shipping-bar` — `{% render 'free-shipping-bar', total: cart.total_price, style: 'card'|'inline' %}`.
  Renders nothing if threshold ≤ 0. Markup:
  ```html
  <div class="free-ship free-ship--card [is-complete]" data-free-shipping data-threshold="22000">
    <p class="free-ship__text" data-free-shipping-text>¡Te faltan <strong>S/ 146.50</strong> para el envío gratis! <span>Válido para todo el Perú</span></p>
    <div class="free-ship__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="33" aria-label="Progreso hacia el envío gratis">
      <div class="free-ship__fill" style="--progress: 33%"></div>
      <span class="free-ship__marker">{% render 'icon', name: 'bike' %}</span>
    </div>
  </div>
  ```
  global.js updates every `[data-free-shipping]` on `cart:updated` using `MiBici.strings`.
* `quantity-input` — `{% render 'quantity-input', id: 'Qty-…', name: 'quantity', value: 1,
  min: 1, max: '', label: 'Cantidad', line: '' (cart line index; adds data-line), size: 'sm'|'md' %}`.
* `color-swatch` — `{% render 'color-swatch', value: option_value (string or product_option_value),
  size: 'md' %}`: uses native `value.swatch.color`/`.image` when present; else maps Spanish color
  words (case/accents-insensitive) — amarillo #FFD219, blanco #FFFFFF, negro #111111, rojo #D10000,
  azul #1F5BD8, celeste #7CC6F2, verde #2E9E4F, rosa #F28DB2, fucsia #E0218A, naranja #FF7A00,
  morado #7B3FB5, lila #B79CE0, gris #9A9A9A, plateado #C9C9C9, dorado #C9A13B, marron/marrón #7A4B2A,
  beige #E6D5B8, transparente (checker), tornasolado (conic rainbow gradient); values containing two
  known colors (e.g. "Rojo Negro", "NEGRO BRILLO / BLANCO") → 50/50 diagonal split. Unknown →
  neutral swatch showing nothing special (the caller shows text label then).
  Helper output: `<span class="swatch swatch--md" style="--swatch: …"></span>`; also expose
  `is_color_option` logic in a comment for callers: option names `color`, `colour`, `color/colour`
  (case-insensitive) count as color options.
* `rating` — `{% render 'rating', product: p, size: 'sm' %}`: standard reviews metafields; nothing if absent.
* `breadcrumbs` — `{% render 'breadcrumbs' %}` (uses template/collection/product; includes JSON-LD).
* `social-icons` — from social settings; nothing if all blank.
* `payment-icons` — `shop.enabled_payment_types | payment_type_svg_tag`.
* `whatsapp-button` — `{% render 'whatsapp-button', style: 'float'|'button'|'link'|'card', label: '…',
  message: '…', class: '' %}` → `https://wa.me/{{ digits }}?text={{ message | url_encode }}`,
  `target="_blank" rel="noopener"`; renders NOTHING when `settings.whatsapp_number` is blank (and the
  float style also requires `settings.whatsapp_float`).
* `pagination` — `{% render 'pagination', paginate: paginate, anchor: '' %}` numbered pagination.
* `meta-tags` — OG/Twitter.

### 6.5 JavaScript (`assets/global.js`) — public API
```js
MiBici.formatMoney(cents)                       // uses MiBici.moneyFormat; supports {{amount}}, {{amount_no_decimals}}, {{amount_with_comma_separator}}
MiBici.debounce(fn, ms)
MiBici.fetchJSON(url, opts)                     // throws Error(message) on !ok, with .status and .data
MiBici.announce(text)                           // writes to #A11yLive
MiBici.lockScroll() / MiBici.unlockScroll()     // ref-counted
MiBici.trapFocus(container) / MiBici.releaseFocus()
MiBici.parseHTML(html) -> Document
MiBici.cart.registerSection(sectionId)          // ids to request via `sections` on every cart call
MiBici.cart.add(formDataOrItems) -> Promise<{ items|item, sections, cart }>
MiBici.cart.change(lineKey, quantity) -> Promise<cart (with .sections)>
MiBici.cart.update(updatesObj, note?) -> Promise<cart>
MiBici.cart.get() -> Promise<cart>
```
Cart calls append `sections` (registered ids, comma-joined) and `sections_url: location.pathname`.
After every successful call, global.js dispatches on `document`:
* `cart:updated` — `detail: { cart, sections, source: 'add'|'change'|'update', lineKey? }`
  (for `add`, global.js fetches `/cart.js` to include the full `cart`).
* `cart:error` — `detail: { message, source }`.
Other events: `cart:open` (open the drawer; global.js navigates to `routes.cart` when `cartType` is
`page` or no drawer exists), `variant:change` (`detail: { sectionId, variant }`), `drawer:open` /
`drawer:close` (`detail: { id }`).
Global listeners in global.js: every `[data-cart-count]` gets `cart.item_count` (and `hidden` when
0); every `[data-free-shipping]` is recomputed; clicks on `[data-drawer-open="ID"]` open that
drawer, `[data-drawer-close]` closes the nearest drawer; `[data-cart-open]` dispatches `cart:open`.

Custom elements defined in global.js: `side-drawer` (open()/close()/toggle(), focus trap, ESC,
overlay click, scroll lock, returns focus to opener, dispatches drawer:open/close),
`quantity-input` (±, clamps min/max, dispatches `change` on the input), `product-form`
(intercepts the inner product form submit when `cartType === 'drawer'`; adds `.is-loading` +
`aria-busy` to the submit button; `MiBici.cart.add(new FormData(form))`; on success dispatches
`cart:updated` then `cart:open`; on error shows the message in `[data-form-error]` inside it and
dispatches `cart:error`; if the button has `data-redirect="checkout"` it goes to `/checkout` after
adding (for "Comprar ahora")).
`carousel.js` defines `carousel-slider`.

Section owners that need re-rendering on cart change call `MiBici.cart.registerSection(id)` in
their element's `connectedCallback` and listen to `cart:updated` to swap their inner HTML from
`detail.sections[id]` (parse with `MiBici.parseHTML`, replace a stable inner container).

## 7. Section-by-section brief

### Header group (H)
* `announcement-bar`: black by default (scheme select default `dark`), blocks `message` (text,
  optional link, optional `code` text shown as a dashed yellow "chip" → copies to clipboard on click
  with "¡Copiado!" feedback). Settings: `mode` marquee|rotate (default marquee), `speed` (range
  20–120 s per loop, default 40), separator dot (red). Marquee duplicates content for a seamless
  loop, pauses on hover/focus, static list under reduced motion. Mobile height ~36px.
* `header`: settings `scheme` (default light), `menu` (link_list, default main-menu), `sticky`
  (select always|on-scroll-up|none, default always), `show_search_bar` (checkbox true),
  `search_placeholder` text ("Busca por código, medida o nombre…"), `show_account` (true),
  `help_label` ("Ayuda") shown as a WhatsApp link when a number exists.
  Desktop ≥990 two rows: [logo | wide pill search | help · account · cart(count dot)] then a nav row
  (menu with dropdown panels for items with children; items with grandchildren → mega panel columns).
  Mobile: [hamburger | logo centered | search icon? no — cart], and a full-width pill search row
  underneath (collapses into the top row when scrolling down if sticky mode is on-scroll-up).
  Cart icon: `<a href="{{ routes.cart_url }}" data-cart-open>` with `<span class="cart-count"
  data-cart-count>` red dot count. Account icon links `routes.account_url`.
* `menu-drawer` (left side-drawer): menu levels as accordions/sliding panels, category icons next
  to top-level items when the item title matches a category (luces→light, llantas→tire,
  piñones→gear, espejos→mirror, componentes→seat, accesorios→bag, cascos→helmet, pedales→pedal,
  grips→grip, tapabarros→mudguard, rockbros/neco→medal); bottom area: account link, WhatsApp
  button (if number), social icons.
* `predictive-search` section (rendered via `?section_id=predictive-search`): products (image,
  title, price), collections, queries ("Buscar «q»" first row), "Ver todos los resultados (N)".
  `predictive-search.js`: `<predictive-search>` wraps each header search form; debounced 250ms fetch to
  `routes.predictive_search_url?q=…&resources[type]=product,collection,query&resources[limit]=6&section_id=predictive-search`;
  keyboard ↑↓ Enter Esc, `aria-expanded`, `role="listbox"`; closes on outside click.

### Cart (C)
* `cart-drawer` section (static, included by layout): `<cart-drawer>` extends/uses `side-drawer`
  (id `CartDrawer`, right). Content per the reference: header "Tu carrito" + count + close;
  free-shipping card (`free-shipping-bar`, style card, soft-yellow box, bike marker moving along a
  track); line items (image 88px rounded bordered, title link, variant option lines "Color: Gris"
  hiding "Default Title", unit price sale red + compare `<s>`, line discounts, qty stepper,
  "Eliminar" text button, line total); **upsell**: heading `settings.cart_upsell_heading`, 1–4
  products from the upsell collection excluding ones already in the cart, horizontal carousel of
  compact cards (image, title, price, compare, `.btn--brand .btn--sm` "Agregar" via `product-form`;
  multi-variant → "Ver opciones" link); footer: cart-level discounts ("Descuentos  − S/ x"),
  "Subtotal", `settings.cart_checkout_note`, big `.btn--brand .btn--lg .btn--block` "Finalizar pedido"
  (`name="checkout"` in a `form action=routes.cart_url method=post`), "Seguir comprando" (closes drawer),
  optional note. Empty state: bag icon, "Tu carrito está vacío", CTA "Explorar productos" →
  `routes.all_products_collection_url`, and category chips from main-menu top-level links.
  Registers section `cart-drawer`; on `cart:updated` replaces `.cart-drawer__inner`; opens on `cart:open`.
  Line qty change → `MiBici.cart.change(key, qty)` debounced 300ms, line gets `.is-loading`;
  errors shown inline.
* `main-cart` (cart page): two columns ≥990 (items | sticky summary card with free-shipping bar,
  totals, note, checkout button, trust icons (shield/truck/return with verified copy)), same line-item
  snippet, upsell below. Works without JS (`<form action="{{ routes.cart_url }}" method="post">`
  with `updates[]` inputs + "Actualizar" button in `<noscript>`).

### Product (P)
* `main-product` — layout ≥990: gallery 58% | info 42% (sticky info column). Gallery: vertical
  thumbnail rail on the left (desktop) + main image; mobile: swipeable `carousel-slider` with dots
  and a thumbnail row; click main image → lightbox modal (native `<dialog>`), zoom on hover desktop.
  Images use `--color-surface` bg + blend setting. Variant change swaps to the variant's featured media.
* Info blocks (all optional, reorderable): `breadcrumbs` (small, above title), `vendor`, `title`
  (h1), `rating`, `price` (lg; with "-NN%" pill and "Ahorras S/ X"), `badges`, `stock` (green dot
  "Disponible" / amber "¡Solo quedan N!" (deny policy only) / grey "Agotado"),
  `short_description` (first ~160 chars of description, strip_html, "Ver más" scrolls to the
  description accordion), `variant_picker` (color options → swatch buttons with the value name
  shown next to the option label "Color: Negro"; other options → pills; unavailable combos
  crossed-out but selectable; `picker_style` setting: auto|pills|dropdown), `buy_buttons`
  (qty stepper + `.btn--brand .btn--lg` "Agregar al carrito" in one row; below `.btn--ink`
  "Comprar ahora" (`data-redirect="checkout"`) — setting `show_buy_now` true; plus Shopify dynamic
  checkout `{{ form | payment_button }}` setting `show_dynamic_checkout` false by default),
  `free_shipping` (inline bar), `delivery_estimate` (settings-driven dates for Lima / Provincias,
  skip Sundays, optional cutoff countdown "Compra en las próximas 2 h 15 min…"; hidden when all
  days are 0), `pickup` (Shopify pickup availability), `whatsapp` ("¿Dudas con la medida o
  compatibilidad? Escríbenos" — hidden if no number), `trust` (3 icons: medal "Productos
  originales", truck "Envío gratis desde S/ 220", return "7 días para cambios"), `description`
  (accordion, open by default), `collapsible` (heading + richtext/page), `share` (copy link / native share),
  `custom_liquid`.
* `sticky-atc` (mobile & desktop after the main button scrolls out of view): thumbnail, title,
  price, and the add button submitting the main form (`form="product-form-{{ section.id }}"`).
* Variant logic in `product.js` (`<variant-picker>` / `<product-info>`): variants JSON in
  `<script type="application/json" data-product-json>`; on change update hidden `id`, price
  (`[data-price]` innerHTML rebuilt via `MiBici.formatMoney`), badges, stock text, button
  (Agregar / Agotado / No disponible), SKU, URL (`history.replaceState` `?variant=`), gallery,
  sticky bar; dispatch `variant:change`.
* `product-recommendations` section: settings `intent` (related|complementary), `heading`
  ("También te puede servir" / "Complétalo con"), `limit`; fetches
  `{{ routes.product_recommendations_url }}?section_id={{ section.id }}&product_id=…&limit=…&intent=…`
  and injects a carousel of product cards; renders nothing if empty.
* `templates/product.json`: breadcrumbs+main-product (blocks in the reference order), then
  `product-recommendations` complementary ("Complétalo con"), `usp-strip` (4 verified reasons),
  `product-recommendations` related ("También te puede servir").

### Collection & search (CO)
* `main-collection-banner`: soft-yellow (`scheme` default `soft`?) — use brand-soft background
  band: breadcrumbs, h1 with heading dot, description (rte, clamp 3 lines + "Leer más"),
  product count, collection image on the right in a rounded frame (or the category icon in a yellow
  circle + "mi" watermark when no image), sibling/sub-collection chips row (from the main-menu child
  links of the matching parent, else all top-level menu links) with the current one active.
* `main-collection`: sticky toolbar (Filtrar [count] button on mobile · results count · sort
  select), desktop left sidebar filters (≥990) with `details` groups; mobile filter `side-drawer`
  (left) with "Ver N productos" + "Limpiar". Storefront filters: list (checkbox list; `Color`
  filter values show swatches), price_range (two number inputs + min/max), boolean availability.
  Active filter chips row with remove "×" and "Limpiar todo". AJAX: on change → fetch
  `?{params}&section_id={{ section.id }}`, swap grid + filters + count, `history.replaceState`;
  without JS a submit button applies. Grid via `product-card`; products per page setting (default 24);
  "Cargar más" button (fetch next page and append; `aria-live` count "Mostrando 24 de 47") with
  `pagination` fallback in `<noscript>`. Empty state with "Limpiar filtros".
* `main-search`: big pill search form (prefilled), "N resultados para «q»", same filters/sort/grid
  (product results; pages/articles listed compactly below), empty state: suggestions chips
  (luces, llantas, espejos, asientos, pedales, piñones — setting) + WhatsApp card "¿No lo
  encuentras? Mándanos una foto" (hidden if no number).
* `main-list-collections`: grid of collection cards (image or icon on yellow, title, count).

### Home (HO)
* `hero-slideshow`: blocks `slide` (image, mobile image, eyebrow, heading, text, button 1 label/link
  (`.btn--primary` on brand panel = black), button 2 (outline), `layout` split|overlay,
  `panel_scheme` brand|dark|light, `image_position` right|left). Split layout ≥990: 45% text panel
  with huge display heading (Urbanist 900) + red heading dot + "mi" watermark bleeding off the
  corner; 55% image (cover). Mobile: image (4:3 crop) on top, panel below, compact. Autoplay
  setting (default on, 6s) with pause button, arrows ≥990, dots always. First slide image
  `priority: true`. Height: min(640px, 70vh) desktop.
* `search-hero`: "¿Qué repuesto necesitas?" band (scheme default brand yellow, watermark), big pill
  search input + button, chips (blocks `chip` term → link `routes.search_url?q=term&type=product`),
  optional WhatsApp line "Si no sabes cuál es, escríbenos con una foto." (link only if number).
* `category-grid`: heading "Compra por categoría"; blocks `category` (collection, optional custom
  title, `icon` select from the category icon names, optional image override). Circles 88px mobile
  (horizontal scroll row, ~4.3 visible) / 120px desktop (grid auto-fit, up to 10 per row): image
  in a circle with a yellow ring on hover, else yellow circle + black icon; title below; product
  count optional.
* `usp-strip`: blocks `item` (icon select: medal truck whatsapp shield return lock store clock card
  wrench bike; title; text; optional link). 2×2 on mobile (compact), 4 across ≥750, icons in yellow
  circles. `whatsapp`-icon items with a link setting of `whatsapp` are hidden when no number.
* `featured-collection`: heading + optional tabs: blocks `tab` (label, collection) — first tab
  default; with ≥2 tabs render a `role="tablist"` of chips and panels (all server-rendered; `home.js`
  switches). Carousel of product cards (`--per-view` 2.15 mobile, 3 @750, 4 @990, 5 @1200 setting),
  arrows, "Ver todo" link to the active tab's collection. Settings: products_to_show (4–16, default 10).
* `promo-banners`: 1–3 blocks `banner` (image, scheme brand|dark|light|soft, eyebrow, heading,
  text, button label/link, `image_style` cover|contain-right). Grid 1 col mobile, 2 cols ≥750
  (3 if 3 blocks ≥990). Rounded-lg cards, min-height 260/340, dot + watermark accents.
* `brand-marquee`: black band, blocks `brand` (name, optional logo image, link) scrolling
  continuously with red dot separators (static wrap under reduced motion). Heading optional.
* `image-with-text`: image left/right, eyebrow, heading, richtext, button; scheme select.
* `faq`: heading + blocks `question` (question, answer richtext) as accordions + FAQPage JSON-LD.
* `newsletter`: brand yellow band, heading, text, `{% form 'customer' %}` email + `contact[tags]`
  = newsletter, success/error messages, watermark.
* `rich-text`: eyebrow, heading, text, buttons, alignment, scheme.
* `templates/index.json` order & copy — see §9.

### Footer & pages (FP)
* `footer` (dark): top row: logo lockup `tone: light`, short text, social icons, WhatsApp card
  (if number). Link columns from blocks `menu` (link_list + heading), `text` (heading + richtext),
  `contact` (uses contact_* settings; renders only non-blank lines). Bottom bar: © year shop name,
  policies links (`shop.policies`), payment icons, "Hecho con ♥ en Lima"? (no — keep it clean:
  © + policies + payment icons). Mobile: columns become accordions.
* `main-404`: giant "404" with red dot + "Esta ruta no existe" + search form + category chips + CTA.
* `main-page` (h1 + rte), `contact-form` (name, email, phone, message; success state; uses
  `{% form 'contact' %}`), `main-blog` (article cards grid), `main-article`, `main-password`
  (yellow full screen, logo mark, heading "Estamos preparando algo", newsletter form, password
  form in a `<details>`), `custom-liquid`, `apps` (`@app` blocks).
* `templates/gift_card.liquid`: standalone HTML (brand styled), `gift_card.code` formatted, QR,
  "Agregar a Apple Wallet" when `gift_card.pass_url`.

## 8. Badge / stock / price rules (shared logic)
* On sale ⇔ `compare_at_price > price`. Save % = `(compare - price) * 100 / compare` rounded.
* Product-level sale badge uses `product.compare_at_price_max`/`price` of the best variant.
* Sold out ⇔ `product.available == false` (or variant.available == false for variant contexts).
* Low stock ⇔ `variant.inventory_management == 'shopify' and variant.inventory_policy == 'deny'
  and variant.inventory_quantity > 0 and variant.inventory_quantity <= 5`.

## 9. Homepage content (templates/index.json) — use exactly this copy (verified)
1. `hero-slideshow` (autoplay 6s):
   * "Luces y seguridad" / **"Que te vean de día y de noche"** / "Luces delanteras, posteriores y
     linternas para cada ruta." / "Ver luces" → `/collections/luces` / image
     `mibi-ia-luces-lima-anochecer.png` / panel brand.
   * "Llantas y cámaras" / **"Llantas para bici y scooter"** / "Macizas, antipinchazos y todo
     terreno. Encuentra tu medida." / "Ver llantas" → `/collections/llantas-y-camaras` / image
     `mibi-ia-llantas-scooter-lima.png` / panel dark.
   * "Cascos y protección" / **"Tu casco, tu mejor accesorio"** / "Cascos urbanos y MTB para rodar
     seguro." / "Ver cascos" → `/collections/cascos` / image `mibi-ia-cascos-lima.png` / panel brand.
2. `search-hero`: "¿Qué repuesto necesitas?" / "Busca por código, medida o nombre. Si no sabes
   cuál es, escríbenos con una foto." / placeholder "Ej.: llanta aro 26, luz trasera, piñón 9v…" /
   chips: luces, llantas, espejos, asientos, pedales, piñones.
3. `category-grid` "Compra por categoría": luces(light), llantas-y-camaras(tire),
   pinones-y-transmision(gear), espejos(mirror), asientos(seat), pedales(pedal), grips(grip),
   tapabarros(mudguard), cascos(helmet), accesorios(bag).
4. `usp-strip`: medal "Productos originales" / "Vendedor autorizado Rockbros" · truck "Envíos a
   todo el Perú" / "Gratis desde S/ 220" · whatsapp "Atención por WhatsApp" / "Consultas y pedidos
   por chat" · return "Cambios y garantía" / "7 días para cambiar, sin abrir".
5. `featured-collection` "Destacados": tabs Destacados (`destacados`), Luces (`luces`), Llantas
   (`llantas-y-camaras`), Pedales (`pedales`).
6. `promo-banners`: (dark) "Vendedor autorizado" / "Rockbros original" / "Luces, pedales y
   accesorios con respaldo de marca." / "Ver Rockbros" → `/collections/rockbros` (no image, big
   typographic + watermark) · (brand) "Para tu manubrio" / "Mira atrás sin girar el cuerpo" /
   "Espejos para bici y scooter." / "Ver espejos" → `/collections/espejos` / image `mibi-ia-espejos-lima.png`.
7. `featured-collection` "Luces para volver de noche" (no tabs, collection `luces`, scheme soft).
8. `brand-marquee` "Marcas que trabajamos": Rockbros, Neco, Wellgo, CIGNA, Nedong.
9. `image-with-text`: "Sobre Mi Bicicleta" / "Movilidad con personalidad" / "Seleccionamos
   accesorios y repuestos —desde cascos, luces y grips hasta asientos, pedales y tapabarros— que te
   den seguridad, confort y estilo en cada trayecto. Para ciclistas y para quienes se mueven en
   scooter por la ciudad." / "Ver todo el catálogo" → `/collections/all` / image `mibi-ia-asientos-lima.png`.
10. `faq` "Preguntas frecuentes": "¿Hacen envíos a provincias?" → "Sí. Enviamos a todo el Perú.
    El envío estándar cuesta S/ 14 y es gratis en pedidos desde S/ 220." · "¿Los productos son
    originales?" → "Sí. Somos vendedor autorizado Rockbros." · "¿Puedo cambiar un producto?" →
    "Sí, tienes 7 días para cambiarlo, siempre que el producto esté sin abrir." · "No sé qué
    repuesto le queda a mi bici o scooter" → "Escríbenos con una foto de la pieza o del modelo y te
    ayudamos a encontrar el repuesto correcto."
11. `newsletter` "Entérate de lo que llega" / "Déjanos tu correo y te avisamos cuando entre stock
    nuevo o haya una oferta. Sin spam."

Header group: announcement messages (marquee): "Envío gratis a todo el Perú desde S/ 220" ·
"Vendedor autorizado Rockbros: productos originales" · "¿Dudas con un repuesto? Escríbenos con
una foto" · "Cambios dentro de los 7 días (producto sin abrir)".
Footer: text "Accesorios y repuestos para bicicleta y scooter. Seguridad, confort y estilo en cada
trayecto." Menus: "Categorías" (main-menu), "Ayuda" (footer).

## 10. Preview harness (HA) contract
* `dev/preview/server.mjs` — `node server.mjs [--port 4173]` serves a local simulation of the
  storefront rendering the REAL theme files with liquidjs + Shopify shims and `dev/mock/store.json`:
  routes `/`, `/collections/:handle`, `/collections/all`, `/products/:handle`, `/search?q=`,
  `/cart`, `/pages/:handle`, `/404`, `/password`, `/collections` (list); `?section_id=` and
  `?sections=` (Section Rendering API); `/cart.js`, `/cart/add.js`, `/cart/change.js`,
  `/cart/update.js` (in-memory cart per server, JSON like Shopify, honoring `sections` param by
  rendering those sections with the updated cart); `/search/suggest` (+ `section_id`);
  `/recommendations/products` (+ `section_id`); `/assets/*` from `theme/assets`;
  product/collection images → local placeholder SVGs; `shopify://shop_images/*` → the brand
  photos in `dev/preview/.cache/img/`; Google Fonts `<link>` → `/_fonts/local.css` from
  `dev/preview/.cache/fonts/`.
* `dev/preview/shoot.mjs` — Playwright (`executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`)
  screenshots at 390×844 (mobile) and 1440×900 (desktop), full-page, for a page list + interaction
  states (cart drawer after add-to-cart, mobile menu open, predictive search open, mobile filter
  drawer open, product variant switched), saving `dev/screens/<name>-<vp>.png` and a
  `dev/screens/report.json` with console errors, failed requests, and Liquid render errors per page.

## 11. Locale keys
Each area writes `dev/locale-fragments/<nn>-<area>.json` with keys ONLY under its namespace(s):
F: `general.*`, `accessibility.*`, `products.card.*`, `products.price.*`, `products.badges.*`,
`cart.general.*` (strings used by global.js), `shipping.*`; H: `header.*`, `search.predictive.*`;
C: `cart.*` except `cart.general`; P: `products.product.*`; CO: `collections.*`, `search.results.*`,
`filters.*`; HO: `home.*`, `newsletter.*`; FP: `footer.*`, `pages.*`, `contact.*`, `blog.*`,
`password.*`, `gift_card.*`, `404.*` → use `not_found.*`.
Interpolation: `{{ 'cart.general.remaining' | t: amount: x }}` with `"… {{ amount }} …"` in JSON.
Pluralization: `{ "one": "…", "other": "…" }` + `count:`.
`node tools/merge-locales.mjs` merges into `theme/locales/es.default.json` (fails on conflicts).

## 12. Definition of done (each builder)
* Your files exist, are ≤ 16 KiB, Theme Check shows 0 errors for them (warnings reviewed).
* Your locale fragment contains every key you use.
* Mobile (390px) and desktop (1440px) layouts considered; no horizontal overflow at 360px.
* Final report: files written, contracts relied on, anything you could not do, assumptions.

## 13. Decisions recorded after the QA round (supersede the sections above)
* **Fonts (§6.1)**: Google Fonts load non-blocking (`preload` + `onload` swap + `<noscript>`) with
  metric-matched local fallbacks to avoid layout shift. See `dev/FOUNDATION_NOTES.md` §0.
* **Free-shipping amount token**: shopper-facing texts write `[envio_gratis]`; `usp-strip`, `faq`,
  `announcement-bar` and the product page replace it with `settings.free_shipping_threshold` as
  money and hide the text when the threshold is 0. Changing the threshold in Theme settings now
  updates every mention — no hand-edited "S/ 220" strings remain in shipped templates.
* **Cart note (§6.2)**: `cart_checkout_note` default is "El envío se calcula en el checkout."; the
  taxes line is rendered conditionally by `cart-totals` from the shop's tax setting.
* **`cart:updated` (§6.5)**: for `source: 'add'` global.js no longer fetches `/cart.js`; the event
  carries a partial cart built from the re-rendered sections' `data-cart-item-count` /
  `data-cart-total-price` attributes (one request per add instead of two).
* **Product trust tiles (§7)**: "Productos originales" · "Envíos a todo el Perú" (the amount lives
  in the free-shipping teaser right above) · "Cambios en 7 días, sin abrir".
* **Header**: the shipped header group uses sticky mode `on-scroll-up` (schema default stays
  `always`); sticky UI below it follows `--header-height`, which is 0 while the header is hidden.
* **Product recommendations**: the section no longer depends on `product` inside the
  `/recommendations/products` response (only `recommendations.performed?`), matching Shopify's
  documented contract; the harness now renders that endpoint without `product`.
* **Carousel semantics**: `<li>` slides inside list tracks keep list semantics; group/"diapositiva
  n de N" semantics apply only to `<div>` slide tracks (hero).
* **Open items for the account owner**: `theme_info` documentation/support URLs point to
  mibicicleta.pe until RDC Group provides real ones; the store's footer menu item "Contacto y
  showroom" implies a physical showroom (not a verified fact) and the linked pages
  `/pages/devoluciones` and `/pages/contacto` don't exist yet (only `/pages/contact`).
