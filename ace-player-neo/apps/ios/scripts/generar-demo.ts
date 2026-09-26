/* La demo de la app = la demo de la web (b-arquitectura §3.3.2, M2; decisión 10 de Isma).

   1. Semillas: los ejemplos de packages/shared/fixtures/v1 (lo que la demo de la web sirve tal cual o
      muta) → Sources/Debug/DemoNucleo/SemillasDemo.generado.swift (JSON en base64, bajo `#if DEBUG`).
   2. Golden: ejecuta la demo REAL de la web (api/demo/index.ts con los manejadores de agenda, fuentes,
      buscador, salud, dispositivos y listas; vectores/_cargador.ts) con el reloj fijado en
      T0 = 2026-09-24T19:00:00+02:00 (y T0 + 5 min, T0 + 2 h… según la ruta), `Math.random` sembrado con
      xorshift32 (semilla 1) y `localStorage` vacío, y escribe cada guion con sus respuestas en
      Tests/AceNeoTests/Vectores/demo/demo-<guion>.json. `DemoGoldenTests` repite los mismos pasos contra
      `RutasDemo` y exige el mismo JSON (lo que depende del reloj se porta como código y esto lo vigila).

   Uso (desde ace-player-neo/):
     corepack pnpm@10.18.2 exec tsx apps/ios/scripts/generar-demo.ts           # escribe
     corepack pnpm@10.18.2 exec tsx apps/ios/scripts/generar-demo.ts --check   # falla si algo está viejo (CI) */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  cerrar,
  fijarReloj,
  IOS,
  json,
  SHARED,
  sembrarAzar,
  vaciarAlmacen,
  VECTORES,
  web,
} from './vectores/_cargador.ts';

/** Jueves 24-sep-2026, 19:00 de Madrid: la hora de las capturas (a7 §5.1). */
const T0 = Date.parse('2026-09-24T19:00:00+02:00');
const MIN = 60_000;
const comprobar = process.argv.includes('--check');

// ---- 1. Semillas ------------------------------------------------------------------------------------

function semillas(): string {
  const carpeta = path.join(SHARED, 'fixtures/v1');
  const nombres = readdirSync(carpeta)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
  const lineas = nombres.map((nombre) => {
    const crudo = readFileSync(path.join(carpeta, `${nombre}.json`), 'utf8');
    const compacto = JSON.stringify(JSON.parse(crudo));
    const base64 = Buffer.from(compacto, 'utf8').toString('base64');
    // Líneas de 120 (SwiftLint corta a 1000 y avisa desde 160); el lector ignora los saltos.
    const trozos = base64.match(/.{1,120}/g) ?? [''];
    const cuerpo = trozos.map((t) => `                ${t}`);
    return [`            "${nombre}": """`, ...cuerpo, '                """,'].join('\n');
  });
  return `// GENERADO por scripts/generar-demo.ts desde packages/shared/fixtures/v1. No editar.

#if DEBUG
    import Foundation

    /// Los ejemplos de cada respuesta de /api/v1 (packages/shared/fixtures/v1), los mismos que sirve la demo
    /// de la web (api/demo/index.ts): JSON compacto en base64.
    enum SemillasDemo {
        static let base64: [String: String] = [
${lineas.join('\n')}
        ]

        /// ¿Hay ejemplo para esa ruta (\`RutaID.rawValue\`)?
        static func tiene(_ ruta: String) -> Bool { base64[ruta] != nil }

        /// El ejemplo de esa ruta como JSON (\`null\` si no hay).
        static func fixture(_ ruta: String) -> JSON {
            guard let texto = base64[ruta], let datos = Data(base64Encoded: texto, options: .ignoreUnknownCharacters),
                let valor = try? JSON.leer(datos)
            else {
                return .nulo
            }
            return valor
        }
    }
#endif
`;
}

// ---- 2. Golden -----------------------------------------------------------------------------------------

interface Paso {
  /** ms desde T0. */
  t: number;
  ruta: string;
  params?: Record<string, string>;
  query?: Array<[string, string]>;
  cuerpo?: unknown;
}

interface Guion {
  nombre: string;
  descripcion: string;
  pasos: Paso[] | ((respuestas: unknown[]) => Paso | null)[];
}

type Manejar = (id: string, req: { params: object; query: object; body: unknown }) => Promise<unknown>;

/** `query` de la web: una clave repetida es una lista (como la lee el servidor). */
function consulta(pares: Array<[string, string]> = []): Record<string, string | string[]> {
  const salida: Record<string, string | string[]> = {};
  for (const [k, v] of pares) {
    const previo = salida[k];
    salida[k] = previo === undefined ? v : Array.isArray(previo) ? [...previo, v] : [previo, v];
  }
  return salida;
}

const scanDe = (r: unknown): string => ((r as { scan?: { id?: string } | null })?.scan?.id ?? 'no-hay');
const primeraDe = (r: unknown): string => ((r as { candidates?: Array<{ id: string }> })?.candidates?.[0]?.id ?? '');

const PARTIDOS = Array.from({ length: 13 }, (_, i) => `demo-${i + 1}`);
const TIEMPOS_SCAN = [0, 1350, 2700, 4050, 5400, 10_000, 20_000, 6 * MIN, 45 * MIN];

const GUIONES: Guion[] = [
  {
    nombre: 'footballSchedule',
    descripcion: 'Agenda de muestra en T0, T0 + 5 min y T0 + 2 h (el ancla no se mueve)',
    pasos: [0, 5 * MIN, 2 * 60 * MIN].map((t) => ({ t, ruta: 'footballSchedule' })),
  },
  {
    nombre: 'scores',
    descripcion: 'Marcadores de muestra según el reloj',
    pasos: [0, 5 * MIN, 45 * MIN, 2 * 60 * MIN, 5 * 60 * MIN].map((t) => ({ t, ruta: 'scores' })),
  },
  {
    nombre: 'footballPreheat',
    descripcion: 'Precalentado de cada partido',
    pasos: [...PARTIDOS, 'demo-99'].map((matchId) => ({ t: 0, ruta: 'footballPreheat', params: { matchId } })),
  },
  {
    nombre: 'footballResolve',
    descripcion: 'Resolución de cada guion (y «Rebuscar», y un canal suelto)',
    pasos: [
      ...['demo-1', 'demo-4', 'demo-12', 'demo-2', 'demo-3', 'demo-6', 'demo-13'].map((match, i) => ({
        t: i,
        ruta: 'footballResolve',
        query: [['match', match], ['channel', 'DAZN'], ['channel', 'Otro']] as Array<[string, string]>,
      })),
      { t: 10, ruta: 'footballResolve', query: [['match', 'demo-1'], ['channel', 'DAZN'], ['research', '1']] },
      { t: 11, ruta: 'footballResolve', query: [['channel', 'DAZN 1']] },
      { t: 12, ruta: 'footballResolve', query: [] },
    ],
  },
  ...['demo-1', 'demo-4', 'demo-12', 'demo-6'].map(
    (match): Guion => ({
      nombre: `footballScan-${match}`,
      descripcion: `Comprobador de ${match} paso a paso (1 350 ms por paso)`,
      pasos: [
        () => ({ t: 0, ruta: 'footballResolve', query: [['match', match], ['channel', 'DAZN']] }),
        ...TIEMPOS_SCAN.map((t) => (r: unknown[]) => ({ t, ruta: 'footballScan', params: { id: scanDe(r[0]) } })),
      ],
    }),
  ),
  {
    nombre: 'footballScan-cancelado',
    descripcion: 'Un trabajo que no existe sale cancelado',
    pasos: [{ t: 0, ruta: 'footballScan', params: { id: 'de0000000000000000000000' } }],
  },
  {
    nombre: 'sourcesReport',
    descripcion: 'Reportar una fuente de un trabajo y una externa, y seguir el reporte',
    pasos: [
      () => ({ t: 0, ruta: 'footballResolve', query: [['match', 'demo-1'], ['channel', 'DAZN']] }),
      (r) => ({ t: 3000, ruta: 'sourcesReport', cuerpo: { id: primeraDe(r[0]), channel: 'DAZN', matchId: 'demo-1' } }),
      (r) => ({ t: 3000 + 2700, ruta: 'footballScan', params: { id: scanDe(r[1]) } }),
      () => ({ t: 9000, ruta: 'sourcesReport', cuerpo: { id: 'ffffffffffffffffffffffffffffffffffffffff', reason: 'wrong_channel' } }),
      (r) => ({ t: 9000 + 2700, ruta: 'footballScan', params: { id: scanDe(r[3]) } }),
    ],
  },
  {
    nombre: 'footballBind',
    descripcion: '«Es el canal correcto»',
    pasos: [
      { t: 0, ruta: 'footballBind', cuerpo: { channel: 'DAZN LaLiga', id: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01', title: 'DAZN LaLiga FHD', ih: true } },
      { t: 1, ruta: 'footballBind', cuerpo: { channel: '***', id: 'abcdef0123456789abcdef0123456789abcdef01' } },
    ],
  },
  {
    nombre: 'search',
    descripcion: 'Buscador de muestra',
    pasos: ['dazn', 'deportes', '', 'LIGA', 'Líga de campeones', 'ñ', 'm+'].map((q) => ({ t: 0, ruta: 'search', query: [['q', q]] })),
  },
  {
    nombre: 'health',
    descripcion: 'Salud de muestra',
    pasos: [0, 2 * 60 * MIN].map((t) => ({ t, ruta: 'health' })),
  },
  {
    nombre: 'diagnosticsList',
    descripcion: 'Registro de muestra con y sin filtro',
    pasos: [
      { t: 0, ruta: 'diagnosticsList' },
      { t: 0, ruta: 'diagnosticsList', query: [['cause', 'source']] },
      { t: 0, ruta: 'diagnosticsList', query: [['limit', '2']] },
      { t: 0, ruta: 'diagnosticsList', query: [['cause', 'engine'], ['limit', '1']] },
    ],
  },
  {
    nombre: 'pairingCreate',
    descripcion: 'Código de emparejar (azar sembrado) y QR de adorno',
    pasos: [{ t: 0, ruta: 'pairingCreate' }, { t: 1000, ruta: 'pairingCreate' }],
  },
  {
    nombre: 'library',
    descripcion: 'Biblioteca, sus mutaciones y las listas',
    pasos: [
      { t: 0, ruta: 'libraryGet' },
      { t: 1000, ruta: 'libraryMutate', cuerpo: { action: 'favorite-upsert', item: { id: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01', title: 'Nuevo favorito', ih: true } } },
      { t: 2000, ruta: 'libraryMutate', cuerpo: { action: 'favorite-upsert', item: { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', category: 'Deportes' } } },
      { t: 3000, ruta: 'libraryMutate', cuerpo: { action: 'history-upsert', item: { id: '0feeabf0888811b8dd55c807eef65f8d85fa4cce', title: 'DAZN', ih: false } } },
      { t: 4000, ruta: 'libraryMutate', cuerpo: { action: 'history-upsert', item: { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', title: 'DAZN 1', ih: false } } },
      { t: 5000, ruta: 'libraryMutate', cuerpo: { action: 'rename', collection: 'web', id: 'B2C3D4E5F60718293A4B5C6D7E8F901234567890', title: 'M+ LaLiga TV' } },
      { t: 6000, ruta: 'libraryMutate', cuerpo: { action: 'delete', collection: 'favorites', id: 'abcdef0123456789abcdef0123456789abcdef01' } },
      { t: 7000, ruta: 'libraryGet' },
      { t: 8000, ruta: 'directoriesGet' },
      { t: 9000, ruta: 'directoriesSync', cuerpo: { url: 'https://example.com/lista.m3u' } },
      { t: 9000, ruta: 'directoriesActivate', params: { id: 'principal' } },
      { t: 9000, ruta: 'directoriesDelete', params: { id: 'principal' } },
    ],
  },
  {
    nombre: 'preferences',
    descripcion: 'Gustos y ajustes guardados en la demo',
    pasos: [
      { t: 0, ruta: 'preferencesGet' },
      { t: 1000, ruta: 'preferencesUpdate', cuerpo: { leagues: ['LaLiga'], teams: ['Real Madrid', 'Girona'] } },
      { t: 2000, ruta: 'preferencesGet' },
      { t: 3000, ruta: 'settingsGet' },
      { t: 4000, ruta: 'settingsUpdate', cuerpo: { sameChannelPolicy: 'exclusive' } },
      { t: 5000, ruta: 'settingsGet' },
    ],
  },
  {
    nombre: 'devices',
    descripcion: 'Dispositivos: lista, revocar y uno que no existe',
    pasos: [
      { t: 0, ruta: 'devicesList' },
      { t: 60_000, ruta: 'deviceRevoke', params: { id: 'dev_iphone01' } },
      { t: 61_000, ruta: 'deviceRevoke', params: { id: 'dev_no_existe' } },
      { t: 62_000, ruta: 'devicesList' },
    ],
  },
  {
    nombre: 'base',
    descripcion: 'Lo que sale del ejemplo base tal cual (y el arranque de la web, que la app adapta)',
    pasos: [
      { t: 0, ruta: 'bootstrap' },
      { t: 0, ruta: 'ping' },
      { t: 0, ruta: 'engineStatus' },
      { t: 0, ruta: 'engineRestart' },
      { t: 0, ruta: 'playbackStatus' },
      { t: 0, ruta: 'sourcesOutcome', cuerpo: {} },
      { t: 0, ruta: 'sourcesFeedback', cuerpo: {} },
      { t: 0, ruta: 'diagnosticsReport', cuerpo: {} },
      { t: 0, ruta: 'sessionHeartbeat', params: { sid: 's_demo' }, cuerpo: {} },
      { t: 0, ruta: 'sessionRelease', params: { sid: 's_demo' }, cuerpo: {} },
      { t: 0, ruta: 'channelStream', params: { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' } },
    ],
  },
];

async function golden(): Promise<Map<string, string>> {
  fijarReloj(T0);
  sembrarAzar(1);
  vaciarAlmacen();
  // Una sola carga de la web: la agenda (y su ancla) se carga con el reloj en T0.
  const modo = await web<{ setMode(m: string, r: unknown): void }>('api/mode.ts');
  modo.setMode('demo', 'forced');
  const base = await web<{ handleDemo: Manejar; resetDemoState(): void }>('api/demo/index.ts');
  await web('features/agenda/demo.ts');
  await web('features/sources/demo.ts');
  const buscador = await web<{ registerSearchDemo(): void }>('features/search/demo.ts');
  const salud = await web<{ registerHealthDemo(): void }>('features/health/demo.ts');
  const dispositivos = await web<{ registerDevicesDemo(): void }>('features/devices/demo.ts');
  const listas = await web<{ registerDirectoriesDemo(): void }>('features/directories/model.ts');
  const fuentes = await web<{ resetDemoJobs(): void }>('features/sources/demo-data.ts');
  const agenda = await web<{ setDemoAnchor(n: number): void }>('features/agenda/demo-data.ts');
  const almacen = await web<{ resetMemoryStorage(): void }>('lib/storage.ts');
  buscador.registerSearchDemo();
  salud.registerHealthDemo();
  dispositivos.registerDevicesDemo();
  listas.registerDirectoriesDemo();
  // Sin los 120/260 ms de espera de verdad (el reloj falso no avanza con ellos): la app los tiene en RutasDemo.
  const setTimeoutReal = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void) => setTimeoutReal(fn, 0)) as typeof setTimeout;

  const salida = new Map<string, string>();
  for (const guion of GUIONES) {
    fijarReloj(T0);
    sembrarAzar(1);
    vaciarAlmacen();
    almacen.resetMemoryStorage();
    base.resetDemoState();
    fuentes.resetDemoJobs();
    agenda.setDemoAnchor(T0);
    const respuestas: unknown[] = [];
    const pasos: unknown[] = [];
    for (const entrada of guion.pasos) {
      const paso = typeof entrada === 'function' ? entrada(respuestas) : entrada;
      if (!paso) continue;
      fijarReloj(T0 + paso.t);
      let respuesta: unknown = null;
      let error: unknown = null;
      try {
        respuesta = await base.handleDemo(paso.ruta, {
          params: paso.params ?? {},
          query: consulta(paso.query),
          body: paso.cuerpo,
        });
      } catch (e) {
        const fallo = e as { code?: string; status?: number };
        error = { code: fallo.code ?? 'desconocido', status: fallo.status ?? 0 };
      }
      respuestas.push(respuesta);
      pasos.push({
        t: paso.t,
        ruta: paso.ruta,
        params: paso.params ?? {},
        query: paso.query ?? [],
        cuerpo: paso.cuerpo ?? null,
        ...(error ? { error } : { respuesta }),
      });
    }
    salida.set(
      `demo/demo-${guion.nombre}.json`,
      json({
        aviso: 'Generado por apps/ios/scripts/generar-demo.ts ejecutando la demo de la web. No se edita a mano.',
        descripcion: guion.descripcion,
        t0: new Date(T0).toISOString(),
        pasos,
      }),
    );
  }
  globalThis.setTimeout = setTimeoutReal;
  return salida;
}

// ---- Escribir o comprobar ---------------------------------------------------------------------------------

const ficheros = new Map<string, string>();
ficheros.set(path.join(IOS, 'Sources/Debug/DemoNucleo/SemillasDemo.generado.swift'), semillas());
try {
  for (const [relativo, texto] of await golden()) ficheros.set(path.join(VECTORES, relativo), texto);
} finally {
  await cerrar();
}

let viejos = 0;
for (const [destino, texto] of ficheros) {
  const nombre = path.relative(IOS, destino).replace(/\\/g, '/');
  if (comprobar) {
    let actual = '';
    try {
      actual = readFileSync(destino, 'utf8').replace(/\r\n/g, '\n');
    } catch {
      actual = '';
    }
    if (actual !== texto) {
      viejos += 1;
      console.error(`✗ ${nombre} no está al día con la demo de la web`);
    }
  } else {
    mkdirSync(path.dirname(destino), { recursive: true });
    writeFileSync(destino, texto);
  }
}
if (comprobar && viejos > 0) {
  console.error('Ejecuta: corepack pnpm@10.18.2 exec tsx apps/ios/scripts/generar-demo.ts');
  process.exit(1);
}
console.log(comprobar ? `Demo al día (${ficheros.size} ficheros).` : `Escritos ${ficheros.size} ficheros de la demo.`);
