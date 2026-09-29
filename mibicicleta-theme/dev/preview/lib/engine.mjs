// The Shopify-flavoured liquidjs engine: one Liquid instance per theme, a parse cache keyed by
// file mtime, snippet lookup in snippets/, and Shopify-like error handling — a failing tag/output
// prints "Liquid error (file line N): …" in place and rendering continues (the error is recorded).
import fs from 'node:fs';
import { Context, Liquid, toValue } from 'liquidjs';
import { describeError, liquidErrorText } from './errors.mjs';
import { escapeHtml } from './util.mjs';
import { worldOf } from './world.mjs';
import { registerTags } from './tags.mjs';
import { registerFilters } from './filters.mjs';

// Blocks whose body Shopify treats as raw text (never tokenized as Liquid).
const RAW_BLOCKS = /(\{%-?\s*(schema|javascript|stylesheet|doc)\b[^%]*-?%\})([\s\S]*?)(\{%-?\s*end\2\s*-?%\})/g;

function blankRawBlocks(src) {
  return src.replace(RAW_BLOCKS, (_, open, _name, body, close) => open + body.replace(/[^\n]/g, ' ') + close);
}

function stringify(v) {
  v = toValue(v);
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(stringify).join('');
  return String(v);
}

class BufferEmitter {
  constructor() { this.buffer = ''; }
  write(html) { this.buffer += stringify(html); }
}

/**
 * Align blank/empty/nil comparisons with Ruby Liquid:
 * - a bare `blank`/`empty` used as a *value* (e.g. `render 'x', product: blank`) evaluates to '' in Ruby,
 *   so `product == blank` is true inside the snippet; liquidjs passes its BlankDrop through → patch
 *   blank/empty literals to compare equal to themselves.
 * - `assign x = nil` → `x == blank` is true in Ruby (nil.blank?).
 */
let blankPatched = false;
function patchBlankLiteral(liquid) {
  if (blankPatched) return;
  blankPatched = true;
  const blank = liquid.evalValueSync('blank', {});
  const BlankProto = Object.getPrototypeOf(blank);
  const EmptyClass = Object.getPrototypeOf(BlankProto).constructor;
  for (const proto of [BlankProto, EmptyClass.prototype]) {
    const original = proto.equals;
    proto.equals = function equals(value) {
      if (value instanceof EmptyClass) return true;
      return original.call(this, value);
    };
  }
  // `assign x = nil` stores liquidjs' NullDrop; Ruby treats nil as blank (nil == blank → true).
  const NullProto = Object.getPrototypeOf(liquid.evalValueSync('nil', {}));
  const nullEquals = NullProto.equals;
  NullProto.equals = function equals(value) {
    if (value instanceof BlankProto.constructor) return true;
    return nullEquals.call(this, value);
  };
}

/**
 * Unset top-level variables named like Liquid's magic properties (`size`, `first`, `last`) must be
 * nil, as on Shopify. liquidjs resolves an unknown root variable by reading it as a property of the
 * globals object, so `{{ size }}` became the number of globals (≈37) and `{% if size %}` was true in
 * every snippet rendered without a `size:` argument.
 */
let magicRootPatched = false;
function patchMagicRootVariables() {
  if (magicRootPatched) return;
  magicRootPatched = true;
  const MAGIC = new Set(['size', 'first', 'last']);
  const original = Context.prototype._get;
  Context.prototype._get = function* _get(paths) {
    const key = paths && paths[0];
    if (typeof key === 'string' && MAGIC.has(key)) {
      const scope = this.findScope(key);
      if (!(scope && key in Object(scope))) return undefined;
    }
    return yield* original.call(this, paths);
  };
}

export class Engine {
  constructor(app) {
    this.app = app;
    this.theme = app.theme;
    this.cache = new Map();
    this.liquid = new Liquid({
      ownPropertyOnly: false,
      strictFilters: false,
      strictVariables: false,
      lenientIf: true,
      dynamicPartials: true,
      jsTruthy: false,
      cache: false,
      locale: 'es', // Shopify's es locale: "septiembre" (es-PE Intl would give "Setiembre")
      timezoneOffset: 300, // America/Lima (UTC-5)
    });
    const engine = this;
    // {% render 'x' %} / {% include 'x' %} → snippets/x.liquid (missing → error at the call site)
    this.liquid._parsePartialFile = function parsePartial(file) {
      const rel = `snippets/${String(file).replace(/\.liquid$/, '')}.liquid`;
      if (!engine.theme.exists(rel)) throw new Error(`Could not find asset ${rel}`);
      return engine.parseTheme(rel);
    };
    this.liquid._parseLayoutFile = function parseLayout(file) {
      return engine.parseTheme(`layout/${file}.liquid`);
    };
    this.patchRenderer();
    patchBlankLiteral(this.liquid);
    patchMagicRootVariables();
    registerTags(this);
    registerFilters(this);
    this.installUnknownFilterFallback();
  }

  /** Parse a theme-relative file (cached by mtime). Throws on syntax errors. */
  parseTheme(rel) {
    const st = this.theme.stat(rel);
    if (!st) throw new Error(`Could not find asset ${rel}`);
    return this.parseCached(`theme:${rel}`, `${st.mtimeMs}:${st.size}`, () => this.theme.read(rel), rel);
  }

  /** Parse an absolute path outside the theme (fixtures). */
  parseAbs(absPath, displayName) {
    const st = fs.statSync(absPath);
    return this.parseCached(`abs:${absPath}`, `${st.mtimeMs}:${st.size}`, () => fs.readFileSync(absPath, 'utf8'), displayName);
  }

  parseString(src, displayName) {
    return this.liquid.parse(blankRawBlocks(src), displayName);
  }

  parseCached(key, sig, read, displayName) {
    const hit = this.cache.get(key);
    if (hit && hit.sig === sig) {
      if (hit.error) throw hit.error;
      return hit.templates;
    }
    try {
      const templates = this.liquid.parse(blankRawBlocks(read()), displayName);
      this.cache.set(key, { sig, templates });
      return templates;
    } catch (error) {
      this.cache.set(key, { sig, error });
      throw error;
    }
  }

  /** Render parsed templates with Shopify globals of `world` and a local scope. */
  render(world, templates, scope = {}) {
    return this.liquid.render(templates, scope, { globals: world.globals });
  }

  patchRenderer() {
    const renderer = this.liquid.renderer;
    const original = renderer.renderTemplates.bind(renderer);
    renderer.renderTemplates = function* renderTemplates(templates, ctx, emitter) {
      if (!emitter) emitter = new BufferEmitter();
      for (const tpl of templates) {
        try {
          yield original([tpl], ctx, emitter);
        } catch (e) {
          const w = worldOf(ctx);
          if (!w || e?.previewPassThrough) throw e;
          const info = describeError(e, tpl.token);
          w.errors.error(info.message, info);
          emitter.write(escapeHtml(liquidErrorText(info)));
        }
        if (ctx.breakCalled || ctx.continueCalled) break;
      }
      return emitter.buffer;
    };
  }

  /** Unknown filters pass the input through and are reported as warnings. */
  installUnknownFilterFallback() {
    const target = this.liquid.filters;
    const unknown = new Map();
    this.liquid.filters = new Proxy(target, {
      get(t, name) {
        if (typeof name !== 'string' || name in t) return t[name];
        if (!unknown.has(name)) {
          unknown.set(name, function unknownFilter(input) {
            const w = worldOf(this.context);
            if (w) {
              const loc = describeError({ message: '' }, this.token);
              w.errors.warn(`Unknown filter "${name}" (input passed through)`, loc);
            }
            return input;
          });
        }
        return unknown.get(name);
      },
    });
  }
}
