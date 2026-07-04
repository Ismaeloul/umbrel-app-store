import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const APP_VERSION = '0.1.3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// en dev vive en backend/src (../../frontend); en la imagen Docker, dist/ estÃ¡ junto a frontend/
const frontendCandidates = [
  process.env.CRAFTDECK_FRONTEND,
  path.resolve(__dirname, '../../frontend'),
  path.resolve(__dirname, '../frontend'),
].filter((p): p is string => !!p);
export const FRONTEND_DIR = frontendCandidates.find((p) => existsSync(p)) ?? frontendCandidates[1]!;
export const DATA_DIR = process.env.CRAFTDECK_DATA ?? path.resolve(__dirname, '../data');
export const SERVERS_DIR = path.join(DATA_DIR, 'servers');
export const RUNTIMES_DIR = path.join(DATA_DIR, 'runtimes');
export const CACHE_DIR = path.join(DATA_DIR, 'cache');
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

