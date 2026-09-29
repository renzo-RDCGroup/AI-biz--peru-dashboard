# Preview harness (`dev/preview/`)

Renders the **real** Shopify Online Store 2.0 theme in `theme/` with mock data
(`dev/mock/store.json`) on a local server, so designers and builders can screenshot and debug
pages without Shopify. The container can't reach Shopify storefronts or `cdn.shopify.com`:
images, fonts and apps are replaced locally, and there's no network access at render time.

It's a simulation, not Shopify. Liquid runs on [liquidjs] with Shopify tags, filters, objects and
error behaviour added on top. `node tools/check.mjs` (Theme Check) is still the upload gate.

[liquidjs]: https://liquidjs.com

## Quick start

```bash
cd dev
node preview/server.mjs --port 4173          # http://127.0.0.1:4173
node preview/shoot.mjs                       # all pages + states → dev/screens/*.png + report.json
node preview/shoot.mjs --pages home,product,cart-drawer --vp mobile
node preview/selftest.mjs                    # engine self-test (fixture theme) + real-theme smoke test
```

The server re-reads theme files whenever they change (parse caches are keyed by mtime), so you
don't need to restart it.

| server flag | default | |
|---|---|---|
| `--port` | 4173 | |
| `--theme <dir>` | `theme/` | any OS 2.0 theme directory |
| `--mock <file>` | `dev/mock/store.json` | |
| `--host` | 127.0.0.1 | |
| `--quiet` | off | no per-request log lines |

## Routes

| Path | Template / behaviour |
|---|---|
| `/` | `index` |
| `/collections` | `list-collections` |
| `/collections/:handle` (`all` included) | `collection`. Filters and sort come from the query (see below) |
| `/collections/:handle/:tag[+tag]` | `collection` with `current_tags` |
| `/collections/vendors?q=` · `/collections/types?q=` | virtual vendor/type collection |
| `/products/:handle[?variant=ID \| ?option_values=ids]` | `product` (also `/collections/:c/products/:p`) |
| `/products/:handle.js` / `.json` | AJAX product JSON |
| `/search?q=&type=` | `search` (products, pages, articles; filters and sort for products) |
| `/cart` | `cart` (`POST /cart` handles `updates[]`, `note`, and `checkout` → `/checkout`) |
| `/pages/:handle` | `page`. Uses `page.<handle>` when that template exists (so `/pages/contact` → `page.contact.json`) |
| `/blogs/:blog`, `/blogs/:blog/:article`, `/blogs/:blog/tagged/:tag` | `blog` / `article`. The mock has one empty blog, `news` |
| `/policies/:handle` | placeholder policy inside the layout |
| `/password` | `password` template with `layout/password.liquid` |
| `/404` and any unknown path | `404` template, **HTTP 404** |
| `/_styleguide` | `fixtures/styleguide.liquid` inside `layout/theme.liquid`: the living style guide (brand, colour, type, buttons per scheme, forms, badges/chips, prices/rating, swatches, quantity, free-shipping bar, accordion, section headings, product-card carousel + grid, drawers, WhatsApp, icon set, pagination/breadcrumbs/payment/social) |
| `/checkout`, `/account/*` | plain placeholder pages. Shopify hosts these |
| any page `?view=x` | alternate template `<name>.x.(json\|liquid)` |

### Section Rendering API (any page)
* `?section_id=ID` returns the section HTML, wrapped exactly like Shopify:
  `<div id="shopify-section-ID" class="shopify-section …">`.
* `?sections=a,b` returns a JSON map `{ "a": "<div …>", "b": null }`. Unknown ids map to `null`.
  Like Shopify, at most 5 ids are rendered; extra ids are dropped and logged as a warning.
* IDs:
  * template sections: `template--<n>__<key>`
  * section-group sections: `sections--<n>__<key>`
  * static sections: the file name (`cart-drawer`, `predictive-search`)
  * `<n>` is a stable 8-digit number derived from the template or group file name. See
    `templateSectionId()` / `groupSectionId()` in `lib/theme.mjs`.
  * Lookup is lenient: if the number doesn't match any file, the key is searched in the current
    page's template first, then in every template.
* Any `sections/<name>.liquid` file can be rendered by name (it uses its schema defaults, or
  `settings_data.json › current.sections[name]`).

### AJAX Cart API (in-memory, one cart per server)
`GET /cart.js`. `POST /cart/add.js | change.js | update.js | clear.js` accept JSON, urlencoded or
multipart `FormData`, including Rails-style keys (`items[0][id]`, `updates[KEY]`, `properties[x]`).
The same paths without `.js` return JSON when the request is AJAX (`Accept: application/json`, XHR,
or a JSON body). Plain form posts redirect to `/cart` instead.

* `add`:
  * `{id, quantity}` returns the line item.
  * `{items:[…]}` returns `{items:[…]}`.
  * Unknown, sold-out and over-stock variants (`deny` policy) return
    **422** `{status, message, description}`.
* `change`: `{id: key|variantId}` or `{line}` plus `quantity` (`0` removes the line). Returns the cart.
* `update`: `{updates: {id|key: qty} | [qty…], note, attributes}`. Returns the cart.
* All four accept `sections` (comma list or array) and `sections_url`. The response then gains
  `sections: {id: html}`, rendered with the updated cart in the context of `sections_url`
  (falling back to the Referer, then `/`).

### Search, recommendations
* `/search/suggest(.json)?q=&resources[type]=product,collection,query&resources[limit]=6`
  returns Shopify's predictive JSON. With `&section_id=predictive-search` it renders that section
  with a `predictive_search` object instead.
* `/recommendations/products(.json)?product_id=&limit=&intent=related|complementary[&section_id=]`
  * `related`: products sharing collections with the source product.
  * `complementary`: products of a different product type.
  * The section renders in a deliberately minimal context, because Shopify only documents the
    `recommendations` object for this endpoint: `recommendations.performed?` (and Dawn's
    `performed` alias) is true, but the `product` global is **nil** and `request.page_type` is
    `recommendations`, not `product`. A section that gates its response on `product` renders
    empty here, just as it may on the live store.
  * Everywhere else (page renders, plain `?section_id=` / `?sections=` requests) `performed?` is
    false, `products` is empty and `intent` is nil, like Shopify.

### Static
* `/assets/*` is served from `theme/assets`. `x.css.liquid` is rendered and served as `x.css`.
* `/_img/…` is a generated placeholder:
  * product images (`cdn.shopify.com` URLs in the mock) become an SVG with a soft `#F5F5F2`
    background, a product-type icon, the title and `n/N`.
  * `shopify://shop_images/*` and collection images become a 16:9 wrapper around a stand-in brand
    photo from `.cache/img/`.
  * `width`, `height` and `crop` are honoured.
* The Google Fonts `<link>` is rewritten at serve time to `/_fonts/local.css`, backed by the
  cached woff2 files in `.cache/fonts/`.
* Any leftover `cdn.shopify.com` URL in the HTML or JSON is mapped to `/_img/…`. Nothing else is
  injected.
* `{% stylesheet %}` / `{% javascript %}` contents are bundled to `/_compiled/styles.css|scripts.js`
  and linked from `content_for_header`, like Shopify's compiled assets.

### Debug / harness endpoints and query params
| | |
|---|---|
| `GET /__errors?since=SEQ[&path=/x][&kind=error\|warning][&clear=1]` | render errors/warnings (global, sequence-numbered) |
| `GET\|POST /__reset[?cart=vid:qty,vid:qty][&errors=1]` | empty (or seed) the cart; optionally clear the error log |
| `GET /__health` | `{ ok, theme, seq }` |
| any page `?__cart=vid:qty,vid:qty` | replace the cart before rendering (`?__cart=` empties it) |
| any page `?__form=posted\|errors[&__form_type=contact]` | simulate `form.posted_successfully?` / `form.errors` |
| any page `?__settings=id:value,id2:value2` | override theme settings for this request (typed by the schema), e.g. `whatsapp_number:51900000000`, `cart_type:page`, `corner_style:square`, `heading_dot:false`. Not carried over to later AJAX requests |
| `?contact_posted=true` / `?customer_posted=true` | what Shopify appends after contact/newsletter posts (`POST /contact` redirects with them) |

Every HTML/section response carries `X-Render-Errors` / `X-Render-Warnings` counts. The server
log prints `· N render issue(s)` for each request.

## Preview-only fixture products

`fixtures/products.json` adds products (same shape as `dev/mock/store.json`, `metafields` allowed)
that are reachable by handle and id — `all_products['sg-…']`, `/products/sg-…`, the AJAX cart — but
are **never listed**: not in any collection, `collections.all`, search, predictive search,
recommendations or counts, so page screenshots keep matching the real catalog sample. They cover
states the sample lacks:

| handle | state |
|---|---|
| `sg-luz-delantera-agotada` | fully sold out (single variant, `deny`, stock 0) |
| `sg-grips-ergonomicos-modelos` | 3 `Modelo` variants at two prices ("Desde"), one sold out, one low stock (4, deny), tags `nuevo` + `mas-vendido`, demo `reviews.rating` 4.6 (32) — dev only, the theme never fabricates ratings |

Mock metafields: a product's `metafields: { namespace: { key: { type, value } } }` in the mock or
fixture JSON is exposed as `product.metafields.namespace.key.value`.

## Liquid engine (what is emulated)

`lib/engine.mjs` (liquidjs instance, parse cache, error handling), `lib/tags.mjs`,
`lib/filters.mjs`, `lib/drops.mjs`, `lib/settings.mjs`, `lib/render.mjs` (sections, groups,
templates, layouts), `lib/world.mjs` (per-request globals), `lib/facets.mjs` (filters and sort),
`lib/cart.mjs`, `lib/images.mjs`, `lib/http.mjs`, `lib/app.mjs` (routes).

* **Errors behave like Shopify.**
  * A failing tag or output prints `Liquid error (file line N): message` in place and rendering
    continues.
  * Syntax errors, missing section files and invalid JSON become a visible red box.
  * Missing snippets are reported at the `render` call site.
  * Everything is recorded with file and line.
  * Unknown filters pass their input through and log a *warning*.
  * Missing translations render the key and log an *error*.
* **Unset root variables** named `size`, `first` or `last` are nil, as on Shopify (liquidjs would otherwise read
  them as properties of the globals object: `{{ size }}` → 37).
* **`render` isolation.** Snippets see only their parameters plus Shopify globals (`shop`,
  `settings`, `product`, `cart`, …). `section`/`block` are *not* visible in snippets unless passed.
  `with x as y`, `for arr as x` (with `forloop`) and `key: value` all work. `include` shares scope.
* **Tags:**
  * `schema`, `stylesheet`, `javascript` and `doc` are raw and produce no output. Their bodies are
    never parsed as Liquid.
  * `style` renders `<style data-shopify>`.
  * `section`, `sections` (groups, with BEGIN/END comments), `layout` (`none` or a name),
    `content_for` (theme blocks).
  * `form` for every form type, with Shopify's attribute order and hidden inputs. Product forms
    append `product-id` and `section-id`.
  * `paginate` covers `collection.products`, `search.results`, `blog.articles`, `collections` and
    arbitrary arrays. `paginate.parts` uses Shopify's windowing (page parts have integer `title`s,
    so `part.title == paginate.current_page` works), and snippets see the paginated drop.
  * `liquid`, `comment`, `raw`, `#`.
* **Ruby-Liquid details:**
  * `divided_by` floors integers (`7 | divided_by: 2` → `3`; `2.0` forces float division).
  * `nil == blank`, and `blank` passed as a value compares equal to `blank`.
  * The `json` filter escapes `< > &` as `<…`.
  * `image_tag` builds `srcset` from Shopify's default widths below the requested width (or from
    `widths:`, capped at the original size).
  * `t` escapes interpolated values unless the key ends in `_html`, and pluralizes with `count:`.
* **Settings:**
  * Schema defaults are merged with `settings_data.json › current` (comments stripped). Keys
    without a schema entry are ignored, as on Shopify, with a warning.
  * JSON templates may start with `/* … */`.
  * Section and block settings resolve by type:
    * `image_picker` → image
    * `collection`, `product`, `link_list`, `page`, `blog` → drops
    * `*_list` → arrays
    * `color` → color drop
    * `url` → `shopify://collections/x` becomes `/collections/x`
    * `liquid` → rendered with `section`/`block`
    * blank → `nil`, checkbox → boolean
* **Storefront filters.**
  * `filter.v.availability` (boolean, "Disponible"/"Agotado"), `filter.v.price.gte/lte`
    (`price_range`), `filter.p.vendor`, `filter.p.product_type` and `filter.v.option.color`
    (`presentation: swatch`, colors from the Spanish color words).
  * Variant-level filters must match the same variant.
  * Counts are facet counts: all other active filters apply.
  * `url_to_add` / `url_to_remove` drop `page`.
* **Sorting:** `manual` (catalog order), `best-selling` (a stable pseudo order), `title-*`,
  `price-*` (by min variant price), `created-*`; search also has `relevance`.

## Screenshots (`shoot.mjs`)

```
node preview/shoot.mjs [--port 4180] [--no-server] [--theme <dir>] [--pages a,b] [--vp mobile,desktop]
                       [--out dir] [--no-full] [--no-states] [--strict] [--timeout ms]
```

* By default it starts its own server on **4180**, so it doesn't clash with a dev server on 4173.
  If a preview server already answers on `--port`, it is reused (so `--port 4200` works whether or
  not you started one). `--no-server` never starts one.
* `--settings id:value,…` appends `?__settings=…` to every captured URL (see debug params).
* Viewports:
  * mobile: 390×844, `isMobile`, touch, DPR 1
  * desktop: 1440×900
* For every capture it:
  * resets the cart,
  * loads the page in a fresh browser context (es-PE, America/Lima),
  * waits for network idle,
  * injects CSS that zeroes animation and transition durations,
  * waits for `document.fonts.ready`,
  * scrolls through the page so lazy images and `data-reveal` content render,
  * stops autoplaying `carousel-slider`s on their first slide (deterministic captures),
  * takes a full-page screenshot (`--no-full` for viewport only).
* Interaction states are captured viewport-sized.
* `--pages` accepts page names and state names. `--strict` exits 1 when any capture has console
  errors, page errors or Liquid errors.

### Page catalog
| name | URL |
|---|---|
| home | `/` |
| collection | `/collections/luces` |
| collection-all | `/collections/all` |
| collection-filtered | `/collections/all?filter.p.vendor=Rockbros&sort_by=price-ascending` |
| product | `/products/linterna-multifuncional-m29` (sale, single variant) |
| product-color | `/products/lentes-deportivos-tornasolado-hm-l1-hm-l1` (Color option, 4 variants) |
| product-soldout | `/products/casco-open-face-mt-33g2`: first variant sold out (deny policy), others 3/12/5 in stock and no images, so this is a *partially* sold-out product |
| product-agotado | `/products/sg-luz-delantera-agotada` (fixture: fully sold out) |
| product-modelos | `/products/sg-grips-ergonomicos-modelos` (fixture: `Modelo` pills, "Desde" price, low stock, one sold-out variant, Nuevo + Más vendido, demo rating) |
| search | `/search?q=luz` |
| search-empty | `/search?q=zzzz` |
| cart | `/cart` seeded with linterna ×1 + lentes Negro ×2 |
| cart-empty | `/cart` |
| list-collections | `/collections` |
| page | `/pages/contact` |
| 404 | `/nope` |
| password | `/password` |
| styleguide | `/_styleguide` |

### Interaction states
| name | viewports | how |
|---|---|---|
| cart-drawer | mobile, desktop | product page → click the first visible `[name="add"]` submit → wait for `side-drawer#CartDrawer[open]` / `.cart-drawer[open]` |
| cart-drawer-empty | mobile, desktop | `/` → `document.dispatchEvent(new CustomEvent('cart:open'))` → wait for the drawer |
| menu-drawer | mobile | `/` → click the first visible `[data-drawer-open]` in `.shopify-section-group-header-group` → wait for `side-drawer[open]` |
| predictive | mobile, desktop | `/` → type `luz` into the header search input → wait 800 ms (reached only when results appear) |
| filters-drawer | mobile | `/collections/luces` → click `main [data-drawer-open]` → wait for `side-drawer[open]` |
| variant-switch | mobile, desktop | product-color → click the label of the 2nd radio in `main variant-picker`/`fieldset` (falls back to `[data-option-value]` buttons or a `select`). The URL after the click is recorded |

When a state can't be reached (a selector is missing or it times out), no screenshot is saved and
the report says why (`reached: false, reason`).

### Report (`<out>/report.json`)
`{ generatedAt, base, viewports, summary, pages: [...] }`. Each entry has:

* `name`, `vp`, `url`, `kind` (`page` or `state`), `status`, `file` (relative to `report.json`),
  `path` (absolute)
* `consoleErrors`, `consoleWarnings`, `pageErrors`
* `failedRequests` (≥ 400 or network failures; favicon ignored; "Failed to load resource"
  console noise folded in here)
* `renderErrors`, `renderWarnings` (server-side Liquid issues, with file and line)
* `overflow` (mobile only): `{scrollWidth, innerWidth, overflowing, hasViewportMeta, offenders[]}`.
  Offenders are the elements sticking out past 390 px that no ancestor clips.
* `reached`, `reason`, `urlAfter` for states

## Known limitations
* No theme editor: `request.design_mode` is always false, `shopify_attributes` is empty, there are
  no app blocks or app embeds, and `@app` blocks and sections are skipped with a warning.
* Checkout and customer accounts are placeholders.
* The data model is fixed:
  * `customer` is always nil
  * no discounts, selling plans, gift cards, unit prices or pickup availability
  * metafields are nil unless added to the mock / fixture products
  * `product_option_value.swatch` is nil (no native swatches)
* Images are placeholders:
  * product images: 1600×1600, alt = product title
  * shop and collection images: 2048×1152
  * stand-in photos are not the real AI images
  * `media` contains only images
* Search is accent- and case-insensitive substring AND-matching over title, vendor, type, tags,
  SKU and description. That's close to Shopify but not identical (no stemming: `luz` doesn't find
  `luces`).
* Complementary recommendations are a heuristic. On Shopify they're empty until Search &
  Discovery is configured, and the section should render nothing then.
* Only the cached Urbanist and Libre Franklin faces exist offline:
  * `font_picker` fonts resolve to `local()`
  * Adobe Fonts (`use.typekit.net`) fail to load
* The blog is empty (`/blogs/news`). Policies are placeholder text.
* liquidjs isn't Ruby Liquid:
  * floats print as `3` rather than `3.0`
  * `render` accepts a variable file name
  * some templates Shopify rejects at upload (e.g. schema validation, >25-char names) still
    render here. Run Theme Check.
* Select values and range steps from `settings_data.json` aren't validated.
* `shop.url` is the local origin. `shop.enabled_payment_types` is a fixed list
  (visa/master/amex/diners).
* `content_for_header` contains only a minimal `window.Shopify` bootstrap (shop, locale,
  currency, country, `routes.root`) plus compiled section assets. There's no analytics, no
  `Shopify.designMode` and no app scripts.

## Self-test
`node preview/selftest.mjs` boots the server on `selftest/theme` (a tiny fixture theme: layout,
section group, static section, sections with schemas, JSON templates, snippets, locale), then
asserts:

* render params and isolation
* settings defaults and resolution, block order
* money (`S/ 33.00`), `t` interpolation, escaping and plurals
* `image_url` / `image_tag`
* form markup, paginate, collection filters and sort
* Section Rendering API
* cart add/change/update/clear with `sections`, and 422 errors
* predictive search, recommendations
* 404 status, password layout, `layout none`
* blank/nil semantics, error boxes, static endpoints

It then runs `shoot.mjs` on the fixture theme, which has a tiny header, drawers and JS. This
checks every interaction state end to end: browser → AJAX cart with FormData → `sections`
re-render → drawer open, plus the predictive fetch and `?variant=` URL updates. Pass
`--no-browser` to skip this step, or `--keep` to keep the screenshots.

Finally it loads the main routes against the real theme to check nothing crashes. Exit code 1 on
any failure.
