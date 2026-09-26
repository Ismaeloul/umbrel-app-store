/* Latencia de la IPTV en la web y arranque (docs/multidispositivo.md §4 y
   §6.3), contra la pila entera con el proveedor IPTV falso y ffmpeg de
   verdad. Etiqueta @video: corre en los dos Chrome. Sin ffmpeg en el PATH se
   salta (en el PC de Isma, el de L-Connect 3).

   Qué se mide (y se deja en test-results/latencia-<proyecto>.json):
   - «Retraso» de hls.js en los tres modos: lo que el <video> va por detrás
     del final de la lista (`seekable.end − currentTime`, lo mismo que
     `hls.latency`). Es la parte que deciden los modos.
   - Retraso del final de la lista respecto al proveedor: cuándo aparece cada
     segmento en /api/v1/video frente a cuándo salió del proveedor falso su
     último cuadro (`/__iptv/aperturas`: el segundo `s` del stream sale a las
     `apertura + s − colchón`, en tiempo real). Es lo que cuesta cortar en
     segmentos (hasta un GOP).
   - La suma de los dos es el retraso de verdad sobre lo que manda el
     proveedor. El iPhone (AVPlayer) no se puede medir aquí: se deja escrito
     lo que le toca con la regla de 3 × TARGETDURATION.
   - Arranque de la IPTV hasta la primera imagen, sin colchón del proveedor y
     con el de 8 s de la pila.

   Umbrales holgados (este PC con la VPN y la batería en paralelo): lo que
   importa son los números del informe. */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { FUENTES } from './support/catalogo.ts';
import { readPorts } from './support/puertos.ts';
import { backend, detenerReproductor, esperarQueAvance, expect, test } from './support/pruebas.ts';

const ports = readPorts();
const CONTROL = `http://[::1]:${ports.iptv}`;
const SERVIDOR = 'http://iptv.ace-e2e.example:8080';
const USUARIO = 'usuario-e2e';
const CLAVE = 'Cl4ve-Secreta-E2E';
const ANTENA3 = FUENTES.generalistas[0];
/** «ES: Antena 3 FHD» en el proveedor falso. */
const ANTENA3_IPTV = 108;

function hayFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const falta = !hayFfmpeg() ? 'falta ffmpeg en el PATH (el remux IPTV lo necesita)' : null;
test.skip(falta !== null, falta ?? '');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function control<T>(ruta: string): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`${CONTROL}/__iptv/${ruta}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`/__iptv/${ruta} → ${res.status}`);
      return (await res.json()) as T;
    } catch (error) {
      ultimo = error;
      await sleep(250 * (i + 1));
    }
  }
  throw new Error(`/__iptv/${ruta}: ${String(ultimo)}`);
}

interface Aperturas {
  canales: Record<string, { firstOpenAt: number; lastOpenAt: number; opens: number }>;
  burstSeconds: number;
  gopFrames: number;
}

const proveedor = {
  reset: () => control('reset'),
  ajustes: (colchon: number, gop = 25) => control(`ajustes?colchon=${colchon}&gop=${gop}`),
  aperturas: () => control<Aperturas>('aperturas'),
  conexiones: () => control<{ conexiones: number }>('conexiones').then((r) => r.conexiones),
};

async function conectarXtream(): Promise<void> {
  const res = await backend.pedir('/api/v1/iptv', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'xtream',
      name: 'Casa',
      server: SERVIDOR,
      username: USUARIO,
      password: CLAVE,
    }),
  });
  expect(res.status, await res.text()).toBe(200);
  await expect
    .poll(
      async () => {
        const view = (await (await backend.pedir('/api/v1/iptv')).json()) as {
          provider: { status: string; channels: number } | null;
        };
        return view.provider?.status === 'ok' && view.provider.channels > 0;
      },
      { timeout: 60_000, intervals: [500, 1000] },
    )
    .toBe(true);
}

/**
 * Nada sonando en casa (sin sesiones en el backend) y, si se puede, el
 * proveedor sin conexiones (una sonda de fondo de la IPTV también cuenta; se
 * aborta sola al abrir una sesión, así que no se exige).
 */
async function sinNadaSonando(): Promise<void> {
  let ultimo = '';
  await expect
    .poll(
      async () => {
        const status = (await (await backend.pedir('/api/v1/playback')).json()) as {
          sessions: unknown[];
        };
        ultimo = JSON.stringify(status.sessions);
        return status.sessions.length;
      },
      { timeout: 60_000, intervals: [500, 1000] },
    )
    .toBe(0)
    .catch((error: unknown) => {
      throw new Error(`sesiones que quedan: ${ultimo}`, { cause: error });
    });
  for (let i = 0; i < 20 && (await proveedor.conexiones()) > 0; i++) await sleep(500);
}

interface Estado {
  sessionId: string | null;
  streamSource: string | null;
  iptvInput: string | null;
  segment: { targetS: number; minS: number | null; maxS: number | null } | null;
  ttffMs: number | null;
  engine: string | null;
}

function estado(page: Page): Promise<Estado> {
  return page.evaluate(() => {
    const s = (globalThis as { __acePlayer?: { get(): Estado } }).__acePlayer?.get();
    return {
      sessionId: s?.sessionId ?? null,
      streamSource: s?.streamSource ?? null,
      iptvInput: s?.iptvInput ?? null,
      segment: s?.segment ?? null,
      ttffMs: s?.ttffMs ?? null,
      engine: s?.engine ?? null,
    };
  });
}

interface Muestra {
  /** Distancia del <video> al final de la lista (lo que persigue hls.js). */
  d: number | null;
  paused: boolean;
  /** Segundos cargados por delante del cabezal. */
  ahead: number;
  phase: string;
  /** `hls.latency` (lo que enseña «Retraso» en «Datos técnicos»). */
  lat: number | null;
}

function muestra(page: Page): Promise<Muestra> {
  return page.evaluate(() => {
    const video = document.querySelector('video');
    const hook = (
      globalThis as {
        __acePlayer?: {
          get(): { phase: string };
          runtime?: { engineInfo(): { latencyS?: number } };
        };
      }
    ).__acePlayer;
    const phase = hook?.get().phase ?? '';
    const lat = hook?.runtime?.engineInfo().latencyS ?? null;
    if (!video) return { d: null, paused: true, ahead: 0, phase, lat };
    let ahead = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (
        video.buffered.start(i) <= video.currentTime &&
        video.buffered.end(i) >= video.currentTime
      )
        ahead = video.buffered.end(i) - video.currentTime;
    }
    const d =
      video.seekable.length === 0
        ? null
        : video.seekable.end(video.seekable.length - 1) - video.currentTime;
    return { d, paused: video.paused, ahead, phase, lat };
  });
}

async function distancia(page: Page): Promise<number | null> {
  const m = await muestra(page);
  return m.paused ? null : m.d;
}

function mediana(valores: number[]): number {
  const orden = [...valores].sort((a, b) => a - b);
  if (!orden.length) return Number.NaN;
  const mitad = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[mitad]! : (orden[mitad - 1]! + orden[mitad]!) / 2;
}

const r2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Sigue la lista del remux desde Node: cuándo aparece cada segmento frente a
 * cuándo salió del proveedor su último cuadro. Devuelve la función que para y
 * resume.
 */
function seguirLista(sid: string, apertura: number, colchonS: number) {
  const vistos = new Map<number, { dur: number; at: number; alEmpezar: boolean }>();
  let parar = false;
  let primera = true;
  const bucle = (async () => {
    while (!parar) {
      try {
        const res = await fetch(`${backend.url}/api/v1/video/${sid}/index.m3u8`, {
          signal: AbortSignal.timeout(5_000),
        });
        const texto = await res.text();
        const ahora = Date.now();
        const secuencia = Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(texto)?.[1] ?? 0);
        const duraciones = [...texto.matchAll(/#EXTINF:([\d.]+)/g)].map((m) => Number(m[1]));
        duraciones.forEach((dur, i) => {
          const seq = secuencia + i;
          if (!vistos.has(seq)) vistos.set(seq, { dur, at: ahora, alEmpezar: primera });
        });
        if (duraciones.length) primera = false;
      } catch {}
      await sleep(100);
    }
  })();
  return async () => {
    parar = true;
    await bucle;
    const seqs = [...vistos.keys()].sort((a, b) => a - b);
    /* Solo si se tienen todos desde el 0 (si no, no se sabe el tiempo de medio). */
    if (!seqs.length || seqs[0] !== 0)
      return { retrasosLista: [] as number[], segmentos: seqs.length };
    let fin = 0;
    const retrasos: number[] = [];
    for (const seq of seqs) {
      const { dur, at, alEmpezar } = vistos.get(seq)!;
      fin += dur;
      /* Los que ya estaban al empezar a mirar no dicen cuándo aparecieron. */
      if (alEmpezar) continue;
      retrasos.push((at - (apertura + Math.max(0, fin - colchonS) * 1000)) / 1000);
    }
    return { retrasosLista: retrasos, segmentos: seqs.length };
  };
}

async function abrirAntena3(page: Page, modo: 'low' | 'balanced' | 'stable'): Promise<void> {
  await page.goto('/?vista=biblioteca');
  await page.evaluate((m) => localStorage.setItem('aceneo-pb', m), modo);
  await page.reload();
  await page.getByRole('link', { name: ANTENA3.title, exact: true }).first().click();
  await page.waitForURL(/vista=partido/);
}

test.beforeEach(async () => {
  await proveedor.reset();
  await backend.pedir('/api/v1/iptv', { method: 'DELETE' });
  await backend.guardarFavorito(ANTENA3.id, ANTENA3.title);
  await conectarXtream();
});
test.afterEach(async () => {
  await backend.pedir('/api/v1/iptv', { method: 'DELETE' });
  await proveedor.reset();
});

/** `liveEdgeOffsetS` de la concesión nativa con TD 1 (docs/multidispositivo.md §4.4). */
const IPHONE_OBJETIVO_S = { low: 3, balanced: 6, stable: 10 } as const;

interface MedidaModo {
  modo: keyof typeof IPHONE_OBJETIVO_S;
  distanciaS: number;
  distanciaP90S: number;
  retrasoListaS: number | null;
  retrasoRealS: number | null;
  segmento: Estado['segment'];
  iptvInput: string | null;
  muestras: number;
  /** Muestras con el vídeo en pausa (el reproductor rellenando el colchón tras un parón). */
  pausadas: number;
  fases: string;
}

test(
  'IPTV en la web: los tres modos en segundos (hls.js), «Segmento» y «Origen … TS»',
  { tag: '@video' },
  async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    const soloModos = process.env.E2E_LATENCIA_MODOS?.split(',');
    const modos = (
      [
        ['low', 0, 5.5],
        ['balanced', 5, 8],
        ['stable', 9, 13],
      ] as const
    ).filter(([modo]) => !soloModos || soloModos.includes(modo));
    const medidas: MedidaModo[] = [];
    for (const [modo, minimo, maximo] of modos) {
      await detenerReproductor(page);
      await sinNadaSonando();
      await proveedor.reset();
      await proveedor.ajustes(0.2);
      await abrirAntena3(page, modo);
      await esperarQueAvance(page, 60_000);
      const inicio = await estado(page);
      expect(inicio.streamSource).toBe('iptv');
      expect(inicio.engine).toBe('hls');
      const sid = inicio.sessionId as string;
      const aperturas = await proveedor.aperturas();
      const apertura = aperturas.canales[String(ANTENA3_IPTV)]?.lastOpenAt ?? 0;
      const resumen = seguirLista(sid, apertura, aperturas.burstSeconds);
      /* hls.js arranca ya a su distancia; se deja asentar y se mide 20 s. */
      await page.waitForTimeout(6_000);
      const muestras: number[] = [];
      const todas: Muestra[] = [];
      for (let i = 0; i < 40; i++) {
        const m = await muestra(page);
        todas.push(m);
        if (!m.paused && m.d !== null) muestras.push(m.d);
        await page.waitForTimeout(500);
      }
      await testInfo.attach(`muestras-${modo}`, {
        body: JSON.stringify(todas),
        contentType: 'application/json',
      });
      const lista = await resumen();
      const fin = await estado(page);
      const distanciaS = mediana(muestras);
      const retrasoListaS = lista.retrasosLista.length ? mediana(lista.retrasosLista) : null;
      medidas.push({
        modo,
        distanciaS: r2(distanciaS),
        distanciaP90S: r2(
          [...muestras].sort((a, b) => a - b)[Math.floor(muestras.length * 0.9)] ?? 0,
        ),
        retrasoListaS: retrasoListaS === null ? null : r2(retrasoListaS),
        retrasoRealS: retrasoListaS === null ? null : r2(distanciaS + retrasoListaS),
        segmento: fin.segment,
        iptvInput: fin.iptvInput,
        muestras: muestras.length,
        pausadas: todas.filter((m) => m.paused).length,
        fases: [...new Set(todas.map((m) => m.phase))].join(','),
      });
      /* «Datos técnicos»: «Segmento: 1 s» (GOP de 1 s) y «Origen: IPTV · Casa · TS». */
      expect(fin.segment?.targetS).toBe(1);
      expect(fin.iptvInput).toBe('ts');
      expect(distanciaS, `${modo}: ${JSON.stringify(medidas.at(-1))}`).toBeGreaterThanOrEqual(
        minimo,
      );
      expect(distanciaS, `${modo}: ${JSON.stringify(medidas.at(-1))}`).toBeLessThanOrEqual(maximo);
    }
    const informe = {
      fecha: new Date().toISOString(),
      proyecto: testInfo.project.name,
      proveedor: 'falso, TS, GOP 1 s (25 cuadros), colchón 0,2 s',
      modos: medidas,
      /* El iPhone no se mide aquí: con TD 1 la concesión le pide 3 / 6 / 10 s del
         final (y AVPlayer no baja de 3 × TD), más lo que va la lista por detrás. */
      iphoneEstimadoS: Object.fromEntries(
        medidas.map((m) => [
          m.modo,
          m.retrasoListaS === null ? null : r2(IPHONE_OBJETIVO_S[m.modo] + m.retrasoListaS),
        ]),
      ),
    };
    const salida = path.join(
      testInfo.project.outputDir,
      '..',
      `latencia-${testInfo.project.name}.json`,
    );
    writeFileSync(salida, JSON.stringify(informe, null, 2));
    await testInfo.attach('latencia', {
      body: JSON.stringify(informe, null, 2),
      contentType: 'application/json',
    });
    await detenerReproductor(page);
  },
);

test(
  'arranque de la IPTV hasta la primera imagen: sin colchón ≤ 12 s, con el de 8 s ≤ 5 s',
  { tag: '@video' },
  async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const medidas: { colchonS: number; toqueMs: number; reproductorMs: number | null }[] = [];
    for (const colchon of [0, 0, 8, 8]) {
      await detenerReproductor(page);
      await sinNadaSonando();
      await proveedor.reset();
      await proveedor.ajustes(colchon);
      await page.goto('/?vista=biblioteca');
      await page.evaluate(() => localStorage.setItem('aceneo-pb', 'balanced'));
      await page.reload();
      await page.evaluate(() => {
        const marca = { t0: null as number | null, t1: null as number | null };
        (window as unknown as { __arranque: typeof marca }).__arranque = marca;
        document.addEventListener(
          'pointerdown',
          () => {
            marca.t0 = performance.now();
            const vigilar = () => {
              const video = document.querySelector('video');
              if (!video) return void requestAnimationFrame(vigilar);
              let desde: number | null = null;
              video.addEventListener('playing', () => (desde = video.currentTime), { once: true });
              const avanza = () => {
                if (marca.t1 === null && desde !== null && video.currentTime - desde >= 0.05) {
                  marca.t1 = performance.now();
                  video.removeEventListener('timeupdate', avanza);
                }
              };
              video.addEventListener('timeupdate', avanza);
            };
            vigilar();
          },
          { capture: true, once: true },
        );
      });
      await page.getByRole('link', { name: ANTENA3.title, exact: true }).first().click();
      await page.waitForURL(/vista=partido/);
      await expect
        .poll(
          () =>
            page.evaluate(
              () => (window as unknown as { __arranque: { t1: number | null } }).__arranque.t1,
            ),
          { timeout: 60_000, intervals: [250] },
        )
        .not.toBeNull();
      const marca = await page.evaluate(
        () => (window as unknown as { __arranque: { t0: number; t1: number } }).__arranque,
      );
      const s = await estado(page);
      medidas.push({
        colchonS: colchon,
        toqueMs: Math.round(marca.t1 - marca.t0),
        reproductorMs: s.ttffMs,
      });
    }
    const informe = { fecha: new Date().toISOString(), proyecto: testInfo.project.name, medidas };
    writeFileSync(
      path.join(testInfo.project.outputDir, '..', `arranque-iptv-${testInfo.project.name}.json`),
      JSON.stringify(informe, null, 2),
    );
    await testInfo.attach('arranque', {
      body: JSON.stringify(informe, null, 2),
      contentType: 'application/json',
    });
    const sin = medidas.filter((m) => m.colchonS === 0).map((m) => m.toqueMs);
    const con = medidas.filter((m) => m.colchonS === 8).map((m) => m.toqueMs);
    expect(Math.max(...sin), JSON.stringify(medidas)).toBeLessThanOrEqual(12_000);
    expect(Math.max(...con), JSON.stringify(medidas)).toBeLessThanOrEqual(5_000);
    await detenerReproductor(page);
  },
);

test(
  'IPTV con GOP largo (4 y 6 s) y sin colchón: arranca por la IPTV, sin pasar a AceStream',
  { tag: '@video' },
  async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const medidas: {
      gopS: number;
      ms: number;
      fuente: string | null;
      segmento: Estado['segment'];
    }[] = [];
    /* 25 cuadros por segundo: 100 = 4 s, 150 = 6 s (IPTV que recodifican con x264 por defecto). */
    for (const gop of [100, 150]) {
      await detenerReproductor(page);
      await sinNadaSonando();
      await proveedor.reset();
      await proveedor.ajustes(0, gop);
      const t0 = Date.now();
      await abrirAntena3(page, 'balanced');
      await esperarQueAvance(page, 60_000);
      const s = await estado(page);
      medidas.push({
        gopS: gop / 25,
        ms: Date.now() - t0,
        fuente: s.streamSource,
        segmento: s.segment,
      });
    }
    writeFileSync(
      path.join(testInfo.project.outputDir, '..', `gop-largo-iptv-${testInfo.project.name}.json`),
      JSON.stringify({ fecha: new Date().toISOString(), medidas }, null, 2),
    );
    await testInfo.attach('gop-largo', {
      body: JSON.stringify(medidas, null, 2),
      contentType: 'application/json',
    });
    for (const m of medidas) {
      expect(m.fuente, JSON.stringify(medidas)).toBe('iptv');
      expect(m.ms, JSON.stringify(medidas)).toBeLessThan(30_000);
    }
    await expect(page.getByText(/Tu IPTV no responde/)).toHaveCount(0);
    await detenerReproductor(page);
  },
);

test(
  'GOP de 0,96 s: sigue siendo «Segmento: 1 s» (con -hls_time 1 habría sido 2); con 1,52 s, 2 s',
  { tag: '@video' },
  async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const medidas: { gop: number; segmento: Estado['segment']; distanciaS: number }[] = [];
    for (const [gop, esperado] of [
      [24, 1],
      [38, 2],
    ] as const) {
      await detenerReproductor(page);
      await sinNadaSonando();
      await proveedor.reset();
      await proveedor.ajustes(8, gop);
      await abrirAntena3(page, 'low');
      await esperarQueAvance(page, 60_000);
      await page.waitForTimeout(6_000);
      const muestras: number[] = [];
      for (let i = 0; i < 16; i++) {
        const d = await distancia(page);
        if (d !== null) muestras.push(d);
        await page.waitForTimeout(500);
      }
      const s = await estado(page);
      medidas.push({ gop, segmento: s.segment, distanciaS: r2(mediana(muestras)) });
      expect(s.segment?.targetS, JSON.stringify(medidas)).toBe(esperado);
    }
    /* «Baja latencia» con TD 2: 4 s en la web (2 × TD). */
    expect(medidas[1]!.distanciaS, JSON.stringify(medidas)).toBeLessThanOrEqual(6);
    await testInfo.attach('gop', {
      body: JSON.stringify(medidas, null, 2),
      contentType: 'application/json',
    });
    writeFileSync(
      path.join(testInfo.project.outputDir, '..', `gop-iptv-${testInfo.project.name}.json`),
      JSON.stringify(medidas, null, 2),
    );
    await detenerReproductor(page);
  },
);
