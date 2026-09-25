#!/usr/bin/env node
/* Genera Sources/Palco/Tokens/ColoresPalco.generado.swift desde los tokens de
   la web (apps/web/src/styles/tokens.css) y las mezclas de dos colores de sus
   componentes (color-mix(in oklab, var(--x) p%, <color>) en apps/web/src/**.css).

   Qué valor gana (a1 §0.1 y §2.1): el que pinta la web en un navegador actual.
   - Claro: el OKLCH de @supports (primer argumento de light-dark) convertido a
     sRGB; si el token no está ahí, el hex de respaldo de :root.
   - Oscuro: el hex de :root[data-scheme='dark'] (más específico, gana siempre);
     si no está, el segundo argumento de light-dark de @supports; si no, :root.
   - `sombra` = el color de --shadow-1 (sin su alfa: la opacidad va en SombraPalco).
   OKLCH → sRGB con las fórmulas de apps/web/src/lib/color.ts (Björn Ottosson),
   recortando a [0, 1] y redondeando x·255, como `rgbToHex`.

   Una mezcla con `transparent` es `Palco.token.opacity(p)` y no se genera; solo
   las mezclas entre dos colores van a `PalcoMezcla` (b-arquitectura §2.2.1).

   Sin dependencias: lee el CSS con un analizador mínimo. Corre igual en Windows
   que en la CI.

   Uso (desde ace-player-neo/):
     node apps/ios/scripts/generar-tokens.mjs          # escribe
     node apps/ios/scripts/generar-tokens.mjs --check  # falla si no está al día */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const IOS = path.resolve(AQUI, '..');
const WEB = path.resolve(IOS, '../web/src');
const ORIGEN = path.join(WEB, 'styles/tokens.css');
const DESTINO = path.join(IOS, 'Sources/Palco/Tokens/ColoresPalco.generado.swift');

/** Nombre en Swift → token de la web, en el orden de b-arquitectura §2.2.1. */
const TOKENS = [
  ['bg', 'bg'],
  ['bgSunk', 'bg-sunk'],
  ['surface', 'surface'],
  ['surface2', 'surface-2'],
  ['line', 'line'],
  ['lineSoft', 'line-soft'],
  ['lineStrong', 'line-strong'],
  ['text', 'text'],
  ['text2', 'text-2'],
  ['text3', 'text-3'],
  ['accent', 'accent'],
  ['onAccent', 'on-accent'],
  ['accentInk', 'accent-ink'],
  ['accentEdge', 'accent-edge'],
  ['accentWash', 'accent-wash'],
  ['live', 'live'],
  ['liveInk', 'live-ink'],
  ['ok', 'ok'],
  ['okInk', 'ok-ink'],
  ['weak', 'weak'],
  ['weakInk', 'weak-ink'],
  ['fail', 'fail'],
  ['failInk', 'fail-ink'],
  ['glass', 'glass'],
  ['glassDense', 'glass-dense'],
  ['glassSolid', 'glass-solid'],
  ['glassHi', 'glass-hi'],
  ['glassRim', 'glass-rim'],
  ['scrim', 'scrim'],
  ['sombra', 'shadow-1'],
  ['glassVideo', 'glass-video'],
  ['glassVideoSolid', 'glass-video-solid'],
  ['onVideo', 'on-video'],
  ['onVideo2', 'on-video-2'],
  ['veil', 'veil'],
  ['veilStrong', 'veil-strong'],
];

/** Nombres con significado para mezclas conocidas; el resto se nombra solo. */
const NOMBRES_MEZCLA = {
  'live|86|#000': 'liveCapsula', // fondo de la cápsula de directo (a1 §2.3)
};

// ---------------------------------------------------------------- color

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function oklabToRgb({ L, A, B }) {
  const l_ = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: clamp01(toGamma(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_)),
    g: clamp01(toGamma(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_)),
    b: clamp01(toGamma(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_)),
  };
}

function rgbToOklab({ r, g, b }) {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    A: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    B: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** sRGB 0…1 → entero 0xRRGGBB, como `rgbToHex` de la web. */
const aEntero = ({ r, g, b }) =>
  (Math.round(clamp01(r) * 255) << 16) | (Math.round(clamp01(g) * 255) << 8) | Math.round(clamp01(b) * 255);
const deEntero = (n) => ({ r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 });

/** Un color de CSS → { hex, alfa } o null si no es un color literal. */
function parsearColor(texto) {
  const t = texto.trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
  if (m) {
    const s = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return { hex: Number.parseInt(s, 16), alfa: 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+%?))?\s*\)$/i.exec(t);
  if (m) {
    const alfa = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
    return { hex: (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]), alfa };
  }
  m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\s*\)$/i.exec(t);
  if (m) {
    const L = m[1].endsWith('%') ? Number(m[1].slice(0, -1)) / 100 : Number(m[1]);
    const c = Number(m[2]);
    const h = (Number(m[3]) * Math.PI) / 180;
    const alfa = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
    return { hex: aEntero(oklabToRgb({ L, A: c * Math.cos(h), B: c * Math.sin(h) })), alfa };
  }
  return null;
}

/** Parte los argumentos de una función CSS por comas de primer nivel. */
function argumentos(texto) {
  const salida = [];
  let nivel = 0;
  let actual = '';
  for (const c of texto) {
    if (c === '(') nivel += 1;
    if (c === ')') nivel -= 1;
    if (c === ',' && nivel === 0) {
      salida.push(actual.trim());
      actual = '';
    } else {
      actual += c;
    }
  }
  if (actual.trim()) salida.push(actual.trim());
  return salida;
}

/** Primer color que aparece en un valor (para las sombras). */
function primerColor(valor) {
  const m = /(light-dark\((?:[^()]|\([^()]*\))*\)|oklch\([^)]*\)|rgba?\([^)]*\)|#[0-9a-f]{3,6}\b)/i.exec(valor);
  return m ? m[1] : null;
}

/** Valor de un token en un bloque: { claro, oscuro } de colores, o null. */
function valorEnBloque(valor, esSombra) {
  const crudo = esSombra ? primerColor(valor) : valor.trim();
  if (!crudo) return null;
  const ld = /^light-dark\(([\s\S]*)\)$/i.exec(crudo);
  if (ld) {
    const [a, b] = argumentos(ld[1]);
    return { claro: parsearColor(a), oscuro: parsearColor(b) };
  }
  const c = parsearColor(crudo);
  return c ? { claro: c, oscuro: c } : null;
}

// ---------------------------------------------------------------- CSS

/** Reglas del CSS: [{ selector, contexto: ['@supports …'], declaraciones: Map }]. */
function reglas(css) {
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const salida = [];
  const pila = [];
  let i = 0;
  let cabecera = '';
  while (i < sinComentarios.length) {
    const c = sinComentarios[i];
    if (c === '{') {
      const selector = cabecera.trim();
      cabecera = '';
      if (selector.startsWith('@')) {
        pila.push({ at: selector });
        i += 1;
        continue;
      }
      let nivel = 1;
      let j = i + 1;
      while (j < sinComentarios.length && nivel > 0) {
        if (sinComentarios[j] === '{') nivel += 1;
        if (sinComentarios[j] === '}') nivel -= 1;
        j += 1;
      }
      const cuerpo = sinComentarios.slice(i + 1, j - 1);
      const declaraciones = new Map();
      for (const m of cuerpo.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]*);/gi)) declaraciones.set(m[1], m[2].trim());
      salida.push({ selector, contexto: pila.map((p) => p.at), declaraciones });
      i = j;
      continue;
    }
    if (c === '}') {
      pila.pop();
      cabecera = '';
      i += 1;
      continue;
    }
    cabecera += c;
    i += 1;
  }
  return salida;
}

function resolverTokens(css) {
  const todas = reglas(css);
  const sinMedia = todas.filter((r) => !r.contexto.some((c) => c.startsWith('@media')));
  const esSupports = (r) => r.contexto.some((c) => c.startsWith('@supports'));
  const raiz = sinMedia.filter((r) => r.selector === ':root' && !esSupports(r));
  const supports = sinMedia.filter((r) => r.selector === ':root' && esSupports(r));
  const oscuro = sinMedia.filter((r) => r.selector === ":root[data-scheme='dark']");

  const ultimo = (bloques, token, esSombra) => {
    let valor = null;
    for (const b of bloques) {
      if (b.declaraciones.has(token)) valor = valorEnBloque(b.declaraciones.get(token), esSombra) ?? valor;
    }
    return valor;
  };

  const resultado = [];
  const avisos = [];
  for (const [nombre, token] of TOKENS) {
    const clave = `--${token}`;
    const esSombra = nombre === 'sombra';
    const deRaiz = ultimo(raiz, clave, esSombra);
    const deSupports = ultimo(supports, clave, esSombra);
    const deOscuro = ultimo(oscuro, clave, esSombra);
    const claro = deSupports?.claro ?? deRaiz?.claro;
    const osc = deOscuro?.oscuro ?? deSupports?.oscuro ?? deRaiz?.oscuro;
    if (!claro || !osc) throw new Error(`No encuentro el valor de ${clave} en tokens.css`);
    if (deSupports && deRaiz && !esSombra && deSupports.claro.hex !== deRaiz.claro.hex) {
      avisos.push(`${clave}: OKLCH claro ${hex(deSupports.claro.hex)} ≠ respaldo ${hex(deRaiz.claro.hex)}`);
    }
    resultado.push({
      nombre,
      token,
      claro: esSombra ? { ...claro, alfa: 1 } : claro,
      oscuro: esSombra ? { ...osc, alfa: 1 } : osc,
    });
  }
  return { tokens: resultado, avisos };
}

// ---------------------------------------------------------------- mezclas

function ficherosCss(carpeta) {
  const salida = [];
  for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
    const ruta = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) salida.push(...ficherosCss(ruta));
    else if (entrada.name.endsWith('.css')) salida.push(ruta);
  }
  return salida.sort();
}

const camel = (token) => token.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const mayuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function resolverMezclas(tokens) {
  const porToken = new Map(tokens.map((t) => [t.token, t]));
  const colorDe = (texto) => {
    const v = /^var\(--([a-z0-9-]+)\)$/.exec(texto.trim());
    if (v) {
      const t = porToken.get(v[1]);
      return t ? { claro: t.claro, oscuro: t.oscuro, nombre: camel(v[1]) } : null;
    }
    const c = parsearColor(texto);
    return c ? { claro: c, oscuro: c, nombre: texto.trim() } : null;
  };
  const mezclas = new Map();
  for (const fichero of ficherosCss(WEB)) {
    const css = readFileSync(fichero, 'utf8').replace(/\r\n/g, '\n');
    const lineas = css.split('\n');
    lineas.forEach((linea, n) => {
      for (const m of linea.matchAll(/color-mix\(in oklab,\s*var\(--([a-z0-9-]+)\)\s+([\d.]+)%,\s*([^)]+\)?)\)/g)) {
        let segundo = m[3].trim();
        if (!segundo.includes('(') && segundo.endsWith(')')) segundo = segundo.slice(0, -1);
        if (segundo === 'transparent') continue;
        const uno = porToken.get(m[1]);
        const dos = colorDe(segundo);
        if (!uno || !dos) continue; // variables de componente (--tone, --h…): se mezclan en Swift en tiempo real
        const p = Number(m[2]) / 100;
        const clave = `${m[1]}|${m[2]}|${segundo.replace(/^var\(--|\)$/g, '')}`;
        const nombre =
          NOMBRES_MEZCLA[clave] ??
          `${camel(m[1])}${m[2].replace('.', '_')}Sobre${mayuscula(dos.nombre.startsWith('#') ? 'hex' + dos.nombre.slice(1) : dos.nombre)}`;
        const mezclar = (a, b) => {
          if (a.alfa !== 1 || b.alfa !== 1) throw new Error(`Mezcla con alfa en ${fichero}:${n + 1}`);
          const x = rgbToOklab(deEntero(a.hex));
          const y = rgbToOklab(deEntero(b.hex));
          return {
            hex: aEntero(oklabToRgb({ L: p * x.L + (1 - p) * y.L, A: p * x.A + (1 - p) * y.A, B: p * x.B + (1 - p) * y.B })),
            alfa: 1,
          };
        };
        const donde = `${path.relative(path.resolve(IOS, '../..'), fichero).replace(/\\/g, '/')}:${n + 1}`;
        const previa = mezclas.get(nombre);
        if (previa) {
          previa.donde.push(donde);
          continue;
        }
        mezclas.set(nombre, {
          nombre,
          formula: `color-mix(in oklab, var(--${m[1]}) ${m[2]}%, ${segundo})`,
          claro: mezclar(uno.claro, dos.claro),
          oscuro: mezclar(uno.oscuro, dos.oscuro),
          donde: [donde],
        });
      }
    });
  }
  return [...mezclas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// ---------------------------------------------------------------- Swift

function hex(n) {
  return '0x' + n.toString(16).toUpperCase().padStart(6, '0');
}
const alfa = (a) => String(Number(a.toFixed(4)));

function expresion({ claro, oscuro }) {
  if (claro.hex === oscuro.hex && claro.alfa === oscuro.alfa) {
    return claro.alfa === 1 ? `Color(hex: ${hex(claro.hex)})` : `Color(hex: ${hex(claro.hex)}, alfa: ${alfa(claro.alfa)})`;
  }
  const alfas =
    claro.alfa === 1 && oscuro.alfa === 1 ? '' : `, alfaClaro: ${alfa(claro.alfa)}, alfaOscuro: ${alfa(oscuro.alfa)}`;
  return `Color(claro: ${hex(claro.hex)}, oscuro: ${hex(oscuro.hex)}${alfas})`;
}

const css = readFileSync(ORIGEN, 'utf8').replace(/\r\n/g, '\n');
const { tokens, avisos } = resolverTokens(css);
const mezclas = resolverMezclas(tokens);

const lineasTokens = tokens
  .map((t) => `    /// \`--${t.token}\`${t.nombre === 'sombra' ? ' (color de las sombras, sin alfa)' : ''}\n    static let ${t.nombre} = ${expresion(t)}`)
  .join('\n');
const lineasMezclas = mezclas
  .map((m) => `    /// \`${m.formula}\` · ${m.donde.join(', ')}\n    static let ${m.nombre} = ${expresion(m)}`)
  .join('\n');

const swift = `// GENERADO por scripts/generar-tokens.mjs desde apps/web/src/styles/tokens.css
// (y las mezclas de apps/web/src/**/*.css). No editar: cambia la web y vuelve a generarlo
// (la CI comprueba que está al día con --check).

import SwiftUI

/// Colores de la web (a1 §2.1-2.2): sRGB exacto, claro y oscuro según el tema de la ventana.
/// Una mezcla con transparente se escribe \`Palco.token.opacity(p)\`.
enum Palco {
${lineasTokens}
}

/// Mezclas entre dos colores que usan los componentes de la web, ya resueltas en OKLab (a1 §2.3).
enum PalcoMezcla {
${lineasMezclas}
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
      'ColoresPalco.generado.swift no está al día con apps/web/src/styles/tokens.css.\n' +
        'Ejecuta: node apps/ios/scripts/generar-tokens.mjs',
    );
    process.exit(1);
  }
  console.log(`ColoresPalco.generado.swift al día (${tokens.length} tokens, ${mezclas.length} mezclas).`);
} else {
  mkdirSync(path.dirname(DESTINO), { recursive: true });
  writeFileSync(DESTINO, swift);
  for (const a of avisos) console.warn(`aviso: ${a}`);
  console.log(`ColoresPalco.generado.swift generado con ${tokens.length} tokens y ${mezclas.length} mezclas.`);
}
