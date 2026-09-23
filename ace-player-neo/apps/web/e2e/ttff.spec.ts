/* TTFF: tiempo desde tocar una fuente VERIFICADA hasta la primera imagen, en
   modo «Equilibrado» (el de por defecto). Objetivo: < 4 s. Método y
   resultados en docs/rendimiento.md (sección TTFF).

   Cómo se mide, en la propia página (performance.now, sin viajes a Node):
   - t0: el `pointerdown` del toque sobre la fuente (lo que siente la
     persona, no el `click` que llega después);
   - t1: el primer fotograma que el <video> presenta DESPUÉS de empezar a
     reproducir (`playing` + requestVideoFrameCallback; con `timeupdate` de
     respaldo), la misma definición de «arrancó» que usa el reproductor (P14).
   Cada muestra es un arranque en frío: antes se detiene lo que suene y se
   espera a que el motor no tenga ninguna sesión abierta. Se toman 6 (dos
   por cada una de las 3 fuentes del partido) y se anota también el
   `ttffMs` del propio reproductor (de pedir el canal a la primera imagen).

   Lo que manda es la caché del motor: Equilibrado no da al play hasta tener
   6 s de colchón, y lo que no esté ya en la caché del motor llega a ritmo de
   directo. Con la caché de la pila (catalogo.ts: 15 s por defecto, menos de
   lo que dio el motor de verdad) se exige el objetivo. Con una caché menor
   que el colchón (`E2E_CACHE_MOTOR_S=2`, el caso malo) el objetivo es
   imposible por construcción (faltan 6 − caché segundos de vídeo que aún no
   existen), así que se mide y se exige solo que la web no añada más de 1 s
   a esa espera. */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PLAYBACK_PROFILES } from '@ace/shared';
import { cacheDelMotorS, PARTIDOS } from './support/catalogo.ts';
import {
  abrirPartido,
  detenerReproductor,
  esperarMotorLibre,
  esperarQueAvance,
  estadoReproductor,
  expect,
  hashDeFuente,
  listaDeFuentes,
  test,
} from './support/pruebas.ts';

const OBJETIVO_MS = 4000;
const MUESTRAS = 6;
/** Lo que se tolera que la web añada a la espera del colchón cuando la caché no llega. */
const MARGEN_WEB_MS = 1000;

interface Muestra {
  hash: string;
  /** Toque → primera imagen, medido en la página. */
  toqueMs: number;
  /** El `ttffMs` del reproductor (pedir el canal → primera imagen). */
  reproductorMs: number | null;
  /** Qué señal marcó la primera imagen. */
  via: string;
}

interface Marca {
  t0: number | null;
  t1: number | null;
  via: string | null;
}

function percentil(valores: number[], p: number): number {
  const orden = [...valores].sort((a, b) => a - b);
  const i = Math.min(orden.length - 1, Math.max(0, Math.ceil((p / 100) * orden.length) - 1));
  return orden[i]!;
}

test(
  'TTFF: de tocar una fuente verificada a la primera imagen, en Equilibrado',
  { tag: '@video' },
  async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    // Equilibrado, explícito (es el de por defecto: `aceneo-pb`, como la 0.6.59).
    await page.addInitScript(() => {
      try {
        localStorage.setItem('aceneo-pb', 'balanced');
      } catch {}
    });
    await esperarMotorLibre();
    const { local, visitante } = PARTIDOS.campeones;
    await abrirPartido(page, `${local} vs ${visitante}`);
    expect(await page.evaluate(() => localStorage.getItem('aceneo-pb'))).toBe('balanced');

    const fuentes = listaDeFuentes(page);
    const verificadas = fuentes.getByRole('button', {
      name: / · (verificada|funcionó en el reproductor)/,
    });
    await expect(verificadas.first()).toBeVisible({ timeout: 45_000 });
    await expect.poll(() => verificadas.count(), { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
    /* Al entrar arranca sola la primera verificada, pero solo cuando el
       comprobador da su veredicto: con las fuentes ya verificadas de antes,
       la lista sale antes que ese arranque. Se espera a que suene para que
       el primer «detener» no llegue antes que él (y el arranque, después,
       deje el motor ocupado). */
    await esperarQueAvance(page);

    const muestras: Muestra[] = [];
    for (let i = 0; i < MUESTRAS; i++) {
      // Arranque en frío: nada sonando y el motor sin sesiones.
      await detenerReproductor(page);
      await esperarMotorLibre(45_000);
      await expect
        .poll(async () => (await estadoReproductor(page)).phase, { timeout: 10_000 })
        .toBe('idle');

      const cuantas = await verificadas.count();
      const boton = verificadas.nth(i % cuantas);
      const hash = await hashDeFuente(boton);

      // Las marcas, en la página: t0 al tocar, t1 con el primer fotograma reproduciendo.
      await page.evaluate(() => {
        const marca: Marca = { t0: null, t1: null, via: null };
        (window as unknown as { __ttff: Marca }).__ttff = marca;
        const fin = (via: string, t: number) => {
          if (marca.t1 !== null) return;
          marca.t1 = t;
          marca.via = via;
        };
        const vigilar = (video: HTMLVideoElement) => {
          let desde: number | null = null;
          video.addEventListener(
            'playing',
            () => {
              desde = video.currentTime;
              if (typeof video.requestVideoFrameCallback === 'function') {
                video.requestVideoFrameCallback((ahora) => fin('requestVideoFrameCallback', ahora));
              }
            },
            { once: true },
          );
          const alAvanzar = () => {
            if (desde !== null && !video.paused && video.currentTime - desde >= 0.05) {
              fin('timeupdate', performance.now());
            }
            if (marca.t1 !== null) video.removeEventListener('timeupdate', alAvanzar);
          };
          video.addEventListener('timeupdate', alAvanzar);
        };
        document.addEventListener(
          'pointerdown',
          () => {
            marca.t0 = performance.now();
            const buscar = () => {
              const video = document.querySelector('video');
              if (video) vigilar(video);
              else requestAnimationFrame(buscar);
            };
            buscar();
          },
          { capture: true, once: true },
        );
      });

      if (testInfo.project.use.hasTouch) await boton.tap();
      else await boton.click();

      await expect
        .poll(
          () => page.evaluate(() => (window as unknown as { __ttff: Marca }).__ttff.t1 !== null),
          { message: `sin primera imagen tras tocar la fuente ${hash}`, timeout: 60_000 },
        )
        .toBe(true);
      const marca = await page.evaluate(() => (window as unknown as { __ttff: Marca }).__ttff);
      const estado = await estadoReproductor(page);
      expect(estado.hash).toBe(hash);
      muestras.push({
        hash,
        toqueMs: Math.round((marca.t1 ?? 0) - (marca.t0 ?? 0)),
        reproductorMs: estado.ttffMs,
        via: marca.via ?? '?',
      });
    }

    const toques = muestras.map((m) => m.toqueMs);
    const cacheS = cacheDelMotorS();
    const colchonS = PLAYBACK_PROFILES.balanced.initial;
    // Con caché de sobra, el objetivo; si no, la espera inevitable más el margen de la web.
    const limiteMs = cacheS >= colchonS ? OBJETIVO_MS : (colchonS - cacheS) * 1000 + MARGEN_WEB_MS;
    const resumen = {
      proyecto: testInfo.project.name,
      modo: 'balanced (Equilibrado)',
      colchonInicialS: colchonS,
      cacheDelMotorS: cacheS,
      objetivoMs: OBJETIVO_MS,
      limiteExigidoMs: limiteMs,
      medianaMs: percentil(toques, 50),
      p90Ms: percentil(toques, 90),
      minMs: Math.min(...toques),
      maxMs: Math.max(...toques),
      muestras,
      fecha: new Date().toISOString(),
    };
    // Para docs/rendimiento.md: un JSON por proyecto junto al resto de resultados.
    writeFileSync(
      path.join(testInfo.project.outputDir, `ttff-${testInfo.project.name}.json`),
      `${JSON.stringify(resumen, null, 2)}\n`,
    );
    await testInfo.attach('ttff', {
      body: JSON.stringify(resumen, null, 2),
      contentType: 'application/json',
    });
    testInfo.annotations.push({
      type: 'TTFF (toque → primera imagen)',
      description: `caché ${cacheS} s · mediana ${resumen.medianaMs} ms · p90 ${resumen.p90Ms} ms · ${toques.join(' / ')} ms`,
    });

    // Cada arranque llega (ninguno se queda por el camino) y la mediana cumple.
    expect(muestras).toHaveLength(MUESTRAS);
    expect(
      resumen.medianaMs,
      `TTFF mediano con caché de ${cacheS} s (${toques.join(', ')} ms)`,
    ).toBeLessThan(limiteMs);
  },
);
