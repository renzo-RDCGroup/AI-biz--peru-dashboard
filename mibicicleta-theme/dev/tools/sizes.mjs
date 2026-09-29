// Size budget: every theme file must be <= 16 KiB (MCP themeFilesUpsert payloads were seen truncating ~18 KB).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../theme');
const LIMIT = 16384; let bad = 0; const rows = [];
for (const dir of fs.readdirSync(root)) {
  const d = path.join(root, dir); if (!fs.statSync(d).isDirectory()) continue;
  for (const f of fs.readdirSync(d)) { const s = fs.statSync(path.join(d, f)).size; rows.push([`${dir}/${f}`, s]); if (s > LIMIT) bad++; }
}
rows.sort((a, b) => b[1] - a[1]);
for (const [f, s] of rows) console.log(`${s > LIMIT ? 'OVER ' : '     '}${String(s).padStart(7)}  ${f}`);
console.log(`\n${rows.length} files, ${bad} over ${LIMIT} bytes.`); process.exit(bad ? 1 : 0);
