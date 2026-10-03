/* Guía TV en disco (docs/iptv.md §20.2 y §20.4): construir, arreglar los
   horarios, leer por trozos, la ficha, «ahora / después», cambiar de guía
   de golpe y descartar lo que no vale. */

import { existsSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GUIDE_FLAGS, IPTV_GUIDE_STORE } from '@ace/shared';
import { createSilentLogger } from '../../core/logger.js';
import { tempDir } from '../../../test/helpers/index.js';
import {
  GuideStore,
  type GuideDetailInput,
  type GuideProgrammeInput,
  type GuideReader,
  type GuideWriter,
} from './guide-db.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const BUILT = Date.UTC(2026, 9, 3, 12, 0);
const logger = createSilentLogger();

const open: { close(): void }[] = [];
afterEach(() => {
  while (open.length) open.pop()?.close();
});

function store(): { store: GuideStore; file: string } {
  const dir = tempDir('ace-guia-');
  const file = path.join(dir, 'guia.db');
  const created = new GuideStore(file, dir, logger);
  open.push(created);
  return { store: created, file };
}

function writerOf(target: GuideStore, extra: Partial<Parameters<GuideStore['begin']>[0]> = {}) {
  return target.begin({
    providerId: 'p_prueba01',
    builtAt: BUILT,
    source: 'xmltv',
    logger,
    ...extra,
  });
}

const at = (h: number, m = 0) => BUILT + h * HOUR + m * MINUTE;

function programme(
  tvg: string,
  start: number,
  stop: number | null,
  title: string,
  extra: Partial<GuideProgrammeInput> = {},
): GuideProgrammeInput {
  return { tvg, start, stop, title, flags: 0, clumpFollower: false, detail: null, ...extra };
}

const detail = (overrides: Partial<GuideDetailInput> = {}): GuideDetailInput => ({
  subTitle: '',
  description: 'Una sinopsis.',
  categories: ['Cine'],
  season: null,
  episode: null,
  episodeText: null,
  year: 2019,
  rating: '+12',
  stars: null,
  directors: [],
  actors: ['Luis Gómez'],
  icon: null,
  ...overrides,
});

async function build(
  target: GuideStore,
  items: readonly GuideProgrammeInput[],
  setup?: (writer: GuideWriter) => void,
): Promise<GuideReader> {
  const writer = writerOf(target);
  setup?.(writer);
  for (const item of items) writer.add(item);
  await writer.finish();
  const reader = target.install('p_prueba01');
  if (!reader) throw new Error('no se instaló');
  return reader;
}

const titles = (reader: GuideReader, tvg: string, from = at(-30), to = at(90)) => {
  const info = reader.channels().get(tvg);
  return info ? reader.slice(info.g, from, to, 400).map((row) => row.t) : [];
};

describe('construir y leer', () => {
  it('ventana de 24 h atrás a 80 h adelante; canales sin programas fuera; versión y recuentos', async () => {
    const { store: target } = store();
    const reader = await build(
      target,
      [
        programme('a.es', at(-30), at(-29), 'Demasiado viejo'),
        programme('a.es', at(-25), at(-23), 'Cruza el borde de atrás'),
        programme('a.es', at(1), at(2), 'Dentro'),
        programme('a.es', at(79), at(81), 'Cruza el borde de delante'),
        programme('a.es', at(81), at(82), 'Demasiado lejos'),
      ],
      (writer) => writer.channel('logo.es', 'https://logos.example/x.png'),
    );
    expect(titles(reader, 'a.es')).toEqual([
      'Cruza el borde de atrás',
      'Dentro',
      'Cruza el borde de delante',
    ]);
    expect(reader.meta).toMatchObject({
      providerId: 'p_prueba01',
      builtAt: BUILT,
      version: BUILT.toString(36),
      from: BUILT - IPTV_GUIDE_STORE.pastMs,
      to: BUILT + IPTV_GUIDE_STORE.futureMs,
      programmes: 3,
      channels: 1,
      source: 'xmltv',
      truncated: false,
    });
    /* Un canal con logo pero sin programas no está en «Todos». */
    expect(reader.channels().has('logo.es')).toBe(false);
    expect(reader.channels().get('a.es')).toMatchObject({ count: 3, hasIcon: false });
  });

  it('arreglos (§20.4): sin fin, solapes, huecos de menos de 2 min, duplicados y bloques larguísimos', async () => {
    const { store: target } = store();
    const reader = await build(target, [
      programme('b.es', at(1), null, 'Sin fin, acaba con el siguiente'),
      programme('b.es', at(2), at(3, 30), 'Se pasa y se recorta'),
      programme('b.es', at(3), at(4), 'Empieza antes de que acabe el anterior'),
      programme('b.es', at(4, 1), at(5), 'Tras un hueco de 1 min'),
      programme('b.es', at(5, 30), at(6), 'Tras un hueco de 30 min'),
      programme('b.es', at(6), at(6, 2), 'Repetido'),
      programme('b.es', at(6, 1), at(7), 'Repetido'),
      programme('b.es', at(8), at(30), 'Bloque de 22 h'),
      programme('b.es', at(40), null, 'Sin fin y sin siguiente'),
    ]);
    const info = reader.channels().get('b.es');
    const rows = reader.slice(info?.g as number, at(0), at(48), 400);
    const view = rows.map((row) => [
      row.t,
      (row.s * MINUTE - BUILT) / MINUTE,
      row.e - row.s,
      row.f,
    ]);
    expect(view).toEqual([
      ['Sin fin, acaba con el siguiente', 60, 60, GUIDE_FLAGS.noStop],
      ['Se pasa y se recorta', 120, 60, 0],
      ['Empieza antes de que acabe el anterior', 180, 61, 0],
      ['Tras un hueco de 1 min', 241, 59, 0],
      ['Tras un hueco de 30 min', 330, 31, 0],
      ['Repetido', 361, 59, 0],
      ['Bloque de 22 h', 480, 1320, GUIDE_FLAGS.filler],
      ['Sin fin y sin siguiente', 2400, 30, GUIDE_FLAGS.noStop],
    ]);
    /* Nunca dos programas de un canal se solapan. */
    for (let index = 1; index < rows.length; index += 1) {
      expect(rows[index]?.s).toBeGreaterThanOrEqual(rows[index - 1]?.e as number);
    }
    expect(reader.meta.maxDurationMin).toBe(1320);
  });

  it('franja compartida (clumpidx): «Noticias / El tiempo»; la misma hora sin franja, el primero', async () => {
    const { store: target } = store();
    const reader = await build(target, [
      programme('c.es', at(1), at(2), 'Noticias'),
      programme('c.es', at(1), at(2), 'El tiempo', { clumpFollower: true }),
      programme('c.es', at(1), at(2), 'El tiempo', { clumpFollower: true }),
      programme('c.es', at(3), at(4), 'Primero'),
      programme('c.es', at(3), at(4), 'Segundo'),
    ]);
    expect(titles(reader, 'c.es')).toEqual(['Noticias / El tiempo', 'Primero']);
  });

  it('mismo minuto: un corte de 30 s no tapa la película que empieza a los 30 s (se queda el más largo)', async () => {
    const { store: target } = store();
    const second = 1000;
    const reader = await build(target, [
      /* El corte primero y la película después (lo normal). */
      programme('m.es', at(1), at(1) + 30 * second, 'Promo'),
      programme('m.es', at(1) + 30 * second, at(3), 'Película larga'),
      programme('m.es', at(3), at(4), 'Noticias'),
      /* Al revés (guía desordenada): la película ya estaba y el corte no la quita. */
      programme('n.es', at(1) + 30 * second, at(3), 'Película larga'),
      programme('n.es', at(1), at(1) + 30 * second, 'Promo'),
      /* Sin fin: el corte acaba cuando empieza lo siguiente, así que manda el último del minuto. */
      programme('o.es', at(1), null, 'Promo'),
      programme('o.es', at(1) + 30 * second, null, 'Película sin fin'),
      programme('o.es', at(3), null, 'Noticias'),
      /* Un corte con fin y la película sin él: la película (sin fin cuenta como 30 min). */
      programme('q.es', at(1), at(1) + 30 * second, 'Promo'),
      programme('q.es', at(1) + 30 * second, null, 'Película sin fin'),
      programme('q.es', at(3), at(4), 'Noticias'),
    ]);
    for (const tvg of ['m.es', 'n.es']) {
      expect(titles(reader, tvg)).toEqual(
        tvg === 'm.es' ? ['Película larga', 'Noticias'] : ['Película larga'],
      );
      const g = reader.channels().get(tvg)?.g as number;
      expect(reader.nowNext(g, at(2)).now?.t).toBe('Película larga');
      expect(reader.slice(g, at(1), at(2), 10)[0]).toMatchObject({
        s: at(1) / MINUTE,
        e: at(3) / MINUTE,
      });
    }
    expect(titles(reader, 'o.es')).toEqual(['Película sin fin', 'Noticias']);
    expect(titles(reader, 'q.es')).toEqual(['Película sin fin', 'Noticias']);
    const q = reader.channels().get('q.es')?.g as number;
    expect(reader.nowNext(q, at(2, 30)).now?.t).toBe('Película sin fin');
  });

  it('varias guías (dos url-tvg): una fuente por canal; una que se corta a medias se deshace entera', async () => {
    const { store: target } = store();
    const writer = writerOf(target);
    writer.beginSource();
    writer.add(programme('a.es', at(1), at(2), 'A de la primera'));
    writer.add(programme('b.es', at(1), at(2), 'B de la primera'));
    writer.endSource();
    /* La segunda se corta a mitad (red): lo suyo se deshace, también el canal nuevo. */
    writer.beginSource();
    writer.add(programme('b.es', at(2), at(3), 'B de la segunda'));
    writer.add(programme('c.es', at(1), at(2), 'C a medias'));
    expect(writer.programmes).toBe(3);
    expect(writer.rollbackSource()).toBe(true);
    expect(writer.programmes).toBe(2);
    /* La tercera: B ya es de la primera (no se mezcla); C y D entran. */
    writer.beginSource();
    writer.add(programme('b.es', at(2), at(3), 'B de la tercera'));
    writer.add(programme('c.es', at(1), at(2), 'C de la tercera'));
    writer.add(programme('d.es', at(5), at(6), 'D de la tercera'));
    writer.endSource();
    const meta = await writer.finish();
    expect(meta).toMatchObject({ programmes: 4, channels: 4 });
    const reader = target.install('p_prueba01') as GuideReader;
    expect(titles(reader, 'a.es')).toEqual(['A de la primera']);
    expect(titles(reader, 'b.es')).toEqual(['B de la primera']);
    expect(titles(reader, 'c.es')).toEqual(['C de la tercera']);
    expect(titles(reader, 'd.es')).toEqual(['D de la tercera']);
    /* Los números de canal (g) no se pisan tras deshacer. */
    const gs = [...reader.channels().values()].map((info) => info.g);
    expect(new Set(gs).size).toBe(4);
  });

  it('hasta dónde llega la programación (coverage): de todos o de unos canales, dentro de la ventana', async () => {
    const { store: target } = store();
    const reader = await build(target, [
      programme('a.es', at(-30), at(-20), 'Empezó fuera de la ventana'),
      programme('a.es', at(2), at(12), 'Hasta las 12 h'),
      programme('b.es', at(8), at(20), 'Uno largo hasta +20 h'),
      programme('c.es', at(75), at(85), 'Se pasa de la ventana'),
    ]);
    const g = (tvg: string) => reader.channels().get(tvg)?.g as number;
    expect(reader.coverage()).toEqual({ from: reader.meta.from, to: reader.meta.to });
    expect(reader.coverage([g('a.es')])).toEqual({ from: reader.meta.from, to: at(12) });
    expect(reader.coverage([g('a.es'), g('b.es')])).toEqual({
      from: reader.meta.from,
      to: at(20),
    });
    expect(reader.coverage([])).toBe(null);
    expect(reader.coverage([999])).toBe(null);
  });

  it('el relleno no es programación: no alarga hasta dónde llega la guía ni da guía a un canal (Paso 0: un bloque que acaba a +36 h)', async () => {
    const { store: target } = store();
    const filler = { flags: GUIDE_FLAGS.filler };
    const reader = await build(target, [
      /* La guía de Isma: programación hasta el final de hoy (aquí, las 12 h)… */
      programme('a.es', at(0), at(6), 'Magacín'),
      programme('a.es', at(6), at(12), 'Cine'),
      programme('b.es', at(8), at(12), 'Noticias'),
      /* …y detrás de la última, un bloque largo que acaba a +36 h (se recorta a 24 h). */
      programme('b.es', at(12), at(48), 'Programación no disponible', filler),
      /* Un canal con un único «Programación no disponible» y otro con un solo bloque de 20 h. */
      programme('noche.es', at(9), at(48), 'Programación no disponible', filler),
      programme('largo.es', at(4), at(24), 'Emisión continua'),
    ]);
    /* Hasta las 12 h, no hasta las 36 h: la web no ofrece «Mañana» con la parrilla vacía. */
    expect(reader.coverage()).toEqual({ from: at(0), to: at(12) });
    /* «Todos» y «N canales con programación»: solo los que tienen programas de verdad. */
    expect([...reader.channels().keys()].sort()).toEqual(['a.es', 'b.es']);
    expect(reader.channels().get('b.es')).toMatchObject({ count: 1, first: at(8), last: at(12) });
    expect(reader.meta).toMatchObject({ channels: 2, programmes: 4, maxDurationMin: 24 * 60 });
    /* El bloque de relleno sigue en la parrilla (se pinta «Sin información»). */
    const b = reader.channels().get('b.es')?.g as number;
    expect(reader.slice(b, at(0), at(48), 10).map((row) => [row.t, row.e - row.s, row.f])).toEqual([
      ['Noticias', 240, 0],
      ['Programación no disponible', 24 * 60, GUIDE_FLAGS.filler],
    ]);
  });

  it('trozos: entra lo que se solapa con [desde, hasta), aunque empezara mucho antes', async () => {
    const { store: target } = store();
    const reader = await build(target, [
      programme('d.es', at(0), at(10), 'Largo'),
      programme('d.es', at(10), at(11), 'Siguiente'),
      programme('d.es', at(11), at(12), 'Otro'),
    ]);
    const g = reader.channels().get('d.es')?.g as number;
    expect(reader.slice(g, at(9), at(10, 30), 400).map((row) => row.t)).toEqual([
      'Largo',
      'Siguiente',
    ]);
    expect(reader.slice(g, at(10), at(11), 400).map((row) => row.t)).toEqual(['Siguiente']);
    expect(reader.slice(g, at(12), at(13), 400)).toEqual([]);
    expect(reader.slice(g, at(0), at(12), 2).map((row) => row.t)).toEqual(['Largo', 'Siguiente']);
  });

  it('ficha (sin repetir en disco), imagen y «ahora / después» (con huecos)', async () => {
    const { store: target } = store();
    const shared = detail();
    const reader = await build(target, [
      programme('e.es', at(1), at(2), 'Peli', {
        detail: detail({ icon: 'https://img.example/p.jpg' }),
      }),
      programme('e.es', at(3), at(4), 'Peli (R)', { detail: shared, flags: GUIDE_FLAGS.repeat }),
      programme('f.es', at(3), at(4), 'Peli en otro canal', { detail: shared }),
    ]);
    const g = reader.channels().get('e.es')?.g as number;
    const s = (at(1) / MINUTE) | 0;
    const row = reader.programme(g, s);
    expect(row).toMatchObject({
      t: 'Peli',
      description: 'Una sinopsis.',
      categories: ['Cine'],
      year: 2019,
      rating: '+12',
      actors: ['Luis Gómez'],
      directors: [],
    });
    expect(row?.f).toBe(GUIDE_FLAGS.detail | GUIDE_FLAGS.image);
    expect(reader.iconUrl(g, s)).toBe('https://img.example/p.jpg');
    expect(reader.iconUrl(g, s + 120)).toBe(null);
    expect(reader.programme(g, s + 1)).toBe(null);
    /* La misma ficha en dos programas: una sola fila en `det`. */
    expect(reader.programme(g, s + 120)?.f).toBe(GUIDE_FLAGS.detail | GUIDE_FLAGS.repeat);
    expect(reader.nowNext(g, at(1, 30))).toMatchObject({
      now: { t: 'Peli' },
      next: { t: 'Peli (R)' },
    });
    expect(reader.nowNext(g, at(2, 30))).toMatchObject({ now: null, next: { t: 'Peli (R)' } });
    expect(reader.nowNext(g, at(5))).toEqual({ now: null, next: null });
  });

  it('tope de programas: se deja de guardar, lo guardado vale y queda dicho (truncated)', async () => {
    const { store: target } = store();
    const writer = writerOf(target, { maxProgrammes: 5 });
    for (let index = 0; index < 20; index += 1) {
      writer.add(programme('g.es', at(index), at(index + 1), `P${index}`));
    }
    const meta = await writer.finish();
    expect(meta.programmes).toBe(5);
    expect(meta.truncated).toBe(true);
  });

  it('tope de tamaño: con max_page_count se para antes de llenar el disco', async () => {
    const { store: target } = store();
    const writer = writerOf(target, { maxBytes: 300 * 1024 });
    for (let index = 0; index < 20_000; index += 1) {
      writer.add(
        programme(
          `h${index % 50}.es`,
          at(-20) + index * MINUTE,
          at(-20) + (index + 1) * MINUTE,
          `Programa ${index}`,
          {
            detail: detail({ description: `Sinopsis distinta número ${index} `.repeat(4) }),
          },
        ),
      );
    }
    const meta = await writer.finish();
    expect(meta.truncated).toBe(true);
    expect(meta.programmes).toBeGreaterThan(100);
    /* Se mira cada 256 programas: se pasa un poco del tope, nunca del tope duro (+10 %). */
    expect(statSync(target.nextFile).size).toBeLessThan(500 * 1024);
  });
});

describe('el fichero', () => {
  it('instalar con la guía de antes abierta la cambia de golpe; otro proveedor o un fichero roto se borran', async () => {
    const { store: target, file } = store();
    const first = await build(target, [programme('a.es', at(1), at(2), 'Vieja')]);
    expect(first.version).toBe(BUILT.toString(36));
    /* Una nueva con la de antes abierta (en Windows no se puede renombrar encima de un fichero abierto). */
    const writer = target.begin({
      providerId: 'p_prueba01',
      builtAt: BUILT + 1,
      source: 'xmltv',
      logger,
    });
    writer.add(programme('a.es', at(1), at(2), 'Nueva'));
    await writer.finish();
    const second = target.install('p_prueba01');
    expect(second?.version).toBe((BUILT + 1).toString(36));
    expect(titles(second as GuideReader, 'a.es')).toEqual(['Nueva']);
    expect(existsSync(target.nextFile)).toBe(false);
    /* Otro proveedor: no se abre y se borra. */
    target.close();
    expect(target.open('p_otro0001')).toBe(null);
    expect(existsSync(file)).toBe(false);
    /* Un fichero que no es SQLite: igual. */
    writeFileSync(file, 'no soy una base de datos');
    expect(target.open('p_prueba01')).toBe(null);
    expect(existsSync(file)).toBe(false);
  });

  it('abortar deshace la construcción; clear borra la guía', async () => {
    const { store: target, file } = store();
    await build(target, [programme('a.es', at(1), at(2), 'Algo')]);
    const writer = writerOf(target, { builtAt: BUILT + 5 });
    writer.add(programme('a.es', at(1), at(2), 'A medias'));
    const controller = new AbortController();
    controller.abort(new Error('cancelado'));
    await expect(writer.finish(controller.signal)).rejects.toThrow('cancelado');
    expect(existsSync(target.nextFile)).toBe(false);
    /* La de antes sigue abierta y se puede leer. */
    expect(titles(target.current() as GuideReader, 'a.es')).toEqual(['Algo']);
    target.clear();
    expect(target.current()).toBe(null);
    expect(existsSync(file)).toBe(false);
  });

  it('volver a abrir la guardada (tras reiniciar) da la misma guía', async () => {
    const { store: target, file } = store();
    await build(target, [programme('a.es', at(1), at(2), 'Persiste')]);
    target.close();
    const again = new GuideStore(file, path.dirname(file), logger);
    open.push(again);
    const reader = again.open('p_prueba01');
    expect(reader?.version).toBe(BUILT.toString(36));
    expect(titles(reader as GuideReader, 'a.es')).toEqual(['Persiste']);
  });
});
