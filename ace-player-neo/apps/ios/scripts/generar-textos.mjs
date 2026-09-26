#!/usr/bin/env node
/* Textos de la web del reproductor y de la sesión de fuentes (b-arquitectura §1.2, M3; a8 §3.11.8): saca TODOS
   los literales de cadena de los ficheros de la web que dicen algo al usuario y los deja en
   Tests/AceNeoTests/Vectores/textos-web.json (ordenados y sin repetir). Las plantillas (`…${x}…`) quedan con «{}»
   donde la web interpola; los literales de dentro de `${…}` también salen solos. TextosTests comprueba que cada
   texto del catálogo Swift (Core/Reglas/Reproduccion/TextosReproductor.swift y compañía) está aquí.

   Uso (desde ace-player-neo/):
     node apps/ios/scripts/generar-textos.mjs          # escribe el JSON
     node apps/ios/scripts/generar-textos.mjs --check  # sale con 1 si el JSON está viejo */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const IOS = path.resolve(AQUI, '..');
const WEB = path.resolve(IOS, '../web/src');
const SALIDA = path.join(IOS, 'Tests/AceNeoTests/Vectores/textos-web.json');

const FICHEROS = [
  'player/runtime.ts',
  'player/status.ts',
  'player/index.tsx',
  'player/api.ts',
  'player/engines/demo.ts',
  'features/sources/session.ts',
  'features/sources/model.ts',
  'features/sources/SourcePoster.tsx',
];

/** Literales de un trozo de código: '…', "…" y `…` (con sus `${…}` recorridos por dentro). */
function literales(codigo) {
  const salida = [];
  let i = 0;
  const n = codigo.length;
  while (i < n) {
    const c = codigo[i];
    const siguiente = codigo[i + 1];
    if (c === '/' && siguiente === '/') {
      while (i < n && codigo[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && siguiente === '*') {
      const fin = codigo.indexOf('*/', i + 2);
      i = fin < 0 ? n : fin + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      let texto = '';
      i += 1;
      while (i < n && codigo[i] !== c) {
        if (codigo[i] === '\\') {
          texto += escapar(codigo[i + 1]);
          i += 2;
          continue;
        }
        if (codigo[i] === '\n') break; // no era una cadena (p. ej. un apóstrofo en JSX)
        texto += codigo[i];
        i += 1;
      }
      i += 1;
      salida.push(texto);
      continue;
    }
    if (c === '`') {
      const { texto, fin, dentro } = plantilla(codigo, i + 1);
      salida.push(texto, ...dentro);
      i = fin;
      continue;
    }
    i += 1;
  }
  return salida;
}

function escapar(c) {
  return { n: '\n', t: '\t', "'": "'", '"': '"', '`': '`', '\\': '\\' }[c] ?? c;
}

/** Una plantilla desde después de su «`»: el texto con «{}» y los literales de sus expresiones. */
function plantilla(codigo, desde) {
  let texto = '';
  const dentro = [];
  let i = desde;
  while (i < codigo.length && codigo[i] !== '`') {
    if (codigo[i] === '\\') {
      texto += escapar(codigo[i + 1]);
      i += 2;
      continue;
    }
    if (codigo[i] === '$' && codigo[i + 1] === '{') {
      let nivel = 1;
      let j = i + 2;
      while (j < codigo.length && nivel > 0) {
        if (codigo[j] === '{') nivel += 1;
        else if (codigo[j] === '}') nivel -= 1;
        else if (codigo[j] === '`') {
          j = plantilla(codigo, j + 1).fin - 1;
        } else if (codigo[j] === "'" || codigo[j] === '"') {
          const cierre = codigo.indexOf(codigo[j], j + 1);
          j = cierre < 0 ? j : cierre;
        }
        j += 1;
      }
      dentro.push(...literales(codigo.slice(i + 2, j - 1)));
      texto += '{}';
      i = j;
      continue;
    }
    texto += codigo[i];
    i += 1;
  }
  return { texto, fin: i + 1, dentro };
}

/** Solo lo que parece una frase para una persona (fuera claves, rutas, clases…). */
function esTexto(texto) {
  if (texto.length < 2) return false;
  if (texto.includes("{}") && texto.replaceAll("{}", "").trim().length > 0) return true; // plantillas («{} ({}/{})…»)
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ¿¡«]/.test(texto)) return false;
  if (/^[a-z0-9_.:/-]+$/.test(texto) && !texto.includes(' ')) return false; // identificadores
  return true;
}

const todos = new Set();
for (const fichero of FICHEROS) {
  const codigo = readFileSync(path.join(WEB, fichero), 'utf8');
  for (const texto of literales(codigo)) if (esTexto(texto)) todos.add(texto);
}
const lista = [...todos].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const json = `${JSON.stringify({ generado: 'scripts/generar-textos.mjs', ficheros: FICHEROS, textos: lista }, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let actual = '';
  try {
    actual = readFileSync(SALIDA, 'utf8');
  } catch {}
  if (actual !== json) {
    console.error(`generar-textos: ${path.relative(IOS, SALIDA)} está viejo; ejecuta node apps/ios/scripts/generar-textos.mjs`);
    process.exit(1);
  }
  console.log('generar-textos: al día');
} else {
  writeFileSync(SALIDA, json);
  console.log(`generar-textos: ${lista.length} textos → ${path.relative(IOS, SALIDA)}`);
}
