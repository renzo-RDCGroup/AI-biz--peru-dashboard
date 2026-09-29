// Well-known locations used by the preview harness.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PREVIEW_DIR = path.resolve(LIB_DIR, '..');
export const DEV_DIR = path.resolve(PREVIEW_DIR, '..');
export const PROJECT_DIR = path.resolve(DEV_DIR, '..');

export const DEFAULT_THEME_DIR = path.join(PROJECT_DIR, 'theme');
export const DEFAULT_MOCK_PATH = path.join(DEV_DIR, 'mock', 'store.json');
export const CACHE_DIR = path.join(PREVIEW_DIR, '.cache');
export const FONTS_DIR = path.join(CACHE_DIR, 'fonts');
export const PHOTOS_DIR = path.join(CACHE_DIR, 'img');
export const FIXTURES_DIR = path.join(PREVIEW_DIR, 'fixtures');
export const DEFAULT_SCREENS_DIR = path.join(DEV_DIR, 'screens');

export const CHROMIUM_PATH = process.env.PREVIEW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const DEFAULT_PORT = 4173;
