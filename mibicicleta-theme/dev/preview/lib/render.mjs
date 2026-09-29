// Section / group / template / layout rendering with Shopify's wrappers and ids.
import path from 'node:path';
import fs from 'node:fs';
import { describeError, errorBox } from './errors.mjs';
import { resolveSettings } from './settings.mjs';
import { fileNumber, groupSectionId, templateSectionId } from './theme.mjs';
import { escapeAttr } from './util.mjs';

const WRAPPER_TAGS = new Set(['article', 'aside', 'div', 'footer', 'header', 'section']);

function nonEnum(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: false });
  return obj;
}

/** "div#id.class[attr=val]" (JSON template `wrapper`) → [open, close] */
function parseWrapper(spec) {
  const m = String(spec).match(/^([a-z]+)((?:[#.][\w-]+)*)((?:\[[^\]]+\])*)$/i);
  if (!m || !['div', 'main', 'section'].includes(m[1])) return null;
  const id = (m[2].match(/#([\w-]+)/) || [])[1];
  const classes = [...m[2].matchAll(/\.([\w-]+)/g)].map((x) => x[1]);
  const attrs = [...m[3].matchAll(/\[([\w-]+)=?([^\]]*)\]/g)].map((x) => `${x[1]}="${escapeAttr(x[2])}"`);
  const parts = [m[1], id && `id="${id}"`, classes.length && `class="${classes.join(' ')}"`, ...attrs].filter(Boolean);
  return [`<${parts.join(' ')}>`, `</${m[1]}>`];
}

export class Renderer {
  constructor(app) {
    this.app = app;
    this.theme = app.theme;
    this.engine = app.engine;
  }

  /** Render a theme file; syntax errors become a red box (recorded). */
  async renderFile(w, rel, scope = {}) {
    let templates;
    try {
      templates = this.engine.parseTheme(rel);
    } catch (e) {
      const info = describeError(e);
      if (!info.file) info.file = rel;
      w.errors.error(info.message, info);
      return errorBox(`Liquid syntax error in ${info.file}${info.line ? ` line ${info.line}` : ''}`, info.message);
    }
    try {
      return await this.engine.render(w, templates, scope);
    } catch (e) {
      const info = describeError(e);
      if (!info.file) info.file = rel;
      w.errors.error(info.message, info);
      return errorBox(`Liquid error in ${info.file}`, info.message);
    }
  }

  async renderLiquidSetting(w, src, scope, label) {
    try {
      const templates = this.engine.parseString(String(src), label);
      return await this.engine.render(w, templates, scope);
    } catch (e) {
      const info = describeError(e);
      info.file = info.file || label;
      w.errors.error(info.message, info);
      return '';
    }
  }

  // -------------------------------------------------------------------------
  // Sections

  /**
   * inst: { id, type, settings, blocks, block_order, location, index, groupClass, source }
   */
  async renderSection(w, inst) {
    const rel = `sections/${inst.type}.liquid`;
    const wrap = (html, schema = {}) => {
      const tag = WRAPPER_TAGS.has(schema.tag) ? schema.tag : 'div';
      const cls = ['shopify-section', inst.groupClass, schema.class].filter(Boolean).join(' ');
      return `<${tag} id="shopify-section-${inst.id}" class="${escapeAttr(cls)}">${html}</${tag}>`;
    };
    if (String(inst.type).startsWith('shopify://apps') || inst.type === '@app') {
      w.errors.warn(`App section "${inst.type}" skipped (apps are not available in the preview)`, { file: inst.source });
      return '';
    }
    if (!this.theme.exists(rel)) {
      w.errors.error(`Section file not found: ${rel} (section "${inst.id}")`, { file: inst.source || rel });
      return wrap(errorBox(`Missing section file ${rel}`, `Referenced by ${inst.source || 'layout'} as "${inst.id}".`));
    }
    const { schema, error } = this.theme.schemaOf(rel);
    if (error) w.errors.error(error, { file: rel });
    const sch = schema || {};
    const { settings, liquidKeys } = resolveSettings(w, sch.settings, inst.settings);

    const blocks = [];
    const rawBlocks = inst.blocks && typeof inst.blocks === 'object' ? inst.blocks : {};
    const order = Array.isArray(inst.block_order) ? inst.block_order : Object.keys(rawBlocks);
    const blockSchemas = Array.isArray(sch.blocks) ? sch.blocks : [];
    const acceptsThemeBlocks = blockSchemas.some((b) => b.type === '@theme');
    for (const id of order) {
      const b = rawBlocks[id];
      if (!b || b.disabled) continue;
      if (b.type === '@app' || String(b.type).startsWith('shopify://apps')) continue;
      let bs = blockSchemas.find((x) => x.type === b.type);
      if (!bs && (acceptsThemeBlocks || this.theme.exists(`blocks/${b.type}.liquid`))) {
        bs = this.theme.schemaOf(`blocks/${b.type}.liquid`).schema;
      }
      if (!bs) w.errors.warn(`Block type "${b.type}" is not defined in the schema of ${rel} (Shopify rejects it)`, { file: inst.source || rel });
      const r = resolveSettings(w, bs?.settings, b.settings);
      const block = { id, type: b.type, settings: r.settings, shopify_attributes: '' };
      nonEnum(block, '__liquidKeys', r.liquidKeys);
      nonEnum(block, '__raw', b);
      blocks.push(block);
    }

    const section = {
      id: inst.id,
      settings,
      blocks,
      block_order: blocks.map((b) => b.id),
      location: inst.location || 'template',
      index: inst.index ?? null,
      index0: inst.index ? inst.index - 1 : null,
    };

    // `liquid` settings are rendered (Shopify evaluates them with section/block in scope).
    for (const key of liquidKeys) {
      settings[key] = await this.renderLiquidSetting(w, settings[key], { section }, `${rel} › settings.${key}`);
    }
    for (const block of blocks) {
      for (const key of block.__liquidKeys) {
        block.settings[key] = await this.renderLiquidSetting(w, block.settings[key], { section, block }, `${rel} › block ${block.id}.${key}`);
      }
    }

    w.sectionStack.push(section);
    let html;
    try {
      html = await this.renderFile(w, rel, { section });
    } finally {
      w.sectionStack.pop();
    }
    return wrap(html, sch);
  }

  staticInstance(name) {
    const { current } = this.theme.settingsData();
    const stored = current.sections?.[name] || {};
    return {
      id: name,
      type: stored.type || name,
      settings: stored.settings || {},
      blocks: stored.blocks || {},
      block_order: stored.block_order,
      location: 'static',
      index: null,
      source: 'layout',
    };
  }

  async renderStatic(w, name) {
    return this.renderSection(w, this.staticInstance(name));
  }

  groupData(w, groupName) {
    const rel = `sections/${groupName}.json`;
    const r = this.theme.json(rel);
    if (r.missing) {
      w.errors.error(`Section group not found: ${rel}`, { file: rel });
      return null;
    }
    if (r.error) {
      w.errors.error(r.error, { file: rel });
      return null;
    }
    return r.value || {};
  }

  groupInstances(groupName, data) {
    const file = `${groupName}.json`;
    const sections = data.sections || {};
    const order = Array.isArray(data.order) ? data.order : Object.keys(sections);
    const out = [];
    let index = 0;
    for (const key of order) {
      const s = sections[key];
      if (!s || s.disabled) continue;
      index++;
      out.push({
        id: groupSectionId(file, key),
        key,
        type: s.type,
        settings: s.settings,
        blocks: s.blocks,
        block_order: s.block_order,
        location: data.type || groupName,
        index,
        groupClass: `shopify-section-group-${groupName}`,
        source: `sections/${file}`,
      });
    }
    return out;
  }

  async renderGroup(w, groupName) {
    const data = this.groupData(w, groupName);
    if (!data) return errorBox(`Missing section group sections/${groupName}.json`);
    let html = `<!-- BEGIN sections: ${groupName} -->`;
    for (const inst of this.groupInstances(groupName, data)) html += await this.renderSection(w, inst);
    return `${html}<!-- END sections: ${groupName} -->`;
  }

  // -------------------------------------------------------------------------
  // Templates

  templateInstances(tplFile, data, source) {
    const sections = data.sections || {};
    const order = Array.isArray(data.order) ? data.order : Object.keys(sections);
    const out = [];
    let index = 0;
    for (const key of order) {
      const s = sections[key];
      if (!s || s.disabled) continue;
      index++;
      out.push({
        id: templateSectionId(tplFile, key),
        key,
        type: s.type,
        settings: s.settings,
        blocks: s.blocks,
        block_order: s.block_order,
        location: 'template',
        index,
        source,
      });
    }
    return out;
  }

  /** → { content, layout } for the current route. */
  async renderContent(w) {
    const route = w.route;
    let layout = route.template === 'password' ? 'password' : 'theme';
    if (route.rawContent !== undefined) return { content: route.rawContent, layout };
    if (route.fixture) {
      let content;
      try {
        content = await this.engine.render(w, this.engine.parseAbs(route.fixture, `fixtures/${path.basename(route.fixture)}`), {});
      } catch (e) {
        const info = describeError(e);
        w.errors.error(info.message, info);
        content = errorBox('Fixture failed to render', info.message);
      }
      return { content, layout: w.layoutOverride === undefined ? layout : w.layoutOverride };
    }
    const tpl = this.theme.findTemplate(route.template, route.suffix);
    if (!tpl) {
      const want = `templates/${route.template}${route.suffix ? `.${route.suffix}` : ''}.json`;
      w.errors.error(`Template not found: ${want}`, { file: want });
      return { content: errorBox(`Missing template ${want}`, 'The theme does not define this template yet.'), layout };
    }
    w.templateFile = tpl.rel;
    if (tpl.kind === 'json') {
      const r = this.theme.json(tpl.rel);
      if (r.error) {
        w.errors.error(r.error, { file: tpl.rel });
        return { content: errorBox(`Invalid JSON template ${tpl.rel}`, r.error), layout };
      }
      const data = r.value || {};
      if ('layout' in data) layout = data.layout === false ? null : data.layout;
      let content = '';
      for (const inst of this.templateInstances(tpl.file, data, tpl.rel)) content += await this.renderSection(w, inst);
      if (data.wrapper) {
        const wrap = parseWrapper(data.wrapper);
        if (wrap) content = wrap[0] + content + wrap[1];
        else w.errors.warn(`Unsupported template wrapper "${data.wrapper}"`, { file: tpl.rel });
      }
      return { content, layout };
    }
    const content = await this.renderFile(w, tpl.rel, {});
    if (w.layoutOverride !== undefined) layout = w.layoutOverride;
    return { content, layout };
  }

  async renderPage(w) {
    const { content, layout } = await this.renderContent(w);
    if (layout === null || layout === 'none' || layout === false) return content;
    w.globals.content_for_layout = content;
    const rel = `layout/${layout}.liquid`;
    if (!this.theme.exists(rel)) {
      w.errors.error(`Layout not found: ${rel}`, { file: rel });
      return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeAttr(w.globals.page_title)}</title>${w.globals.content_for_header}</head><body>${errorBox(`Missing layout ${rel}`, 'Rendering content_for_layout without a layout.')}${content}</body></html>`;
    }
    return this.renderFile(w, rel, {});
  }

  // -------------------------------------------------------------------------
  // Section Rendering API

  /** Resolve a section id (template--N__key, sections--N__key, or a static file name). */
  findSection(w, id) {
    let m = String(id).match(/^template--(\d+)__(.+)$/);
    if (m) {
      const [, num, key] = m;
      const candidates = [];
      const current = w.templateFile || (this.theme.findTemplate(w.route.template, w.route.suffix)?.rel);
      for (const rel of this.theme.jsonTemplates()) {
        const file = rel.replace(/^templates\//, '');
        const score = String(fileNumber(file)) === num ? 2 : rel === current ? 1 : 0;
        candidates.push({ rel, file, score });
      }
      candidates.sort((a, b) => b.score - a.score);
      for (const c of candidates) {
        const data = this.theme.json(c.rel).value;
        if (data?.sections?.[key]) {
          const inst = this.templateInstances(c.file, data, c.rel).find((x) => x.key === key);
          if (inst) return { ...inst, id };
        }
      }
      return null;
    }
    m = String(id).match(/^sections--(\d+)__(.+)$/);
    if (m) {
      const [, num, key] = m;
      const groups = this.theme.groupFiles().map((f) => ({ f, score: String(fileNumber(f)) === num ? 1 : 0 })).sort((a, b) => b.score - a.score);
      for (const { f } of groups) {
        const data = this.theme.json(`sections/${f}`).value;
        if (data?.sections?.[key]) {
          const inst = this.groupInstances(f.replace(/\.json$/, ''), data).find((x) => x.key === key);
          if (inst) return { ...inst, id };
        }
      }
      return null;
    }
    if (/^[\w-]+$/.test(id) && this.theme.exists(`sections/${id}.liquid`)) return this.staticInstance(id);
    return null;
  }

  async renderSectionById(w, id) {
    const inst = this.findSection(w, id);
    if (!inst) {
      w.errors.warn(`Section Rendering API: section "${id}" not found`, {});
      return null;
    }
    return this.renderSection(w, inst);
  }

  // -------------------------------------------------------------------------
  // Theme blocks ({% content_for 'blocks' %} / {% content_for 'block', type:, id: %})

  async renderContentFor(w, kind, args, section) {
    if (kind === 'blocks') {
      if (!section) return '';
      let out = '';
      for (const block of section.blocks || []) {
        const rel = `blocks/${block.type}.liquid`;
        if (!this.theme.exists(rel)) continue;
        out += `<div class="shopify-block" id="shopify-block-${escapeAttr(block.id)}">${await this.renderFile(w, rel, { section, block })}</div>`;
      }
      return out;
    }
    if (kind === 'block') {
      const rel = `blocks/${args.type}.liquid`;
      if (!this.theme.exists(rel)) {
        w.errors.error(`content_for 'block': ${rel} not found`, {});
        return '';
      }
      const { schema } = this.theme.schemaOf(rel);
      const { settings } = resolveSettings(w, schema?.settings, {});
      const block = { id: args.id || args.type, type: args.type, settings, shopify_attributes: '' };
      return `<div class="shopify-block" id="shopify-block-${escapeAttr(block.id)}">${await this.renderFile(w, rel, { section, block })}</div>`;
    }
    w.errors.warn(`content_for '${kind}' is not supported by the preview`, {});
    return '';
  }
}

export function fixtureExists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}
