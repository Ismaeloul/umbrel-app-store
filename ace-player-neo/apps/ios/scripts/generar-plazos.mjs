#!/usr/bin/env node
/* Genera Sources/Core/Networking/PlazosWeb.generado.swift [L] con los plazos de
   la web, en segundos:
   - apps/web/src/api/client.ts: TIMEOUTS por ruta, DEFAULT_GET_TIMEOUT y
     DEFAULT_MUTATION_TIMEOUT (`timeoutFor`);
   - apps/web/src/features/sources/session.ts: las constantes numéricas exportadas
     (sondeo del comprobador, seguimiento de reportes, plazos de resolución).

   Cada constante de session.ts tiene aquí su nombre en español: si la web añade
   una, el generador falla hasta que se le ponga nombre (así nadie la pierde).

   Uso (desde ace-player-neo/):
     node apps/ios/scripts/generar-plazos.mjs          # escribe
     node apps/ios/scripts/generar-plazos.mjs --check  # falla si no está al día */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const IOS = path.resolve(AQUI, '..');
const CLIENTE = path.resolve(IOS, '../web/src/api/client.ts');
const SESION = path.resolve(IOS, '../web/src/features/sources/session.ts');
const DESTINO = path.join(IOS, 'Sources/Core/Networking/PlazosWeb.generado.swift');

/** Constante de session.ts → [nombre en Swift, es tiempo (ms → s)]. */
const NOMBRES_SESION = {
  SCAN_POLL_MS: ['sondeoComprobador', true],
  SCAN_MAX_FAILURES: ['fallosSondeoMaximos', false],
  REPORT_MAX_POLLS: ['consultasReporteMaximas', false],
  REPORT_MAX_WAIT_MS: ['esperaReporteMaxima', true],
  RESOLVE_TIMEOUT_MS: ['resolver', true],
  RESEARCH_TIMEOUT_MS: ['rebuscar', true],
};

const leer = (ruta) => readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n');

/** `14_000`, `31 * 60_000` → número. Solo cifras, guiones bajos y productos. */
function valor(expresion, donde) {
  const limpia = expresion.trim();
  if (!/^[\d_]+(\s*\*\s*[\d_]+)*$/.test(limpia)) throw new Error(`No sé leer «${limpia}» (${donde})`);
  return limpia
    .split('*')
    .map((n) => Number(n.trim().replace(/_/g, '')))
    .reduce((a, b) => a * b, 1);
}

const segundos = (ms) => {
  const s = ms / 1000;
  return Number.isInteger(s) ? String(s) : String(s);
};

// ---- client.ts
const cliente = leer(CLIENTE);
const bloque = /const TIMEOUTS[^=]*= \{([\s\S]*?)\n\};/.exec(cliente);
if (!bloque) throw new Error('No encuentro TIMEOUTS en api/client.ts');
const porRuta = [...bloque[1].matchAll(/^\s+([a-zA-Z]+): ([\d_ *]+),$/gm)].map((m) => ({
  id: m[1],
  ms: valor(m[2], `TIMEOUTS.${m[1]}`),
}));
const lineasDeclaradas = bloque[1].split('\n').filter((l) => /^\s+[a-zA-Z]+:/.test(l)).length;
if (porRuta.length !== lineasDeclaradas) throw new Error(`He leído ${porRuta.length} de ${lineasDeclaradas} plazos de TIMEOUTS`);
const defecto = (nombre) => {
  const m = new RegExp(`^const ${nombre} = ([\\d_ *]+);$`, 'm').exec(cliente);
  if (!m) throw new Error(`No encuentro ${nombre} en api/client.ts`);
  return valor(m[1], nombre);
};
const lectura = defecto('DEFAULT_GET_TIMEOUT');
const escritura = defecto('DEFAULT_MUTATION_TIMEOUT');

// ---- session.ts
const sesion = leer(SESION);
const constantes = [...sesion.matchAll(/^export const ([A-Z_]+) = ([\d_ *]+);$/gm)].map((m) => ({
  web: m[1],
  valor: valor(m[2], m[1]),
}));
for (const c of constantes) {
  if (!NOMBRES_SESION[c.web]) {
    throw new Error(`session.ts tiene una constante nueva (${c.web}): ponle nombre en NOMBRES_SESION de generar-plazos.mjs`);
  }
}

const ramas = porRuta.map((r) => `        case .${r.id}: ${segundos(r.ms)}`).join('\n');
const lineasSesion = constantes
  .map((c) => {
    const [nombre, tiempo] = NOMBRES_SESION[c.web];
    return tiempo
      ? `    /// \`${c.web}\`\n    static let ${nombre}: Double = ${segundos(c.valor)}`
      : `    /// \`${c.web}\`\n    static let ${nombre} = ${c.valor}`;
  })
  .join('\n');

const swift = `// GENERADO por scripts/generar-plazos.mjs desde apps/web/src/api/client.ts y
// apps/web/src/features/sources/session.ts. No editar.

import Foundation

/// Plazos de la web, en segundos.
enum PlazosWeb {
    /// \`DEFAULT_GET_TIMEOUT\`
    static let lectura: Double = ${segundos(lectura)}
    /// \`DEFAULT_MUTATION_TIMEOUT\`
    static let escritura: Double = ${segundos(escritura)}

    /// \`timeoutFor(id)\`: el de \`TIMEOUTS\` o el de su método.
    static func plazo(_ ruta: RutaID) -> Double {
        switch ruta {
${ramas}
        default: ruta.metodo == .get ? lectura : escritura
        }
    }

    // features/sources/session.ts
${lineasSesion}
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
      'PlazosWeb.generado.swift no está al día con apps/web/src/api/client.ts y features/sources/session.ts.\n' +
        'Ejecuta: node apps/ios/scripts/generar-plazos.mjs',
    );
    process.exit(1);
  }
  console.log(`PlazosWeb.generado.swift al día (${porRuta.length} rutas con plazo propio, ${constantes.length} constantes).`);
} else {
  mkdirSync(path.dirname(DESTINO), { recursive: true });
  writeFileSync(DESTINO, swift);
  console.log(`PlazosWeb.generado.swift generado (${porRuta.length} rutas con plazo propio, ${constantes.length} constantes).`);
}
