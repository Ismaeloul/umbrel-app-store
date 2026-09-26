/* Corredor de los vectores de prueba de la app (b-arquitectura §1.2, M2). Cada área deja en
   scripts/vectores/<área>.ts qué funciones de TypeScript de verdad ejecuta y con qué entradas; este
   corredor las carga (con los calzos de `localStorage`, `Date` y el ejecutor de Vite de
   vectores/_cargador.ts) y escribe Tests/AceNeoTests/Vectores/vectores-<área>.json. Las pruebas de Swift
   exigen que el port dé exactamente lo mismo; la CI comprueba que todo está al día (`--check`).

   Cada vectores/<área>.ts exporta por defecto `{ destino: 'vectores-<área>.json', generar(): Promise<unknown> }`
   (o un `texto()` que devuelve el JSON ya escrito, si el área necesita un formato propio).

   Uso (desde ace-player-neo/):
     corepack pnpm@10.18.2 exec tsx apps/ios/scripts/generar-vectores.ts           # escribe
     corepack pnpm@10.18.2 exec tsx apps/ios/scripts/generar-vectores.ts --check   # falla si algo está viejo (CI)
     corepack pnpm@10.18.2 exec tsx apps/ios/scripts/generar-vectores.ts comunes   # solo esas áreas */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cerrar, json, VECTORES } from './vectores/_cargador.ts';

export interface Area {
  destino: string;
  generar?(): Promise<unknown> | unknown;
  texto?(): Promise<string> | string;
}

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CARPETA = path.join(AQUI, 'vectores');
const comprobar = process.argv.includes('--check');
const pedidas = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const areas = readdirSync(CARPETA)
  .filter((f) => f.endsWith('.ts') && !f.startsWith('_'))
  .map((f) => f.slice(0, -3))
  .filter((nombre) => pedidas.length === 0 || pedidas.includes(nombre))
  .sort();

let viejos = 0;
try {
  for (const nombre of areas) {
    const modulo = (await import(pathToFileURL(path.join(CARPETA, `${nombre}.ts`)).href)) as { default: Area };
    const area = modulo.default;
    const texto = area.texto ? await area.texto() : json(await area.generar?.());
    const destino = path.join(VECTORES, area.destino);
    if (comprobar) {
      let actual = '';
      try {
        actual = readFileSync(destino, 'utf8').replace(/\r\n/g, '\n');
      } catch {
        actual = '';
      }
      if (actual !== texto) {
        viejos += 1;
        console.error(`✗ ${area.destino} no está al día con la web (vectores/${nombre}.ts)`);
      } else {
        console.log(`✓ ${area.destino}`);
      }
    } else {
      mkdirSync(path.dirname(destino), { recursive: true });
      writeFileSync(destino, texto);
      console.log(`Escrito ${path.relative(process.cwd(), destino)}`);
    }
  }
} finally {
  await cerrar();
}

if (viejos > 0) {
  console.error('Ejecuta: corepack pnpm@10.18.2 exec tsx apps/ios/scripts/generar-vectores.ts');
  process.exit(1);
}
