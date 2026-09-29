// Theme Check runner. Usage: node tools/check.mjs [pathPrefixFilter ...] [--json]
// Prints offenses grouped by file. Exit code 1 if any ERROR-severity offense (in the filtered set).
import { check } from '@shopify/theme-check-node';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../theme');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const filters = args.filter((a) => !a.startsWith('--'));
const sev = ['ERROR', 'WARNING', 'INFO'];
const offenses = (await check(root)).map((o) => ({
  file: path.relative(root, o.uri.replace('file://', '')),
  check: o.check, severity: sev[o.severity] ?? o.severity,
  line: (o.start?.line ?? 0) + 1, message: o.message,
})).filter((o) => !filters.length || filters.some((f) => o.file.startsWith(f)));
if (asJson) { console.log(JSON.stringify(offenses, null, 1)); }
else {
  const byFile = {};
  for (const o of offenses) (byFile[o.file] ??= []).push(o);
  for (const [f, list] of Object.entries(byFile).sort()) {
    console.log(`\n${f}`);
    for (const o of list) console.log(`  ${o.severity.padEnd(7)} L${o.line} [${o.check}] ${o.message}`);
  }
  const errs = offenses.filter((o) => o.severity === 'ERROR').length;
  console.log(`\n${offenses.length} offense(s), ${errs} error(s).`);
}
process.exit(offenses.some((o) => o.severity === 'ERROR') ? 1 : 0);
