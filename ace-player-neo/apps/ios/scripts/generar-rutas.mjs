#!/usr/bin/env node
/* Genera Sources/Core/Networking/RutaID.generado.swift [L] desde la tabla de
   rutas v1 de @ace/shared (packages/shared/src/routes.ts): el id de cada ruta,
   su método, su ruta con `:param`, su acceso (web · native · any), su credencial
   nativa (none · bearer · video-token) y su contenido (json · sse · binary).

   Sin dependencias: lee el objeto literal V1_ROUTES con expresiones regulares.

   Uso (desde ace-player-neo/):
     node apps/ios/scripts/generar-rutas.mjs          # escribe
     node apps/ios/scripts/generar-rutas.mjs --check  # falla si no está al día */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const IOS = path.resolve(AQUI, '..');
const ORIGEN = path.resolve(IOS, '../../packages/shared/src/routes.ts');
const DESTINO = path.join(IOS, 'Sources/Core/Networking/RutaID.generado.swift');

const ts = readFileSync(ORIGEN, 'utf8').replace(/\r\n/g, '\n');
const inicio = ts.indexOf('export const V1_ROUTES = {');
const fin = ts.indexOf('} as const satisfies Record<string, V1RouteDefinition>', inicio);
if (inicio < 0 || fin < 0) throw new Error('No encuentro V1_ROUTES en routes.ts');
const cuerpo = ts.slice(inicio, fin);

const campo = (bloque, nombre, id) => {
  const m = new RegExp(`^\\s{4}${nombre}: '([^']*)',$`, 'm').exec(bloque);
  if (!m) throw new Error(`La ruta ${id} no tiene ${nombre}`);
  return m[1];
};

const trozos = cuerpo.split(/^ {2}(?=[a-zA-Z]+: defineRoute\(\{$)/m).slice(1);
const rutas = trozos.map((bloque) => {
  const id = /^([a-zA-Z]+): defineRoute/.exec(bloque)[1];
  return {
    id,
    metodo: campo(bloque, 'method', id),
    ruta: campo(bloque, 'path', id),
    acceso: campo(bloque, 'access', id),
    credencial: campo(bloque, 'credential', id),
    contenido: campo(bloque, 'content', id),
  };
});
const declaradas = [...cuerpo.matchAll(/^ {2}[a-zA-Z]+: defineRoute\(\{$/gm)].length;
if (!rutas.length || rutas.length !== declaradas) throw new Error(`He leído ${rutas.length} de ${declaradas} rutas`);

const METODOS = { GET: 'get', POST: 'post', PUT: 'put', DELETE: 'delete' };
const ACCESOS = { web: 'web', native: 'nativa', any: 'cualquiera' };
const CREDENCIALES = { none: 'ninguna', bearer: 'bearer', 'video-token': 'videoToken' };
const CONTENIDOS = { json: 'json', sse: 'sse', binary: 'binario' };
const traducir = (tabla, valor, que) => {
  if (!(valor in tabla)) throw new Error(`${que} desconocido: ${valor}`);
  return tabla[valor];
};

const casos = rutas.map((r) => `    case ${r.id}`).join('\n');
const rama = (clave, tabla, que) =>
  rutas.map((r) => `        case .${r.id}: .${traducir(tabla, r[clave], que)}`).join('\n');

const swift = `// GENERADO por scripts/generar-rutas.mjs desde packages/shared/src/routes.ts. No editar.

import Foundation

/// Las ${rutas.length} rutas de /api/v1 (V1_ROUTES), con los datos que la app necesita de cada una.
/// Todas existen también bajo /native (la entrada de la app).
enum RutaID: String, CaseIterable, Sendable {
${casos}

    enum Metodo: String, Sendable { case get = "GET", post = "POST", put = "PUT", delete = "DELETE" }
    /// \`access\`: web (solo la web), nativa (solo la app) o cualquiera.
    enum Acceso: String, Sendable { case web, nativa = "native", cualquiera = "any" }
    /// \`credential\` desde /native.
    enum Credencial: String, Sendable { case ninguna = "none", bearer, videoToken = "video-token" }
    enum Contenido: String, Sendable { case json, sse, binario = "binary" }

    var metodo: Metodo {
        switch self {
${rama('metodo', METODOS, 'Método')}
        }
    }

    /// Ruta completa con \`:param\`, bajo /api/v1.
    var ruta: String {
        switch self {
${rutas.map((r) => `        case .${r.id}: "${r.ruta}"`).join('\n')}
        }
    }

    var acceso: Acceso {
        switch self {
${rama('acceso', ACCESOS, 'Acceso')}
        }
    }

    var credencial: Credencial {
        switch self {
${rama('credencial', CREDENCIALES, 'Credencial')}
        }
    }

    var contenido: Contenido {
        switch self {
${rama('contenido', CONTENIDOS, 'Contenido')}
        }
    }
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
      'RutaID.generado.swift no está al día con packages/shared/src/routes.ts.\n' +
        'Ejecuta: node apps/ios/scripts/generar-rutas.mjs',
    );
    process.exit(1);
  }
  console.log(`RutaID.generado.swift al día (${rutas.length} rutas).`);
} else {
  mkdirSync(path.dirname(DESTINO), { recursive: true });
  writeFileSync(DESTINO, swift);
  console.log(`RutaID.generado.swift generado con ${rutas.length} rutas.`);
}
