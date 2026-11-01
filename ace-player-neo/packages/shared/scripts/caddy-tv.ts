/* Escribe en deploy/umbrel/caddy/tv-on.caddy los matchers del dominio de fuera (tv.ismaeloul.es)
   sacados de la tabla de rutas (`remote` de cada ruta, src/remote-caddy.ts). Solo toca el trozo
   entre las marcas GENERADO / FIN GENERADO. deploy/test/caddy-native.test.ts falla si el fichero
   no está al día.

   Uso: corepack pnpm@10.18.2 --filter @ace/shared caddy-tv */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceRemoteCaddyMatchers } from '../src/remote-caddy.js';

export const TV_CADDY_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../deploy/umbrel/caddy/tv-on.caddy',
);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const before = readFileSync(TV_CADDY_FILE, 'utf8').replace(/\r\n/g, '\n');
  const after = replaceRemoteCaddyMatchers(before);
  writeFileSync(TV_CADDY_FILE, after);
  console.log(
    before === after ? 'tv-on.caddy ya estaba al día' : `tv-on.caddy actualizado: ${TV_CADDY_FILE}`,
  );
}
