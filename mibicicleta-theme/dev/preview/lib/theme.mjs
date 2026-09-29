// Read-only access to a Shopify theme directory. Everything is re-read when the file's mtime
// changes, because other people edit the theme while the server runs.
import fs from 'node:fs';
import path from 'node:path';
import { hashInt, parseJsonLoose } from './util.mjs';

const SCHEMA_RE = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;
const STYLESHEET_RE = /\{%-?\s*stylesheet(?:\s+[^%]*)?-?%\}([\s\S]*?)\{%-?\s*endstylesheet\s*-?%\}/g;
const JAVASCRIPT_RE = /\{%-?\s*javascript\s*-?%\}([\s\S]*?)\{%-?\s*endjavascript\s*-?%\}/g;

export class Theme {
  constructor(root) {
    this.root = path.resolve(root);
    this.memo = new Map();
  }

  abs(rel) {
    const p = path.resolve(this.root, rel);
    if (!p.startsWith(this.root + path.sep) && p !== this.root) throw new Error(`path escapes theme: ${rel}`);
    return p;
  }

  stat(rel) {
    try {
      const s = fs.statSync(this.abs(rel));
      return s.isFile() ? s : null;
    } catch {
      return null;
    }
  }

  exists(rel) {
    return !!this.stat(rel);
  }

  read(rel) {
    try {
      return fs.readFileSync(this.abs(rel), 'utf8');
    } catch {
      return null;
    }
  }

  readBuffer(rel) {
    try {
      return fs.readFileSync(this.abs(rel));
    } catch {
      return null;
    }
  }

  list(dir, ext = null) {
    try {
      return fs.readdirSync(this.abs(dir)).filter((f) => !ext || f.endsWith(ext)).sort();
    } catch {
      return [];
    }
  }

  /** Memoize fn(text) by file + mtime + size. */
  cached(rel, key, fn) {
    const st = this.stat(rel);
    const sig = st ? `${st.mtimeMs}:${st.size}` : 'missing';
    const memoKey = `${key}:${rel}`;
    const hit = this.memo.get(memoKey);
    if (hit && hit.sig === sig) return hit.value;
    const value = fn(st ? this.read(rel) : null);
    this.memo.set(memoKey, { sig, value });
    return value;
  }

  /** { value, error, missing } for a (comment-tolerant) JSON file. */
  json(rel) {
    return this.cached(rel, 'json', (text) => {
      if (text === null) return { value: null, missing: true };
      try {
        return { value: parseJsonLoose(text) };
      } catch (e) {
        return { value: null, error: `Invalid JSON in ${rel}: ${e.message}` };
      }
    });
  }

  /** Parsed {% schema %} of a section/block file → { schema, error }. */
  schemaOf(rel) {
    return this.cached(rel, 'schema', (text) => {
      if (text === null) return { schema: null, missing: true };
      const m = text.match(SCHEMA_RE);
      if (!m) return { schema: {} };
      try {
        return { schema: JSON.parse(m[1]) || {} };
      } catch (e) {
        return { schema: {}, error: `Invalid JSON in {% schema %} of ${rel}: ${e.message}` };
      }
    });
  }

  settingsSchema() {
    const r = this.json('config/settings_schema.json');
    return { schema: Array.isArray(r.value) ? r.value : [], error: r.error, missing: r.missing };
  }

  /** settings_data.json → { current: {...}, error } (current may reference a preset by name). */
  settingsData() {
    const r = this.json('config/settings_data.json');
    const data = r.value || {};
    let current = data.current;
    if (typeof current === 'string') current = data.presets?.[current] || {};
    return { current: current || {}, error: r.error, missing: r.missing };
  }

  /** Default storefront locale (es.default.json preferred, then any *.default.json). */
  locale() {
    const files = this.list('locales', '.json').filter((f) => !f.includes('.schema.'));
    const file = files.includes('es.default.json') ? 'es.default.json'
      : files.find((f) => f.endsWith('.default.json')) || files.find((f) => f.startsWith('es')) || null;
    if (!file) return { data: {}, file: null, missing: true };
    const r = this.json(`locales/${file}`);
    return { data: r.value || {}, file: `locales/${file}`, error: r.error };
  }

  /** Locate templates/<name>[.<suffix>].(json|liquid). JSON wins, like Shopify. */
  findTemplate(name, suffix = null) {
    const bases = suffix ? [`${name}.${suffix}`, name] : [name];
    for (const base of bases) {
      for (const ext of ['json', 'liquid']) {
        const rel = `templates/${base}.${ext}`;
        if (this.exists(rel)) {
          return { rel, kind: ext, file: `${base}.${ext}`, name, suffix: base === name ? null : suffix };
        }
      }
    }
    return null;
  }

  /** All JSON templates (recursively incl. customers/). */
  jsonTemplates() {
    const out = [];
    for (const f of this.list('templates', '.json')) out.push(`templates/${f}`);
    for (const f of this.list('templates/customers', '.json')) out.push(`templates/customers/${f}`);
    return out;
  }

  /** Section group files: sections/*.json */
  groupFiles() {
    return this.list('sections', '.json');
  }

  /** {% stylesheet %} / {% javascript %} contents across sections, blocks and snippets. */
  compiledAssets() {
    const dirs = ['sections', 'blocks', 'snippets'];
    const sig = dirs.map((d) => this.list(d, '.liquid').map((f) => {
      const st = this.stat(`${d}/${f}`);
      return `${f}:${st?.mtimeMs}`;
    }).join(',')).join('|');
    const hit = this.memo.get('compiled');
    if (hit && hit.sig === sig) return hit.value;
    let css = '';
    let js = '';
    for (const d of dirs) {
      for (const f of this.list(d, '.liquid')) {
        const text = this.read(`${d}/${f}`) || '';
        for (const m of text.matchAll(STYLESHEET_RE)) css += `/* ${d}/${f} */\n${m[1].trim()}\n`;
        for (const m of text.matchAll(JAVASCRIPT_RE)) js += `/* ${d}/${f} */\n(function(){\n${m[1].trim()}\n})();\n`;
      }
    }
    const value = { css, js };
    this.memo.set('compiled', { sig, value });
    return value;
  }
}

/** Stable numeric part of section ids: template--<n>__key / sections--<n>__key. */
export function fileNumber(file) {
  return 10000000 + (hashInt(file) % 89999999);
}

export function templateSectionId(templateFile, key) {
  return `template--${fileNumber(templateFile)}__${key}`;
}

export function groupSectionId(groupFile, key) {
  return `sections--${fileNumber(groupFile)}__${key}`;
}
