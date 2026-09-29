// Color parsing/manipulation for Shopify's color_* filters and the `color` setting drop.
import { Drop } from 'liquidjs';

export function parseColor(input) {
  if (input === null || input === undefined) return null;
  if (input instanceof ColorDrop) return { ...input._c };
  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^#?([0-9a-f]{3,4})$/);
  if (m) {
    const [r, g, b, a] = m[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b, a: a === undefined ? 1 : a / 255 };
  }
  m = s.match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : parseAlpha(m[4]) };
  }
  m = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const { r, g, b } = hslToRgb(+m[1], +m[2], +m[3]);
    return { r, g, b, a: m[4] === undefined ? 1 : parseAlpha(m[4]) };
  }
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  return null;
}

function parseAlpha(v) {
  return v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100;
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: Math.round(f(h + 1 / 3) * 255), g: Math.round(f(h) * 255), b: Math.round(f(h - 1 / 3) * 255) };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hex2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
const fmtAlpha = (a) => String(Math.round(a * 100) / 100);

export function toHex(c) {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

/** Shopify returns hex for opaque colors and rgba() when alpha < 1. */
export function formatColor(c) {
  if (c.a < 1) return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${fmtAlpha(c.a)})`;
  return toHex(c);
}

export function toRgbString(c) {
  return c.a < 1
    ? `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${fmtAlpha(c.a)})`
    : `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}

export function toHslString(c) {
  const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
  const core = `${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%`;
  return c.a < 1 ? `hsla(${core}, ${fmtAlpha(c.a)})` : `hsl(${core})`;
}

export function brightness(c) {
  return (c.r * 299 + c.g * 587 + c.b * 114) / 1000;
}

function luminance(c) {
  const ch = [c.r, c.g, c.b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function modify(c, prop, value) {
  const v = Number(value);
  const out = { ...c };
  if (['red', 'green', 'blue'].includes(prop)) {
    out[prop[0]] = clamp(v, 0, 255);
    return out;
  }
  if (prop === 'alpha') { out.a = clamp(v, 0, 1); return out; }
  const hsl = rgbToHsl(c.r, c.g, c.b);
  if (prop === 'hue') hsl.h = clamp(v, 0, 360);
  if (prop === 'saturation') hsl.s = clamp(v, 0, 100);
  if (prop === 'lightness') hsl.l = clamp(v, 0, 100);
  return { ...hslToRgb(hsl.h, hsl.s, hsl.l), a: c.a };
}

export function adjustHsl(c, prop, delta) {
  const hsl = rgbToHsl(c.r, c.g, c.b);
  hsl[prop] = clamp(hsl[prop] + delta, 0, 100);
  return { ...hslToRgb(hsl.h, hsl.s, hsl.l), a: c.a };
}

export function mix(a, b, weightPct) {
  const w = clamp(Number(weightPct), 0, 100) / 100;
  return {
    r: a.r * w + b.r * (1 - w),
    g: a.g * w + b.g * (1 - w),
    b: a.b * w + b.b * (1 - w),
    a: a.a * w + b.a * (1 - w),
  };
}

/** The value of a `color` setting: prints as hex, exposes channel properties like Shopify. */
export class ColorDrop extends Drop {
  constructor(input) {
    super();
    this._c = parseColor(input) || { r: 0, g: 0, b: 0, a: 1 };
    this._raw = String(input);
  }
  get red() { return Math.round(this._c.r); }
  get green() { return Math.round(this._c.g); }
  get blue() { return Math.round(this._c.b); }
  get alpha() { return this._c.a; }
  get rgb() { return `${this.red} ${this.green} ${this.blue}`; }
  get rgba() { return `${this.red} ${this.green} ${this.blue} / ${fmtAlpha(this._c.a)}`; }
  get hue() { return Math.round(rgbToHsl(this._c.r, this._c.g, this._c.b).h); }
  get saturation() { return Math.round(rgbToHsl(this._c.r, this._c.g, this._c.b).s); }
  get lightness() { return Math.round(rgbToHsl(this._c.r, this._c.g, this._c.b).l); }
  equals(other) {
    const o = parseColor(other);
    return !!o && formatColor(o) === formatColor(this._c);
  }
  valueOf() { return formatColor(this._c); }
  toString() { return formatColor(this._c); }
  toJSON() { return formatColor(this._c); }
}
