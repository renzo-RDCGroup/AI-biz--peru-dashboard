#!/usr/bin/env node
// Local Shopify storefront simulation for the Mi Bicicleta theme.
//   node server.mjs [--port 4173] [--theme ../../theme] [--mock ../mock/store.json] [--quiet]
import path from 'node:path';
import { App } from './lib/app.mjs';
import { createServer } from './lib/http.mjs';
import { DEFAULT_MOCK_PATH, DEFAULT_PORT, DEFAULT_THEME_DIR } from './lib/paths.mjs';

export function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, theme: DEFAULT_THEME_DIR, mock: DEFAULT_MOCK_PATH, quiet: false, host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--port' || a === '-p') args.port = Number(next());
    else if (a.startsWith('--port=')) args.port = Number(a.slice(7));
    else if (a === '--theme') args.theme = path.resolve(next());
    else if (a === '--mock') args.mock = path.resolve(next());
    else if (a === '--host') args.host = next();
    else if (a === '--quiet' || a === '-q') args.quiet = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

export function startServer({ port = DEFAULT_PORT, theme = DEFAULT_THEME_DIR, mock = DEFAULT_MOCK_PATH, quiet = false, host = '127.0.0.1' } = {}) {
  const app = new App({ themeDir: theme, mockPath: mock });
  const server = createServer(app, { quiet });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({ app, server, port: addr.port, url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${addr.port}` });
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node server.mjs [--port 4173] [--theme <dir>] [--mock <store.json>] [--host 127.0.0.1] [--quiet]');
    process.exit(0);
  }
  startServer(args).then(({ url, app }) => {
    console.log(`Mi Bicicleta preview → ${url}  (theme: ${app.theme.root})`);
    console.log('Try: /  /collections/luces  /products/linterna-multifuncional-m29  /search?q=luz  /cart  /_styleguide  /__errors');
  }).catch((e) => {
    console.error(`[preview] failed to start: ${e.message}`);
    process.exit(1);
  });
}
