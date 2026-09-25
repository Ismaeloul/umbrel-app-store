#!/usr/bin/env node
/* Linter de patrones prohibidos de la app nativa (b-arquitectura §5.2). Tarda segundos.

   Recorre Sources/**\/*.swift (salvo *.generado.swift) y sale con
   código 1 si una línea incumple una regla. R20 (ficheros de más de 400 líneas) solo avisa.

   Alcance: hasta la poda (fase 0.2) solo miraba las carpetas nuevas (Palco, Armazon,
   Pantallas, Core/Datos, Core/Reglas); desde la poda, ALCANCE = 'todo' (todo Sources).
   Los comentarios y el texto de las cadenas no cuentan.

   Excepción por línea: una línea que termine en «// permitido: <motivo>» se salta solo
   en las reglas marcadas «con permiso» (R10). El integrador revisa cada una.

   Uso (desde ace-player-neo/):
     node apps/ios/scripts/revisar-swift.mjs
     node apps/ios/scripts/revisar-swift.mjs --todo            # todo Sources, ya
     node apps/ios/scripts/revisar-swift.mjs --raiz <carpeta>  # otra carpeta Sources (pruebas del linter) */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const IOS = path.resolve(AQUI, '..');

/** 'nuevas' hasta la poda (fase 0.2); desde la poda, 'todo'. */
const ALCANCE = 'todo';
const CARPETAS_NUEVAS = ['Palco', 'Armazon', 'Pantallas', 'Core/Datos', 'Core/Reglas'];

const argumento = (nombre) => {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const SOURCES = path.resolve(argumento('--raiz') ?? path.join(IOS, 'Sources'));
const TODO = ALCANCE === 'todo' || process.argv.includes('--todo');

// ---------------------------------------------------------------- reglas

/** ¿La ruta relativa (con /) está dentro de alguna de estas carpetas o es uno de estos ficheros? */
const en = (rel, lugares) =>
  lugares.some((l) => (l.endsWith('.swift') ? rel === l : rel === l || rel.startsWith(`${l}/`)));
const PURO = [
  'Core/Reglas',
  'Core/Models',
  'Core/Dominio',
  'Debug/DemoNucleo',
  'Player/MaquinaConexion.swift',
  'Player/Directo.swift',
  'Player/TiposReproduccion.swift',
  'App/MigracionClaves.swift',
];

/**
 * Cada regla: id, qué dice, patrón (sobre el código sin comentarios ni cadenas),
 * dónde aplica (undefined = todo), excepciones (ficheros o carpetas), `permiso` y `aviso`.
 */
const REGLAS = [
  {
    id: 'R1',
    texto: 'sin navegación del sistema (NavigationStack, NavigationView, NavigationLink, TabView)',
    patron: /\b(NavigationStack|NavigationView|NavigationLink|TabView)\b/,
  },
  {
    id: 'R2',
    texto: 'sin ramas de versión (#available, #unavailable, @available(iOS …)): el mínimo es iOS 26',
    patron: /#available|#unavailable|@available\(iOS/,
  },
  { id: 'R3', texto: 'sin GeometryReader (usa onGeometryChange o la Maquetacion del entorno)', patron: /GeometryReader/ },
  {
    id: 'R4',
    texto: 'sin AnyView',
    patron: /\bAnyView\b/,
    excepto: ['Palco/Componentes/ImagenServidor.swift'],
  },
  {
    id: 'R5',
    texto: 'una sola puerta: .glassEffect( solo en Palco/Cristal/Cristal.swift (y el laboratorio)',
    patron: /\.glassEffect\(/,
    excepto: ['Palco/Cristal/Cristal.swift', 'Palco/Galeria/LaboratorioView.swift'],
  },
  {
    id: 'R5',
    texto: 'una sola puerta: .sensoryFeedback( solo en Palco/Haptica/HapticaRaiz.swift',
    patron: /\.sensoryFeedback\(/,
    excepto: ['Palco/Haptica/HapticaRaiz.swift'],
  },
  {
    id: 'R5',
    texto: 'una sola puerta: .sheet( solo en Armazon/Hojas.swift',
    patron: /\.sheet\(/,
    excepto: ['Armazon/Hojas.swift'],
  },
  {
    id: 'R5',
    texto: 'una sola puerta: .contextMenu( solo en Armazon/Menus.swift',
    patron: /\.contextMenu\(/,
    excepto: ['Armazon/Menus.swift'],
  },
  {
    id: 'R5',
    texto: 'una sola puerta: VistaVideo( solo en el escenario, el mini y el vuelo',
    patron: /\bVistaVideo\(/,
    excepto: [
      'Pantallas/Partido/EscenarioVideo.swift',
      'Pantallas/Mini/MiniReproductor.swift',
      'Armazon/VueloVideo.swift',
      'Player/SuperficieVideo.swift',
    ],
  },
  {
    id: 'R6',
    texto: 'colores solo de Palco (nada de Color(red:…), Color(hex:…), UIColor(red:…), #colorLiteral ni 0xRRGGBB)',
    patron: /Color\((red|\.sRGB|hex)|UIColor\((red|hex)|#colorLiteral|0x[0-9A-Fa-f]{6}\b/,
    excepto: ['Palco/Tokens'],
  },
  {
    id: 'R7',
    texto: 'fuentes solo de Mona (nada de Font.system, .font(.system…), Font.custom, UIFont.systemFont, UIFont(name:))',
    patron: /Font\.system|\.font\(\.system|Font\.custom|UIFont\.systemFont|UIFont\(name/,
    excepto: ['Palco/Tipografia'],
  },
  {
    id: 'R8',
    texto: 'háptica solo por Haptica (nada de UI…FeedbackGenerator)',
    patron: /UI(Impact|Selection|Notification)FeedbackGenerator/,
  },
  {
    id: 'R9',
    texto: 'identificadores solo de IDUI (accessibilityIdentifier(IDUI.…), nunca con un literal)',
    patron: /accessibilityIdentifier\("/,
  },
  {
    id: 'R10',
    texto: 'concurrencia: nonisolated(unsafe), @unchecked Sendable, Task.detached, DispatchQueue o MainActor.assumeIsolated (con «// permitido: motivo»)',
    patron: /nonisolated\(unsafe\)|@unchecked Sendable|Task\.detached|DispatchQueue|MainActor\.assumeIsolated/,
    donde: CARPETAS_NUEVAS.concat(['Core/Emparejar']),
    permiso: true,
  },
  {
    id: 'R11',
    texto: 'observación moderna (@Observable): nada de ObservableObject, @Published, @StateObject, @ObservedObject ni @EnvironmentObject',
    patron: /ObservableObject|@Published|@StateObject|@ObservedObject|@EnvironmentObject/,
  },
  {
    id: 'R12',
    texto: 'lo puro es puro: solo Foundation (nada de SwiftUI, UIKit, os, Observation, AVFoundation, AVKit, CoreGraphics ni CGFloat)',
    patron: /^\s*import (SwiftUI|UIKit|os|Observation|AVFoundation|AVKit|CoreGraphics)\b|\bCGFloat\b/,
    donde: PURO,
  },
  {
    id: 'R13',
    texto: 'nada public/open nuevo (todo internal)',
    patron: /^\s*(public|open) /,
    donde: ['Palco', 'Armazon', 'Pantallas', 'Core/Datos', 'Core/Reglas', 'Core/Emparejar'],
  },
  {
    id: 'R14',
    texto: 'reloj inyectado: nada de Date(), Date.now ni .now (usa Reloj)',
    patron: /Date\(\)|Date\.now|\.now\b/,
    donde: ['Core/Reglas', 'Pantallas', 'Armazon'],
    excepto: ['Core/Reglas/Datos/Reloj.swift'],
  },
  { id: 'R15', texto: 'sin print(', patron: /\bprint\(/, excepto: ['Debug'] },
  {
    id: 'R16',
    texto: 'animación con valor: .animation(_:value:), nunca .animation(x) a secas',
    patron: /\.animation\([^,()]*\)\s*$/,
  },
  { id: 'R17', texto: 'sin temporizadores (Timer., asyncAfter): usa Task.sleep', patron: /\bTimer\.|asyncAfter/ },
  {
    id: 'R18',
    texto: 'preferencias en su sitio: UserDefaults.standard solo en PreferenciasLocales, MigracionClaves, AppDelegate y Entorno',
    patron: /UserDefaults\.standard/,
    excepto: ['App/PreferenciasLocales.swift', 'App/MigracionClaves.swift', 'App/AppDelegate.swift', 'App/Entorno.swift'],
  },
  { id: 'R19', texto: 'sin pantalla global (UIScreen.main): usa la ventana', patron: /UIScreen\.main/ },
];

const LIMITE_LINEAS = 400; // R20 (aviso)

// ---------------------------------------------------------------- lectura

/**
 * Quita comentarios (// y /* *\/) y vacía el texto de las cadenas ("…", """…""", #"…"#),
 * conservando la forma de cada línea. Devuelve las líneas limpias.
 */
function limpiar(fuente) {
  const salida = [];
  let actual = '';
  let enBloque = 0; // comentarios /* */ anidados (Swift los anida)
  let cadena = null; // { multilinea, almohadillas }
  const lineas = fuente.split('\n');
  for (const linea of lineas) {
    actual = '';
    let i = 0;
    while (i < linea.length) {
      const c = linea[i];
      const sig = linea[i + 1];
      if (enBloque) {
        if (c === '/' && sig === '*') {
          enBloque += 1;
          i += 2;
        } else if (c === '*' && sig === '/') {
          enBloque -= 1;
          i += 2;
        } else {
          i += 1;
        }
        continue;
      }
      if (cadena) {
        const cierre = (cadena.multilinea ? '"""' : '"') + '#'.repeat(cadena.almohadillas);
        if (c === '\\' && cadena.almohadillas === 0) {
          i += 2;
          continue;
        }
        if (linea.startsWith(cierre, i)) {
          actual += cierre;
          i += cierre.length;
          cadena = null;
          continue;
        }
        i += 1;
        continue;
      }
      if (c === '/' && sig === '/') break;
      if (c === '/' && sig === '*') {
        enBloque = 1;
        i += 2;
        continue;
      }
      if (c === '#' || c === '"') {
        let j = i;
        while (linea[j] === '#') j += 1;
        if (linea[j] === '"') {
          const almohadillas = j - i;
          const multilinea = linea.startsWith('"""', j);
          const apertura = '#'.repeat(almohadillas) + (multilinea ? '"""' : '"');
          actual += apertura;
          i = j + (multilinea ? 3 : 1);
          cadena = { multilinea, almohadillas };
          continue;
        }
      }
      actual += c;
      i += 1;
    }
    // Una cadena de una línea sin cerrar (no debería pasar) no arrastra a la siguiente.
    if (cadena && !cadena.multilinea) cadena = null;
    salida.push(actual);
  }
  return salida;
}

function ficheros(carpeta) {
  const salida = [];
  for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
    const ruta = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) salida.push(...ficheros(ruta));
    else if (entrada.name.endsWith('.swift') && !entrada.name.endsWith('.generado.swift')) salida.push(ruta);
  }
  return salida.sort();
}

// ---------------------------------------------------------------- revisión

try {
  statSync(SOURCES);
} catch {
  console.error(`No existe ${SOURCES}`);
  process.exit(2);
}

const fallos = [];
const avisos = [];
let revisados = 0;
for (const fichero of ficheros(SOURCES)) {
  const rel = path.relative(SOURCES, fichero).replace(/\\/g, '/');
  if (!TODO && !en(rel, CARPETAS_NUEVAS)) continue;
  revisados += 1;
  const fuente = readFileSync(fichero, 'utf8').replace(/\r\n/g, '\n');
  const crudas = fuente.split('\n');
  const limpias = limpiar(fuente);
  if (crudas.length > LIMITE_LINEAS) avisos.push(`${rel}: ${crudas.length} líneas (R20: más de ${LIMITE_LINEAS}; pártelo)`);
  for (const regla of REGLAS) {
    if (regla.donde && !en(rel, regla.donde)) continue;
    if (regla.excepto && en(rel, regla.excepto)) continue;
    limpias.forEach((linea, n) => {
      const cruda = crudas[n];
      const texto = linea;
      if (!regla.patron.test(texto)) return;
      if (regla.id === 'R2' && /@available\(\*,\s*unavailable\)/.test(texto)) return;
      if (regla.permiso && /\/\/\s*permitido:\s*\S/.test(cruda)) return;
      fallos.push(`${rel}:${n + 1}: ${regla.id} ${regla.texto}\n    ${cruda.trim()}`);
    });
  }
}

for (const a of avisos) console.warn(`aviso: ${a}`);
if (fallos.length) {
  console.error(fallos.join('\n'));
  console.error(`\n${fallos.length} incumplimiento(s) de b-arquitectura §5.2 en ${revisados} fichero(s).`);
  process.exit(1);
}
console.log(
  `revisar-swift: ${revisados} fichero(s) sin incumplimientos (${TODO ? 'todo Sources' : 'carpetas nuevas: ' + CARPETAS_NUEVAS.join(', ')}).`,
);
