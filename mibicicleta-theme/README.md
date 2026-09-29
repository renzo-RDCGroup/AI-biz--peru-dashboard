# Mi Bici 2026 — Shopify theme for mibicicleta.pe

Custom Online Store 2.0 theme built from the Mi Bicicleta brand manual (yellow `#FFD219`,
black, red dot; Urbanist + Libre Franklin as web stand-ins for All Round Gothic / Franklin Gothic).
Design contracts and every decision live in [`SPEC.md`](SPEC.md).

## Draft on the store

* Theme: **Mi Bici 2026 — Borrador (RDC Group)** · id `188689514740` · role **UNPUBLISHED**
  (created 2026-09-29 via `themeCreate`; the live theme "Sense + Mi Bicicleta" was not touched).
* Preview: https://mibicicleta.pe/?preview_theme_id=188689514740
* Theme editor: https://admin.shopify.com/store/u410yt-pf/themes/188689514740/editor
* Upload verified: 112/112 files present with checksums identical to `theme/`.

## Layout

```
theme/   the Shopify theme (what gets uploaded)
dev/     tooling — never uploaded
  tools/check.mjs         Shopify Theme Check (0 errors required)
  tools/sizes.mjs         16 KiB per-file budget (keeps MCP file patches safe)
  tools/strict-parse.rb   Shopify's own Ruby Liquid parser in strict mode (gem install liquid)
  tools/merge-locales.mjs locale fragments -> theme/locales/es.default.json
  tools/zip.mjs           runs the three gates above, then writes dev/dist/mibici-theme.zip
  preview/                local Shopify-Liquid simulator + mock AJAX APIs + Playwright shots
```

`cd dev && npm install && node preview/shoot.mjs` renders every page and interaction state at
390 px and 1440 px into `dev/screens/` (placeholders stand in for Shopify CDN images).

## Deploying a new draft

1. `cd dev && node tools/zip.mjs` (refuses to package if any gate fails).
2. Admin API `stagedUploadsCreate` (resource `FILE`, `application/zip`, `POST`), upload the zip
   to the returned target, then `themeCreate(source: resourceUrl, role: UNPUBLISHED)`.
3. Poll `theme(id)` until `processing: false`, and compare `files { checksumMd5 }` with local.

Small follow-up edits can go through `themeFilesUpsert` on the unpublished theme (one file per
call; files stay under 16 KiB for that reason).

## Lifestyle photography (2026-09-29)

12 AI-generated images (Higgsfield Soul 2.0; Peruvian riders in Lima using lights, helmets,
mirrors, saddles, pedals and scooter tyres) live in Shopify **Files** as `mibi26-*.png`, each with
Spanish alt text ending in "Imagen ilustrativa generada por IA.". They feed the hero slides, the
scooter promo, "Sobre Mi Bicicleta" and the new **Mosaico de categorías** section (2-3-2 photo
tiles with the brand-yellow gradient, modelled on the previous site's category grid). Any image
can be swapped in the theme editor; the originals stay in Files.

## WhatsApp product inquiries

No app or backend setup is needed — only the number. In the theme editor: *Configuración del
tema › Contacto y WhatsApp › Número* (e.g. `51987654321`; a 9-digit mobile gets `51` added).
Once set:
* every page shows a floating WhatsApp button (toggle "Botón flotante");
* on product pages the float reads "¿Dudas con este producto?" and, like the WhatsApp card in
  the buy box, opens a chat prefilled with the product name, selected option, code (SKU), price
  and a link to that exact variant — updated live when the shopper switches variants.
With the number blank, all WhatsApp UI stays hidden.

## Before publishing — needs the client / account owner

* **Delivery estimate** on product pages uses placeholder windows (Lima 1–3, provincias 3–7
  business days) — confirm or change in *Configuración del tema › Plazos de entrega*.
* **WhatsApp number** is blank, so every WhatsApp button/card is hidden; add it in
  *Configuración del tema › Contacto y WhatsApp* (digits with country code, e.g. 51987654321).
* The previous site advertised free shipping "a partir de 50 soles"; Shopify's shipping settings
  today give free shipping from **S/ 220**, and the theme follows the settings. If the offer is
  S/ 50, change it in *Settings › Shipping* and in *Configuración del tema › Carrito*.
* Store menus: footer links `/pages/devoluciones` and `/pages/contacto` don't exist yet (only
  `/pages/contact`), and "Contacto y showroom" implies a physical showroom — confirm or rename.
* "Complétalo con" (complementary products) stays hidden until complements are configured in
  the Search & Discovery app; "También te puede servir" works automatically.
* Ratings only appear once a reviews app writes the standard `reviews.rating` metafields.
* `theme_info` support/documentation URLs point to mibicicleta.pe until RDC Group provides its own.
