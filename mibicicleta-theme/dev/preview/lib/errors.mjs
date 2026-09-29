// Render-error bookkeeping. Every request gets its own list (deduplicated), and every entry
// is also appended to a global, sequence-numbered log that shoot.mjs polls via /__errors.
import { escapeHtml } from './util.mjs';

export class ErrorLog {
  constructor(limit = 10000) {
    this.limit = limit;
    this.seq = 0;
    this.entries = [];
  }

  add(entry) {
    const e = { seq: ++this.seq, time: new Date().toISOString(), ...entry };
    this.entries.push(e);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    return e;
  }

  query({ since = 0, path = null, kind = null } = {}) {
    return this.entries.filter((e) =>
      e.seq > since &&
      (!path || e.path === path || e.url === path) &&
      (!kind || e.kind === kind));
  }

  clear() {
    this.entries = [];
  }
}

/** Collects errors for one request; mirrors them into the global log. */
export class RequestErrors {
  constructor(log, url) {
    this.log = log;
    this.url = url;
    this.path = (() => { try { return new URL(url, 'http://x').pathname; } catch { return url; } })();
    this.list = [];
    this.index = new Map();
  }

  add(kind, message, { file = null, line = null, col = null } = {}) {
    const key = `${kind}|${file}|${line}|${message}`;
    const existing = this.index.get(key);
    if (existing) { existing.count++; return existing; }
    const entry = { kind, message: String(message), file, line, col, count: 1 };
    this.index.set(key, entry);
    this.list.push(entry);
    this.log?.add({ ...entry, url: this.url, path: this.path });
    return entry;
  }

  error(message, loc) { return this.add('error', message, loc); }
  warn(message, loc) { return this.add('warning', message, loc); }

  get errorCount() { return this.list.filter((e) => e.kind === 'error').length; }
  get warningCount() { return this.list.filter((e) => e.kind === 'warning').length; }
}

/** Pull a readable message + location out of a liquidjs error (or any Error). */
export function describeError(err, fallbackToken = null) {
  const token = err?.token || fallbackToken || null;
  let message = err?.originalError?.message || err?.message || String(err);
  // liquidjs appends ", file:x, line:1, col:2" — keep the bare message; location is separate.
  message = message.replace(/(, file:[^,]*)?, line:\d+, col:\d+$/, '');
  let line = null;
  let col = null;
  try {
    if (token?.getPosition) [line, col] = token.getPosition();
  } catch { /* ignore */ }
  const file = token?.file || null;
  return { message, file, line, col };
}

export function liquidErrorText({ message, file, line }) {
  const where = file ? ` (${file}${line ? ` line ${line}` : ''})` : '';
  return `Liquid error${where}: ${message}`;
}

/** Visible red box used when a whole section (or template) fails. */
export function errorBox(title, detail = '') {
  return `<div class="preview-render-error" data-preview-error style="box-sizing:border-box;margin:12px;padding:14px 16px;border:2px solid #d10000;border-radius:10px;background:#fff0f0;color:#8a0000;font:14px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;">`
    + `<strong style="display:block;margin-bottom:4px;">${escapeHtml(title)}</strong>${escapeHtml(detail)}</div>`;
}
