/* Una pasada, dos salidas (docs/iptv.md §20.3): la ventana de partidos de
   siempre y la guía completa en disco, con XMLTV raros (zonas, solapes, sin
   fin, caracteres rotos, HTML, canales sin programas, ids repetidos o fuera
   del catálogo, imágenes con credenciales). */

import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { GUIDE_FLAGS } from '@ace/shared';
import { createSilentLogger } from '../../core/logger.js';
import { tempDir } from '../../../test/helpers/index.js';
import { fakeGuideChunks, fakeGuideEstimate } from '../../../test/fake-iptv/guia.js';
import { buildGuideWindow, guideToStored } from './guide.js';
import { GuideStore, type GuideReader, type GuideWriter } from './guide-db.js';
import { buildFullGuide, plainImageUrl, writeShortEpg } from './guide-full.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.UTC(2026, 9, 3, 12, 0);
const logger = createSilentLogger();
const stores: GuideStore[] = [];
afterEach(() => {
  while (stores.length) stores.pop()?.close();
});

function newStore(): GuideStore {
  const dir = tempDir('ace-guia-');
  const created = new GuideStore(path.join(dir, 'guia.db'), dir, logger);
  stores.push(created);
  return created;
}

function body(text: string | Buffer, size = 0): Readable {
  const buffer = typeof text === 'string' ? Buffer.from(text, 'utf8') : text;
  if (!size) return Readable.from([buffer]);
  const parts: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += size) {
    parts.push(buffer.subarray(offset, offset + size));
  }
  return Readable.from(parts);
}

/** `20261003140000 +0000` desde un instante. */
function stamp(ms: number, zone = '+0000'): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00 ${zone}`.trim();
}

const at = (h: number, m = 0) => NOW + h * HOUR + m * MINUTE;

interface Built {
  readonly reader: GuideReader;
  readonly window: Awaited<ReturnType<typeof buildFullGuide>>['window'];
  readonly writerError: unknown;
}

async function run(
  xml: string | Buffer,
  options: {
    all: Record<string, number>;
    events?: Record<string, number>;
    accept?: (url: string) => boolean;
    size?: number;
  },
): Promise<Built> {
  const target = newStore();
  const writer = target.begin({ providerId: 'p_prueba01', builtAt: NOW, source: 'xmltv', logger });
  const result = await buildFullGuide(body(xml, options.size), {
    now: NOW,
    eventChannels: new Map(Object.entries(options.events ?? {})),
    allChannels: new Map(Object.entries(options.all)),
    writer,
    ...(options.accept ? { acceptImage: options.accept } : {}),
  });
  await writer.finish();
  const reader = target.install('p_prueba01');
  if (!reader) throw new Error('sin guía');
  return { reader, window: result.window, writerError: result.writerError };
}

function rows(reader: GuideReader, tvg: string) {
  const info = reader.channels().get(tvg);
  if (!info) return [];
  return reader
    .slice(info.g, at(-30), at(90), 400)
    .map((row) => ({ title: row.t, start: row.s * MINUTE, end: row.e * MINUTE, flags: row.f }));
}

describe('una pasada, dos salidas', () => {
  it('la ventana de partidos sale igual que antes y la guía completa lleva todo lo demás', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
<channel id="MLaLigaTV2.es"><display-name>M+ LaLiga TV 2</display-name></channel>
<programme start="${stamp(at(2))}" stop="${stamp(at(4))}" channel="MLaLigaTV2.es"><title>Real Sociedad - Villarreal</title><category>Fútbol</category><live/></programme>
<programme start="${stamp(at(-5))}" stop="${stamp(at(-4))}" channel="MLaLigaTV2.es"><title>Esta mañana</title></programme>
<programme start="${stamp(at(5))}" stop="${stamp(at(6))}" channel="MLaLigaTV2.es"><title>Telediario</title></programme>
<programme start="${stamp(at(60))}" stop="${stamp(at(61))}" channel="MLaLigaTV2.es"><title>Pasado mañana</title></programme>
<programme start="${stamp(at(2))}" stop="${stamp(at(3))}" channel="BBCOne.uk"><title>EastEnders</title></programme>
<programme start="${stamp(at(2))}" stop="${stamp(at(3))}" channel="fuera.es"><title>No está en el catálogo</title></programme>
</tv>`;
    const events = { 'mlaligatv2.es': 0 };
    const built = await run(xml, { all: { 'mlaligatv2.es': 0, 'bbcone.uk': 0 }, events, size: 13 });
    /* La ventana: la misma que daba buildGuideWindow (solo el partido). */
    const before = await buildGuideWindow(body(xml), {
      now: NOW,
      channels: new Map(Object.entries(events)),
    });
    expect(guideToStored(built.window, 'p_x')).toEqual(guideToStored(before, 'p_x'));
    expect(built.window.programmes).toBe(1);
    /* La completa: todo lo de los canales del catálogo, de cualquier país, de ayer a pasado. */
    expect(rows(built.reader, 'mlaligatv2.es').map((row) => row.title)).toEqual([
      'Esta mañana',
      'Real Sociedad - Villarreal',
      'Telediario',
      'Pasado mañana',
    ]);
    expect(rows(built.reader, 'bbcone.uk').map((row) => row.title)).toEqual(['EastEnders']);
    expect(built.reader.channels().has('fuera.es')).toBe(false);
    expect(rows(built.reader, 'mlaligatv2.es')[1]?.flags).toBe(
      GUIDE_FLAGS.live | GUIDE_FLAGS.detail,
    );
  });

  it('zonas: con número, con abreviatura y sin zona (más el tvg-shift de SU canal)', async () => {
    const start = at(10);
    const xml = `<tv>
<programme start="${stamp(start + 2 * HOUR, '+0200')}" stop="${stamp(start + 3 * HOUR, '+0200')}" channel="a.es"><title>Con +0200</title></programme>
<programme start="${stamp(start + HOUR, 'BST')}" stop="${stamp(start + 2 * HOUR, 'BST')}" channel="b.es"><title>Con BST</title></programme>
<programme start="${stamp(start, '')}" stop="${stamp(start + HOUR, '')}" channel="c.es"><title>Sin zona, desplazada</title></programme>
</tv>`;
    const built = await run(xml, { all: { 'a.es': 0, 'b.es': 0, 'c.es': -2 } });
    expect(rows(built.reader, 'a.es')[0]?.start).toBe(start);
    expect(rows(built.reader, 'b.es')[0]?.start).toBe(start);
    expect(rows(built.reader, 'c.es')[0]?.start).toBe(start - 2 * HOUR);
  });

  it('caracteres raros: entidades, CDATA, HTML en la sinopsis y UTF-8 que dice ser latin1', async () => {
    const xml = Buffer.from(
      `<?xml version="1.0" encoding="ISO-8859-1"?><tv>
<programme start="${stamp(at(1))}" stop="${stamp(at(2))}" channel="a.es"><title>Fútbol &amp;amp; más</title><desc><![CDATA[Primera<br>segunda <b>línea</b>]]></desc><category>Deportes</category><category>Deportes</category></programme>
</tv>`,
      'utf8',
    );
    const built = await run(xml, { all: { 'a.es': 0 } });
    const [row] = rows(built.reader, 'a.es');
    expect(row?.title).toBe('Fútbol & más');
    const detail = built.reader.programme(
      built.reader.channels().get('a.es')?.g as number,
      Math.floor(at(1) / MINUTE),
    );
    expect(detail?.description).toBe('Primera segunda línea');
    expect(detail?.categories).toEqual(['Deportes']);
  });

  it('ids repetidos o con mayúsculas y espacios, canales sin programas, solapes y sin fin', async () => {
    const xml = `<tv>
<channel id="La1.ES"><display-name>La 1</display-name></channel>
<channel id="la1.es"><display-name>La 1 (otra vez)</display-name></channel>
<channel id="vacio.es"><display-name>Sin programas</display-name></channel>
<programme start="${stamp(at(1))}" stop="${stamp(at(3))}" channel=" La1.ES "><title>Película larga</title></programme>
<programme start="${stamp(at(2))}" channel="la1.es"><title>Noticias sin fin</title></programme>
<programme start="${stamp(at(2, 30))}" stop="${stamp(at(4))}" channel="LA1.es"><title>Concurso</title></programme>
<programme start="${stamp(at(2, 30))}" stop="${stamp(at(4))}" channel="la1.es"><title>Concurso</title></programme>
</tv>`;
    const built = await run(xml, { all: { 'la1.es': 0, 'vacio.es': 0 } });
    expect([...built.reader.channels().keys()]).toEqual(['la1.es']);
    expect(rows(built.reader, 'la1.es')).toEqual([
      { title: 'Película larga', start: at(1), end: at(2), flags: 0 },
      { title: 'Noticias sin fin', start: at(2), end: at(2, 30), flags: GUIDE_FLAGS.noStop },
      { title: 'Concurso', start: at(2, 30), end: at(4), flags: 0 },
    ]);
  });

  it('relleno: sin título, «Programación no disponible» o más de 12 h; sin ficha', async () => {
    const xml = `<tv>
<programme start="${stamp(at(1))}" stop="${stamp(at(2))}" channel="a.es"><title></title><desc>Nada</desc></programme>
<programme start="${stamp(at(2))}" stop="${stamp(at(3))}" channel="a.es"><title>Programación no disponible</title></programme>
<programme start="${stamp(at(3))}" stop="${stamp(at(20))}" channel="a.es"><title>Emisión continua</title></programme>
</tv>`;
    const built = await run(xml, { all: { 'a.es': 0 } });
    expect(rows(built.reader, 'a.es').map((row) => row.flags)).toEqual([
      GUIDE_FLAGS.filler,
      GUIDE_FLAGS.filler,
      GUIDE_FLAGS.filler,
    ]);
  });

  it('imágenes: solo http(s) sin usuario ni contraseña y que el servicio acepte (sin credenciales dentro)', async () => {
    expect(plainImageUrl('https://img.example/a.png')).toBe('https://img.example/a.png');
    expect(plainImageUrl('http://usuario:clave@img.example/a.png')).toBe(null);
    expect(plainImageUrl('javascript:alert(1)')).toBe(null);
    expect(plainImageUrl('/relativa.png')).toBe(null);
    expect(plainImageUrl(`https://img.example/${'a'.repeat(1100)}`)).toBe(null);
    const xml = `<tv>
<channel id="a.es"><display-name>A</display-name><icon src="https://panel.example/images/SECRETO/logo.png"/></channel>
<channel id="b.es"><display-name>B</display-name><icon src="https://logos.example/b.png"/></channel>
<programme start="${stamp(at(1))}" stop="${stamp(at(2))}" channel="a.es"><title>Con imagen mala</title><icon src="https://panel.example/SECRETO/p.jpg"/></programme>
<programme start="${stamp(at(1))}" stop="${stamp(at(2))}" channel="b.es"><title>Con imagen buena</title><icon src="https://img.example/p.jpg"/></programme>
</tv>`;
    const built = await run(xml, {
      all: { 'a.es': 0, 'b.es': 0 },
      accept: (url) => !url.includes('SECRETO'),
    });
    const a = built.reader.channels().get('a.es');
    const b = built.reader.channels().get('b.es');
    expect(a?.hasIcon).toBe(false);
    expect(b?.hasIcon).toBe(true);
    expect(built.reader.iconUrl(a?.g as number, Math.floor(at(1) / MINUTE))).toBe(null);
    expect(rows(built.reader, 'a.es')[0]?.flags).toBe(0);
    expect(built.reader.iconUrl(b?.g as number, Math.floor(at(1) / MINUTE))).toBe(
      'https://img.example/p.jpg',
    );
    expect(rows(built.reader, 'b.es')[0]?.flags).toBe(GUIDE_FLAGS.detail | GUIDE_FLAGS.image);
  });

  it('si el disco falla a mitad, la ventana de partidos se termina igual (writerError)', async () => {
    const target = newStore();
    const writer = target.begin({
      providerId: 'p_prueba01',
      builtAt: NOW,
      source: 'xmltv',
      logger,
    });
    let calls = 0;
    const broken = new Proxy(writer, {
      get(item, key, receiver) {
        if (key === 'add') {
          return () => {
            calls += 1;
            if (calls === 2) throw new Error('disco roto');
          };
        }
        return Reflect.get(item, key, receiver) as unknown;
      },
    }) as GuideWriter;
    const xml = `<tv>
${[1, 2, 3, 4]
  .map(
    (h) =>
      `<programme start="${stamp(at(h))}" stop="${stamp(at(h + 1))}" channel="a.es"><title>Equipo ${h} - Otro</title></programme>`,
  )
  .join('\n')}
</tv>`;
    const result = await buildFullGuide(body(xml), {
      now: NOW,
      eventChannels: new Map([['a.es', 0]]),
      allChannels: new Map([['a.es', 0]]),
      writer: broken,
    });
    expect(calls).toBe(2);
    expect((result.writerError as Error).message).toBe('disco roto');
    expect(result.window.programmes).toBe(4);
    writer.abort();
  });

  it('el respaldo get_short_epg también va a la guía completa', async () => {
    const target = newStore();
    const writer = target.begin({
      providerId: 'p_prueba01',
      builtAt: NOW,
      source: 'short',
      logger,
    });
    writeShortEpg(writer, [
      {
        channel: 'dazn1.es',
        start: at(1),
        stop: at(3),
        title: 'Fórmula 1: GP',
        subTitle: '',
        desc: 'Carrera',
        categories: [],
        previouslyShown: false,
        live: false,
      },
    ]);
    const meta = await writer.finish();
    expect(meta).toMatchObject({ programmes: 1, channels: 1, source: 'short' });
  });

  it('una guía mediana (200 canales × 2 días) entra entera y en orden', async () => {
    const options = { channels: 200, from: at(-20), days: 2, logoEvery: 7 };
    const all: Record<string, number> = {};
    for (let index = 1; index <= options.channels; index += 1) all[`canal${index}.es`] = 0;
    const target = newStore();
    const writer = target.begin({
      providerId: 'p_prueba01',
      builtAt: NOW,
      source: 'xmltv',
      logger,
    });
    await buildFullGuide(Readable.from(fakeGuideChunks(options)), {
      now: NOW,
      eventChannels: new Map(),
      allChannels: new Map(Object.entries(all)),
      writer,
    });
    const meta = await writer.finish();
    const estimate = fakeGuideEstimate(options);
    expect(meta.programmes).toBeGreaterThan(estimate * 0.8);
    expect(meta.programmes).toBeLessThan(estimate * 1.2);
    expect(meta.channels).toBe(200);
    const reader = target.install('p_prueba01') as GuideReader;
    expect([...reader.channels().values()].filter((info) => info.hasIcon)).toHaveLength(28);
    for (const tvg of ['canal1.es', 'canal200.es']) {
      const list = rows(reader, tvg);
      for (let index = 1; index < list.length; index += 1) {
        expect(list[index]?.start).toBeGreaterThanOrEqual(list[index - 1]?.end as number);
      }
    }
  });
});
