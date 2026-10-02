#!/usr/bin/env node
/* Lanzador del laboratorio IPTV: `node scripts/iptv-lab/run.mjs <escenario> [opciones]`.
   Solo arranca lab.ts con el tsx del monorepo (ver README.md). */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');
const child = spawn(process.execPath, [tsx, path.join(here, 'lab.ts'), ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
});
const forward = (signal) => () => child.kill(signal);
process.once('SIGINT', forward('SIGINT'));
process.once('SIGTERM', forward('SIGTERM'));
child.once('exit', (code) => process.exit(code ?? 1));
