#!/usr/bin/env node
/* Genera Sources/Core/Networking/ErrorCatalog.swift desde el catálogo único
   de errores de @ace/shared (packages/shared/src/errors.ts): mismos códigos,
   mismo HTTP y los mismos mensajes en español que ve la web.

   No usa dependencias ni compila TypeScript: lee el objeto literal
   ERROR_CATALOG con expresiones regulares, así que corre igual en Windows que
   en el runner de macOS de la CI.

   Uso:
     node apps/ios/scripts/generar-catalogo-errores.mjs          # escribe
     node apps/ios/scripts/generar-catalogo-errores.mjs --check  # falla si no está al día */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const IOS = path.resolve(AQUI, '..');
const ORIGEN = path.resolve(IOS, '../../packages/shared/src/errors.ts');
const DESTINO = path.join(IOS, 'Sources/Core/Networking/ErrorCatalog.swift');

const ts = readFileSync(ORIGEN, 'utf8').replace(/\r\n/g, '\n');

/** Literal de cadena de TS con comillas simples o dobles → texto. */
function literal(texto) {
  const comilla = texto[0];
  let salida = '';
  for (let i = 1; i < texto.length - 1; i += 1) {
    const c = texto[i];
    if (c === '\\') {
      const s = texto[(i += 1)];
      salida += s === 'n' ? '\n' : s === 't' ? '\t' : s;
    } else if (c === comilla) {
      throw new Error(`Literal mal formado: ${texto}`);
    } else {
      salida += c;
    }
  }
  return salida;
}

const constantes = {};
for (const m of ts.matchAll(/^const ([A-Z_]+) = ('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*");/gm)) {
  constantes[m[1]] = literal(m[2]);
}

const inicio = ts.indexOf('export const ERROR_CATALOG = {');
const fin = ts.indexOf('} as const satisfies', inicio);
if (inicio < 0 || fin < 0) throw new Error('No encuentro ERROR_CATALOG en errors.ts');
const cuerpo = ts.slice(inicio, fin);

const entradas = [];
const patron =
  /^ {2}([a-z0-9_]+): \{\s*status: (\d{3}),\s*legacyStatus: (?:\d{3}|null),\s*public: (true|false),\s*message:\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[A-Z_]+),\s*\},?$/gm;
for (const m of cuerpo.matchAll(patron)) {
  const [, codigo, estado, publico, mensaje] = m;
  const texto = /^[A-Z_]+$/.test(mensaje) ? constantes[mensaje] : literal(mensaje);
  if (texto === undefined) throw new Error(`Constante desconocida en ${codigo}: ${mensaje}`);
  entradas.push({ codigo, estado: Number(estado), publico: publico === 'true', texto });
}

const declarados = [...cuerpo.matchAll(/^ {2}([a-z0-9_]+): \{/gm)].map((m) => m[1]);
if (declarados.length !== entradas.length) {
  const leidos = new Set(entradas.map((e) => e.codigo));
  const faltan = declarados.filter((c) => !leidos.has(c));
  throw new Error(`No he podido leer ${faltan.length} códigos: ${faltan.join(', ')}`);
}

const swiftString = (s) =>
  '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';

const lineas = entradas
  .map(
    (e) =>
      `        ${swiftString(e.codigo)}: ErrorDefinition(status: ${e.estado}, isPublic: ${e.publico}, message: ${swiftString(e.texto)}),`,
  )
  .join('\n');

const swift = `// GENERADO por scripts/generar-catalogo-errores.mjs desde
// packages/shared/src/errors.ts. No lo edites a mano: cambia el catálogo
// común y vuelve a generarlo (la CI de iOS comprueba que está al día).

import Foundation

/// Definición de un código del catálogo común de errores (arquitectura §6.4).
public struct ErrorDefinition: Sendable, Equatable {
    /// HTTP con el que responde /api/v1.
    public let status: Int
    /// Si /api/v1 lo enseña tal cual (los internos no deberían llegar nunca).
    public let isPublic: Bool
    /// Texto en español para enseñárselo a Isma tal cual.
    public let message: String
}

/// Catálogo de códigos de error con sus mensajes en español (${entradas.length} códigos).
public enum ErrorCatalog {
    public static let entries: [String: ErrorDefinition] = [
${lineas}
    ]
}
`;

if (process.argv.includes('--check')) {
  let actual = '';
  try {
    actual = readFileSync(DESTINO, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    actual = '';
  }
  if (actual !== swift) {
    console.error(
      'ErrorCatalog.swift no está al día con packages/shared/src/errors.ts.\n' +
        'Ejecuta: node apps/ios/scripts/generar-catalogo-errores.mjs',
    );
    process.exit(1);
  }
  console.log(`ErrorCatalog.swift al día (${entradas.length} códigos).`);
} else {
  writeFileSync(DESTINO, swift);
  console.log(`ErrorCatalog.swift generado con ${entradas.length} códigos.`);
}
