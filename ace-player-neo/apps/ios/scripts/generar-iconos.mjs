#!/usr/bin/env node
/* Genera, desde el set de iconos de la web (apps/web/src/ui/icons.ts):
   - Sources/Core/Reglas/Iconos/NombreIcono.generado.swift  [L] los nombres, en su orden.
   - Sources/Palco/Iconos/TrazosIcono.generado.swift        los dibujos en la rejilla 24.

   Cada icono se reduce a dos caminos con órdenes absolutas M, L, C y Z (los arcos,
   rectángulos redondeados y círculos pasan a cúbicas aquí, no en el iPhone):
   - trazo: lo que la web pinta con `stroke: currentColor` (Icon.css: trazo 1,8, puntas
     y uniones redondas, sin relleno);
   - relleno: lo que lleva `fill="currentColor"` (con `stroke="none"` solo relleno; sin
     él, como `star-f`, relleno y trazo).
   En Swift los caminos van como texto y se leen al pedirlos: compilar miles de CGPoint
   literales es lento, leer 52 cadenas cortas no.

   Uso (desde ace-player-neo/):
     node apps/ios/scripts/generar-iconos.mjs          # escribe
     node apps/ios/scripts/generar-iconos.mjs --check  # falla si no está al día */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const IOS = path.resolve(AQUI, '..');
const ORIGEN = path.resolve(IOS, '../web/src/ui/icons.ts');
const DESTINO_NOMBRES = path.join(IOS, 'Sources/Core/Reglas/Iconos/NombreIcono.generado.swift');
const DESTINO_TRAZOS = path.join(IOS, 'Sources/Palco/Iconos/TrazosIcono.generado.swift');

// ---------------------------------------------------------------- lectura de icons.ts

function leerIconos(ts) {
  const inicio = ts.indexOf('export const ICONS = {');
  const fin = ts.indexOf('} as const satisfies', inicio);
  if (inicio < 0 || fin < 0) throw new Error('No encuentro ICONS en icons.ts');
  const cuerpo = ts.slice(inicio, fin);
  const iconos = [];
  const patron = /^\s{2}(?:'([a-z0-9-]+)'|([a-z0-9]+)):\s*'([^']*)',?$/gm;
  const unaLinea = cuerpo.replace(/:\n\s+'/g, ": '");
  for (const m of unaLinea.matchAll(patron)) iconos.push({ nombre: m[1] ?? m[2], svg: m[3] });
  const declarados = [...unaLinea.matchAll(/^\s{2}(?:'[a-z0-9-]+'|[a-z0-9]+):/gm)].length;
  if (declarados !== iconos.length) throw new Error(`He leído ${iconos.length} de ${declarados} iconos`);
  return iconos;
}

const atributos = (texto) => Object.fromEntries([...texto.matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

// ---------------------------------------------------------------- geometría

const K = 0.5522847498307936; // cuarto de círculo con una cúbica

/** Órdenes absolutas: { o: 'M'|'L'|'C'|'Z', p: [números] }. */
function rectangulo({ x = '0', y = '0', width, height, rx, ry }) {
  const X = Number(x);
  const Y = Number(y);
  const W = Number(width);
  const H = Number(height);
  let r = Number(rx ?? ry ?? 0);
  r = Math.min(r, W / 2, H / 2);
  if (!r) {
    return [
      { o: 'M', p: [X, Y] },
      { o: 'L', p: [X + W, Y] },
      { o: 'L', p: [X + W, Y + H] },
      { o: 'L', p: [X, Y + H] },
      { o: 'Z', p: [] },
    ];
  }
  const k = r * K;
  return [
    { o: 'M', p: [X + r, Y] },
    { o: 'L', p: [X + W - r, Y] },
    { o: 'C', p: [X + W - r + k, Y, X + W, Y + r - k, X + W, Y + r] },
    { o: 'L', p: [X + W, Y + H - r] },
    { o: 'C', p: [X + W, Y + H - r + k, X + W - r + k, Y + H, X + W - r, Y + H] },
    { o: 'L', p: [X + r, Y + H] },
    { o: 'C', p: [X + r - k, Y + H, X, Y + H - r + k, X, Y + H - r] },
    { o: 'L', p: [X, Y + r] },
    { o: 'C', p: [X, Y + r - k, X + r - k, Y, X + r, Y] },
    { o: 'Z', p: [] },
  ];
}

function circulo({ cx, cy, r }) {
  const X = Number(cx);
  const Y = Number(cy);
  const R = Number(r);
  const k = R * K;
  return [
    { o: 'M', p: [X + R, Y] },
    { o: 'C', p: [X + R, Y + k, X + k, Y + R, X, Y + R] },
    { o: 'C', p: [X - k, Y + R, X - R, Y + k, X - R, Y] },
    { o: 'C', p: [X - R, Y - k, X - k, Y - R, X, Y - R] },
    { o: 'C', p: [X + k, Y - R, X + R, Y - k, X + R, Y] },
    { o: 'Z', p: [] },
  ];
}

/** Arco SVG (de x1,y1 a x2,y2) → cúbicas (SVG 1.1 apéndice F.6). */
function arcoACubicas(x1, y1, rx, ry, angulo, grande, barrido, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  if (!rx || !ry) return [{ o: 'L', p: [x2, y2] }];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (angulo * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (grande === barrido) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angulo2 = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = angulo2(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = angulo2((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!barrido && dt > 0) dt -= 2 * Math.PI;
  if (barrido && dt < 0) dt += 2 * Math.PI;
  const trozos = Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9);
  const paso = dt / trozos;
  const salida = [];
  const punto = (t) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const derivada = (t) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const alfa = (4 / 3) * Math.tan(paso / 4);
  for (let i = 0; i < trozos; i += 1) {
    const a = t1 + i * paso;
    const b = a + paso;
    const [ax, ay] = punto(a);
    const [bx, by] = i === trozos - 1 ? [x2, y2] : punto(b);
    const [dax, day] = derivada(a);
    const [dbx, dby] = derivada(b);
    salida.push({ o: 'C', p: [ax + alfa * dax, ay + alfa * day, bx - alfa * dbx, by - alfa * dby, bx, by] });
  }
  return salida;
}

/** Atributo `d` → órdenes absolutas M, L, C, Z. */
function camino(d) {
  const fichas = [];
  const lector = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)/g;
  for (const m of d.matchAll(lector)) fichas.push(m[1] ?? Number(m[2]));
  // Las banderas de los arcos pueden venir pegadas («0 01.5.86»): se separan al leerlas.
  const salida = [];
  let i = 0;
  let orden = null;
  let x = 0;
  let y = 0;
  let inicioX = 0;
  let inicioY = 0;
  let control = null; // último segundo punto de control (para S)
  const num = () => {
    const v = fichas[i];
    if (typeof v !== 'number') throw new Error(`Esperaba un número en «${d}»`);
    i += 1;
    return v;
  };
  const bandera = () => {
    const v = fichas[i];
    if (typeof v !== 'number') throw new Error(`Esperaba una bandera en «${d}»`);
    const texto = String(v);
    if (texto === '0' || texto === '1') {
      i += 1;
      return v;
    }
    // «01.5» leído como 1.5 tras un 0: no pasa con este lector salvo banderas pegadas a un número.
    throw new Error(`Bandera de arco rara (${texto}) en «${d}»`);
  };
  while (i < fichas.length) {
    if (typeof fichas[i] === 'string') {
      orden = fichas[i];
      i += 1;
      if (orden === 'Z' || orden === 'z') {
        salida.push({ o: 'Z', p: [] });
        x = inicioX;
        y = inicioY;
        control = null;
        continue;
      }
    } else if (orden === 'M') {
      orden = 'L';
    } else if (orden === 'm') {
      orden = 'l';
    }
    const rel = orden === orden.toLowerCase();
    const O = orden.toUpperCase();
    if (O === 'M') {
      x = (rel ? x : 0) + num();
      y = (rel ? y : 0) + num();
      inicioX = x;
      inicioY = y;
      salida.push({ o: 'M', p: [x, y] });
      control = null;
    } else if (O === 'L') {
      x = (rel ? x : 0) + num();
      y = (rel ? y : 0) + num();
      salida.push({ o: 'L', p: [x, y] });
      control = null;
    } else if (O === 'H') {
      x = (rel ? x : 0) + num();
      salida.push({ o: 'L', p: [x, y] });
      control = null;
    } else if (O === 'V') {
      y = (rel ? y : 0) + num();
      salida.push({ o: 'L', p: [x, y] });
      control = null;
    } else if (O === 'C') {
      const bx = rel ? x : 0;
      const by = rel ? y : 0;
      const c1 = [bx + num(), by + num()];
      const c2 = [bx + num(), by + num()];
      x = bx + num();
      y = by + num();
      salida.push({ o: 'C', p: [...c1, ...c2, x, y] });
      control = c2;
    } else if (O === 'S') {
      const bx = rel ? x : 0;
      const by = rel ? y : 0;
      const c1 = control ? [2 * x - control[0], 2 * y - control[1]] : [x, y];
      const c2 = [bx + num(), by + num()];
      x = bx + num();
      y = by + num();
      salida.push({ o: 'C', p: [...c1, ...c2, x, y] });
      control = c2;
    } else if (O === 'A') {
      const rx = num();
      const ry = num();
      const giro = num();
      const grande = bandera();
      const barrido = bandera();
      const nx = (rel ? x : 0) + num();
      const ny = (rel ? y : 0) + num();
      salida.push(...arcoACubicas(x, y, rx, ry, giro, grande === 1, barrido === 1, nx, ny));
      x = nx;
      y = ny;
      control = null;
    } else {
      throw new Error(`Orden ${orden} no soportada en «${d}»`);
    }
  }
  return salida;
}

function elementos(svg) {
  const partes = { trazo: [], relleno: [] };
  for (const m of svg.matchAll(/<(rect|circle|path)\s([^>]*?)\/?>/g)) {
    const a = atributos(m[2]);
    const ordenes = m[1] === 'rect' ? rectangulo(a) : m[1] === 'circle' ? circulo(a) : camino(a.d);
    const relleno = a.fill === 'currentColor';
    const trazo = a.stroke !== 'none';
    if (relleno) partes.relleno.push(...ordenes);
    if (trazo) partes.trazo.push(...ordenes);
  }
  return partes;
}

const numero = (v) => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};
const texto = (ordenes) => ordenes.map((o) => [o.o, ...o.p.map(numero)].join(' ')).join(' ');

// ---------------------------------------------------------------- Swift

const camel = (nombre) => nombre.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const caso = (nombre) => (camel(nombre) === nombre ? nombre : `${camel(nombre)} = "${nombre}"`);

const ts = readFileSync(ORIGEN, 'utf8').replace(/\r\n/g, '\n');
const iconos = leerIconos(ts).map((i) => ({ ...i, ...elementos(i.svg) }));

const casos = [];
let linea = [];
for (const i of iconos) {
  const c = caso(i.nombre);
  if (c.includes('=')) {
    if (linea.length) casos.push(`    case ${linea.join(', ')}`);
    casos.push(`    case ${c}`);
    linea = [];
  } else {
    linea.push(c);
    if (linea.length === 12) {
      casos.push(`    case ${linea.join(', ')}`);
      linea = [];
    }
  }
}
if (linea.length) casos.push(`    case ${linea.join(', ')}`);

const nombresSwift = `// GENERADO por scripts/generar-iconos.mjs desde apps/web/src/ui/icons.ts. No editar.

import Foundation

/// Los ${iconos.length} iconos de ui/icons.ts, en su orden (el valor es el nombre de la web).
enum NombreIcono: String, CaseIterable, Sendable {
${casos.join('\n')}
}
`;

const cadena = (s) => `"${s}"`;
const ramas = (parte) =>
  iconos
    .filter((i) => i[parte].length)
    .map((i) => `        case .${camel(i.nombre)}: ${cadena(texto(i[parte]))}`)
    .join('\n') + (iconos.every((i) => i[parte].length) ? '' : '\n        default: ""');

const trazosSwift = `// GENERADO por scripts/generar-iconos.mjs desde apps/web/src/ui/icons.ts. No editar.

import SwiftUI

/// Qué parte de un icono se pide: lo que la web pinta con trazo o lo que rellena.
enum ParteIcono: Sendable { case trazo, relleno }

/// Los dibujos de ui/icons.ts en la rejilla de 24 (órdenes absolutas M, L, C y Z).
enum TrazosIcono {
    /// El camino de un icono escalado y centrado en \`rect\` (el lado es el menor de los dos).
    static func camino(_ nombre: NombreIcono, parte: ParteIcono, en rect: CGRect) -> Path {
        let dibujo = rejilla[nombre] ?? DibujoIcono(trazo: Path(), relleno: Path())
        let lado = min(rect.width, rect.height)
        let escala = lado / 24
        let dx = rect.minX + (rect.width - lado) / 2
        let dy = rect.minY + (rect.height - lado) / 2
        let transformacion = CGAffineTransform(translationX: dx, y: dy).scaledBy(x: escala, y: escala)
        return (parte == .trazo ? dibujo.trazo : dibujo.relleno).applying(transformacion)
    }

    /// Los caminos de un icono en la rejilla de 24.
    struct DibujoIcono: Sendable {
        let trazo: Path
        let relleno: Path
    }

    /// Todos los dibujos, leídos una sola vez (la primera vez que se pide un icono).
    private static let rejilla: [NombreIcono: DibujoIcono] = {
        var todos: [NombreIcono: DibujoIcono] = [:]
        for nombre in NombreIcono.allCases {
            todos[nombre] = DibujoIcono(trazo: leer(trazo(nombre)), relleno: leer(relleno(nombre)))
        }
        return todos
    }()

    /// Lee «M x y L x y C x1 y1 x2 y2 x y Z».
    private static func leer(_ datos: String) -> Path {
        var camino = Path()
        var orden: Character = "M"
        var numeros: [CGFloat] = []
        func punto(_ i: Int) -> CGPoint {
            CGPoint(x: numeros[i], y: numeros[i + 1])
        }
        func cerrarOrden() {
            switch orden {
            case "M" where numeros.count == 2: camino.move(to: punto(0))
            case "L" where numeros.count == 2: camino.addLine(to: punto(0))
            case "C" where numeros.count == 6: camino.addCurve(to: punto(4), control1: punto(0), control2: punto(2))
            default: break
            }
            numeros.removeAll(keepingCapacity: true)
        }
        for ficha in datos.split(separator: " ") {
            if let valor = Double(ficha) {
                numeros.append(CGFloat(valor))
            } else if let letra = ficha.first {
                cerrarOrden()
                orden = letra
                if letra == "Z" { camino.closeSubpath() }
            }
        }
        cerrarOrden()
        return camino
    }

    private static func trazo(_ nombre: NombreIcono) -> String {
        switch nombre {
${ramas('trazo')}
        }
    }

    private static func relleno(_ nombre: NombreIcono) -> String {
        switch nombre {
${ramas('relleno')}
        }
    }
}
`;

const destinos = [
  [DESTINO_NOMBRES, nombresSwift],
  [DESTINO_TRAZOS, trazosSwift],
];

if (process.argv.includes('--check')) {
  const viejos = destinos.filter(([ruta, contenido]) => {
    try {
      return readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n') !== contenido;
    } catch {
      return true;
    }
  });
  if (viejos.length) {
    for (const [ruta] of viejos) console.error(`${path.relative(IOS, ruta)} no está al día con apps/web/src/ui/icons.ts.`);
    console.error('Ejecuta: node apps/ios/scripts/generar-iconos.mjs');
    process.exit(1);
  }
  console.log(`Iconos al día (${iconos.length}).`);
} else {
  for (const [ruta, contenido] of destinos) {
    mkdirSync(path.dirname(ruta), { recursive: true });
    writeFileSync(ruta, contenido);
  }
  console.log(`Iconos generados (${iconos.length}).`);
}
