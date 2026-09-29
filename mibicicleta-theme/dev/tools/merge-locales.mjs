// Deep-merges dev/locale-fragments/*.json (sorted) into theme/locales/es.default.json. Fails on conflicting leaf values.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const fragDir = path.resolve(here, '../locale-fragments'); const out = path.resolve(here, '../../theme/locales/es.default.json');
const merged = {}; const conflicts = [];
function merge(dst, src, trail, file) {
  for (const [k, v] of Object.entries(src)) {
    const t = trail ? `${trail}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) { if (dst[k] !== undefined && typeof dst[k] !== 'object') conflicts.push(`${t} (${file})`); dst[k] ??= {}; merge(dst[k], v, t, file); }
    else { if (dst[k] !== undefined && dst[k] !== v) conflicts.push(`${t}: "${dst[k]}" vs "${v}" (${file})`); dst[k] = v; }
  }
}
for (const f of fs.readdirSync(fragDir).filter((f) => f.endsWith('.json')).sort()) merge(merged, JSON.parse(fs.readFileSync(path.join(fragDir, f), 'utf8')), '', f);
if (conflicts.length) { console.error('Locale conflicts:\n' + conflicts.join('\n')); process.exit(1); }
fs.writeFileSync(out, JSON.stringify(merged, null, 2) + '\n'); console.log('wrote', out, fs.statSync(out).size, 'bytes');
