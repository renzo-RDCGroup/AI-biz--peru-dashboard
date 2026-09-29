// Packages theme/ into dev/dist/mibici-theme.zip (theme folders at the zip root, as Shopify expects).
// Refuses to package if Theme Check reports errors or a file breaks the 16 KiB budget,
// so a broken theme never reaches the store.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const theme = path.resolve(here, '../../theme');
const dist = path.resolve(here, '../dist');
const out = path.join(dist, 'mibici-theme.zip');
const force = process.argv.includes('--force');

if (!force) {
  // strict-parse.rb uses Shopify's own Ruby Liquid parser: it catches templates that Theme Check
  // and the liquidjs preview accept but Shopify rejects on upload ("can't be parsed").
  const gates = [[process.execPath, 'check.mjs'], [process.execPath, 'sizes.mjs'], ['ruby', 'strict-parse.rb']];
  for (const [bin, tool] of gates) {
    try {
      execFileSync(bin, [path.join(here, tool)], { stdio: 'inherit' });
    } catch {
      console.error(`\n${tool} failed — fix it or pass --force.`);
      process.exit(1);
    }
  }
}

const allowed = ['assets', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates', 'blocks'];
const entries = fs.readdirSync(theme).filter((d) => allowed.includes(d));
fs.mkdirSync(dist, { recursive: true });
fs.rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', '-q', out, ...entries, '-x', '*.DS_Store'], { cwd: theme, stdio: 'inherit' });
const count = execFileSync('unzip', ['-Z1', out]).toString().trim().split('\n').filter((l) => !l.endsWith('/')).length;
console.log(`wrote ${out} (${fs.statSync(out).size} bytes, ${count} files)`);
