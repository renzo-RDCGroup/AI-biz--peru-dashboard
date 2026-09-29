// In-memory cart (one per server) with Shopify AJAX Cart API semantics.
import { md5, toInt } from './util.mjs';

function cartError(description, status = 422) {
  return { ok: false, status, body: { status, message: 'Cart Error', description } };
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export class Cart {
  constructor(store) {
    this.store = store;
    this.reset();
  }

  reset() {
    this.lines = [];
    this.note = '';
    this.attributes = {};
    this.token = `preview-${Date.now().toString(36)}`;
  }

  static keyFor(variantId, properties) {
    const props = properties && Object.keys(properties).length ? JSON.stringify(properties) : '';
    return `${variantId}:${md5(props)}`;
  }

  /** Max quantity allowed for a variant (deny policy + tracked inventory → stock). */
  maxFor(variant) {
    if (variant.inventory_management === 'shopify' && variant.inventory_policy === 'deny') {
      return Math.max(0, variant.inventory_quantity);
    }
    return Infinity;
  }

  /** "vid:qty,vid:qty" (used by ?__cart= and /__reset?cart=) */
  seed(spec) {
    this.reset();
    const items = String(spec || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [id, qty] = s.split(':');
      return { id, quantity: toInt(qty, 1) };
    });
    if (items.length) this.addItems(items, { force: true });
  }

  findLine(idOrKey) {
    const s = String(idOrKey);
    if (s.includes(':')) return this.lines.find((l) => l.key === s) || null;
    return this.lines.find((l) => String(l.variantId) === s) || null;
  }

  addItems(items, { force = false } = {}) {
    if (!Array.isArray(items) || !items.length) return cartError('No se especificaron productos.', 422);
    // Validate everything first (Shopify is all-or-nothing for add.js).
    const plan = [];
    for (const item of items) {
      const hit = this.store.variant(item.id);
      if (!hit) return cartError('No se puede encontrar la variante.', 422);
      const { variant, product } = hit;
      const qty = Math.max(1, toInt(item.quantity, 1));
      const properties = item.properties && typeof item.properties === 'object' ? item.properties : {};
      if (!variant.available && !force) return cartError(`El producto '${product.title}' ya está agotado.`, 422);
      const key = Cart.keyFor(variant.id, properties);
      const existing = this.lines.find((l) => l.key === key);
      const already = (existing?.quantity || 0) + plan.filter((p) => p.key === key).reduce((s, p) => s + p.qty, 0);
      const max = this.maxFor(variant);
      if (!force && already + qty > max) {
        return cartError(max - already <= 0
          ? `No puedes agregar más '${product.title}' al carrito.`
          : `Solo puedes agregar ${max} de '${product.title}' al carrito.`, 422);
      }
      plan.push({ key, variant, qty, properties });
    }
    const touched = [];
    for (const p of plan) {
      let line = this.lines.find((l) => l.key === p.key);
      if (line) line.quantity += p.qty;
      else {
        line = { key: p.key, variantId: p.variant.id, quantity: p.qty, properties: p.properties };
        this.lines.push(line);
      }
      if (!touched.includes(line)) touched.push(line);
    }
    return { ok: true, lines: touched };
  }

  /** /cart/change.js: { id: key|variantId, line: 1-based, quantity, properties } */
  change({ id, line, quantity, properties }) {
    let target = null;
    if (line !== undefined && line !== null && line !== '') target = this.lines[toInt(line) - 1] || null;
    else if (id !== undefined && id !== null && id !== '') target = this.findLine(id);
    if (!target) {
      return cartError('No se encontró el producto en el carrito. Especifica un id o line válido.', 400);
    }
    if (properties && typeof properties === 'object') target.properties = properties;
    if (quantity === undefined || quantity === null || quantity === '') return { ok: true };
    const qty = Math.max(0, toInt(quantity, 0));
    if (qty === 0) {
      this.lines = this.lines.filter((l) => l !== target);
      return { ok: true };
    }
    const hit = this.store.variant(target.variantId);
    const max = hit ? this.maxFor(hit.variant) : Infinity;
    if (qty > max) {
      const res = cartError(`Solo puedes agregar ${max} de '${hit.product.title}' al carrito.`, 422);
      res.body.errors = res.body.description;
      return res;
    }
    target.quantity = qty;
    return { ok: true };
  }

  /** /cart/update.js: updates as {idOrKey: qty} or [qty, qty] (line order) */
  update({ updates, note, attributes }) {
    if (Array.isArray(updates)) {
      const lines = [...this.lines];
      updates.forEach((q, i) => { if (lines[i]) this.setQuantity(lines[i], q); });
    } else if (updates && typeof updates === 'object') {
      for (const [idOrKey, q] of Object.entries(updates)) {
        const existing = this.findLine(idOrKey);
        if (existing) this.setQuantity(existing, q);
        else if (toInt(q) > 0) {
          const r = this.addItems([{ id: idOrKey, quantity: q }]);
          if (!r.ok) return r;
        }
      }
    }
    if (note !== undefined && note !== null) this.note = String(note);
    if (attributes && typeof attributes === 'object') Object.assign(this.attributes, attributes);
    return { ok: true };
  }

  setQuantity(line, q) {
    const qty = Math.max(0, toInt(q, 0));
    if (qty === 0) this.lines = this.lines.filter((l) => l !== line);
    else {
      const hit = this.store.variant(line.variantId);
      line.quantity = hit ? Math.min(qty, this.maxFor(hit.variant)) : qty;
    }
  }

  clear() {
    this.lines = [];
    this.note = '';
    this.attributes = {};
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Views

  resolvedLines() {
    return this.lines.map((l) => {
      const hit = this.store.variant(l.variantId);
      return hit ? { ...l, variant: hit.variant, product: hit.product } : null;
    }).filter(Boolean);
  }

  totals() {
    const lines = this.resolvedLines();
    const total = lines.reduce((s, l) => s + l.variant.price * l.quantity, 0);
    return {
      lines,
      item_count: lines.reduce((s, l) => s + l.quantity, 0),
      total_price: total,
      requires_shipping: lines.some((l) => l.variant.requires_shipping),
      total_weight: lines.reduce((s, l) => s + (l.variant.weight || 0) * l.quantity, 0),
    };
  }

  lineJson(l) {
    const { variant, product } = l;
    const isDefault = product.options.length === 1 && product.options[0].name === 'Title' && variant.title === 'Default Title';
    const img = (variant.image_position && product.images[variant.image_position - 1]) || product.images[0] || null;
    const linePrice = variant.price * l.quantity;
    return {
      id: variant.id,
      properties: l.properties || {},
      quantity: l.quantity,
      variant_id: variant.id,
      key: l.key,
      title: isDefault ? product.title : `${product.title} - ${variant.title}`,
      price: variant.price,
      original_price: variant.price,
      presentment_price: variant.price / 100,
      discounted_price: variant.price,
      line_price: linePrice,
      original_line_price: linePrice,
      total_discount: 0,
      discounts: [],
      sku: variant.sku || null,
      grams: variant.weight || 0,
      vendor: product.vendor,
      taxable: variant.taxable,
      product_id: product.id,
      product_has_only_default_variant: isDefault,
      gift_card: false,
      final_price: variant.price,
      final_line_price: linePrice,
      url: `/products/${product.handle}?variant=${variant.id}`,
      featured_image: img ? { aspect_ratio: img.width / img.height, alt: product.title, height: img.height, url: img.src, width: img.width } : null,
      image: img ? img.src : null,
      handle: product.handle,
      requires_shipping: variant.requires_shipping,
      product_type: product.product_type,
      product_title: product.title,
      product_description: stripTags(product.description),
      variant_title: isDefault ? null : variant.title,
      variant_options: variant.options,
      options_with_values: product.options.map((o, i) => ({ name: o.name, value: variant.options[i] })),
      line_level_discount_allocations: [],
      line_level_total_discount: 0,
      quantity_rule: { min: 1, max: null, increment: 1 },
      has_components: false,
    };
  }

  json() {
    const t = this.totals();
    return {
      token: this.token,
      note: this.note,
      attributes: this.attributes,
      original_total_price: t.total_price,
      total_price: t.total_price,
      total_discount: 0,
      total_weight: t.total_weight,
      item_count: t.item_count,
      items: t.lines.map((l) => this.lineJson(l)),
      requires_shipping: t.requires_shipping,
      currency: this.store.shop.currency || 'PEN',
      items_subtotal_price: t.total_price,
      cart_level_discount_applications: [],
    };
  }
}
