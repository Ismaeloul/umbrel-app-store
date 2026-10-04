/* Tokenizador XMLTV (docs/iptv.md §3.6) y ventana útil de la guía. */

import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  GuideWindowCollector,
  buildGuideWindow,
  guideFromStored,
  guideToStored,
  looksLikeEvent,
} from './guide.js';
import {
  decodeEntities,
  parseXmltvDate,
  parseXmltvStream,
  repairMojibake,
  type XmltvChannel,
  type XmltvProgramme,
} from './xmltv.js';

function body(text: string, size = 0): Readable {
  const buffer = Buffer.from(text, 'utf8');
  if (!size) return Readable.from([buffer]);
  const parts: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += size)
    parts.push(buffer.subarray(offset, offset + size));
  return Readable.from(parts);
}

async function programmesOf(text: string, size = 0): Promise<XmltvProgramme[]> {
  const out: XmltvProgramme[] = [];
  await parseXmltvStream(body(text, size), { onProgramme: (p) => out.push(p) });
  return out;
}

const GUIDE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="prueba">
  <channel id="MLaLigaTV2.es"><display-name>M+ LaLiga TV 2</display-name></channel>
  <!-- un comentario con <programme> dentro que no cuenta -->
  <programme start="20260926183000 +0200" stop="20260926203000 +0200" channel="MLaLigaTV2.es">
    <title lang="es">LaLiga EA Sports. Jornada 7: Real Sociedad - Villarreal</title>
    <sub-title>En directo &amp; con &#241;o&#x00F1;o</sub-title>
    <desc><![CDATA[Partido <en> directo]]></desc>
    <category>Deportes</category>
    <live/>
  </programme>
  <programme start="20260927090000 +0200" stop="20260927110000 +0200" channel="MLaLigaTV2.es">
    <title>(R) Real Sociedad - Villarreal</title>
    <previously-shown/>
  </programme>
  <programme start="20260926183000" stop="20260926203000" channel="sinzona"><title>A - B</title></programme>
</tv>`;

describe('parseXmltvStream', () => {
  it('programas con entidades, CDATA, comentarios y marcas; a trozos de 1 byte igual', async () => {
    for (const size of [0, 1, 13]) {
      const list = await programmesOf(GUIDE, size);
      expect(list).toHaveLength(3);
      const [live, repeat, naive] = list;
      expect(live?.title).toBe('LaLiga EA Sports. Jornada 7: Real Sociedad - Villarreal');
      expect(live?.subTitle).toBe('En directo & con ñoño');
      expect(live?.desc).toBe('Partido <en> directo');
      expect(live?.categories).toEqual(['Deportes']);
      expect(live?.live).toBe(true);
      expect(live?.start).toBe(Date.UTC(2026, 8, 26, 16, 30));
      expect(repeat?.previouslyShown).toBe(true);
      expect(naive?.naiveTime).toBe(true);
      expect(naive?.start).toBe(Date.UTC(2026, 8, 26, 18, 30));
    }
  });

  it('DOCTYPE con entidades declaradas: se ignoran (nada de «billion laughs»)', async () => {
    const text = `<?xml version="1.0"?>
<!DOCTYPE tv [
  <!ENTITY a "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">
  <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
  <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">
]>
<tv><programme start="20260926183000 +0000" stop="20260926203000 +0000" channel="x"><title>&c; - &b;</title></programme></tv>`;
    const [programme] = await programmesOf(text);
    expect(programme?.title).toBe('&c; - &b;');
  });

  it('<desc> enorme: se topa en 8 KiB sin acumularlo; profundidad máxima', async () => {
    const huge = 'x'.repeat(5 * 1024 * 1024);
    const text = `<tv><programme start="20260926183000 +0000" stop="20260926203000 +0000" channel="x"><title>T</title><desc>${huge}</desc></programme></tv>`;
    const [programme] = await programmesOf(text, 64 * 1024);
    expect(programme?.title).toBe('T');
    expect(programme?.desc).toBe('');
    const deep = `<tv>${'<a>'.repeat(20)}<programme channel="y"><title>no</title></programme>${'</a>'.repeat(20)}<programme start="20260926183000 +0000" stop="20260926203000 +0000" channel="z"><title>sí</title></programme></tv>`;
    const list = await programmesOf(deep);
    expect(list.map((item) => item.title)).toEqual(['sí']);
  });

  it('dice si llegó entera (con su </tv>) o se cortó sin error, como un xmltv.php que se pasa de tiempo', async () => {
    const complete = async (text: string, size = 0): Promise<boolean> =>
      (await parseXmltvStream(body(text, size), {})).complete;
    const programme = (channel: string) =>
      `<programme start="20260926183000 +0000" stop="20260926203000 +0000" channel="${channel}"><title>T</title></programme>`;
    const fatal =
      '<br />\n<b>Fatal error</b>:  Maximum execution time of 30 seconds exceeded in <b>/home/xtreamcodes/iptv_xtream_codes/wwwdir/xmltv.php</b> on line <b>58</b><br />\n';
    for (const size of [0, 1, 7]) {
      expect(await complete(GUIDE, size)).toBe(true);
      /* Cortada a mitad de un programa y PHP escribe su error: falta el </tv>. */
      expect(await complete(`<tv>${programme('a')}<programme start="2026092`, size)).toBe(false);
      expect(await complete(`<tv>${programme('a')}${programme('b')}\n${fatal}`, size)).toBe(false);
      /* Entera y con un aviso de PHP detrás: cuenta como entera. */
      expect(await complete(`<tv>${programme('a')}</tv>\n${fatal}`, size)).toBe(true);
    }
    expect(await complete('<?xml version="1.0"?><tv generator-info-name="x"/>')).toBe(true);
    expect(await complete('')).toBe(false);
    expect(await complete('<html><body>Error 500</body></html>')).toBe(false);
    /* Un </tv> suelto a mitad no basta si detrás siguen programas y luego se corta. */
    expect(await complete(`<tv>${programme('a')}</tv><tv>${programme('b')}`)).toBe(false);
  });

  it('fechas y entidades', () => {
    expect(parseXmltvDate('202609261830 +0100')?.at).toBe(Date.UTC(2026, 8, 26, 17, 30));
    expect(parseXmltvDate('20260926183000', 2)).toEqual({
      at: Date.UTC(2026, 8, 26, 20, 30),
      naive: true,
    });
    expect(parseXmltvDate('ayer')).toBe(null);
    expect(decodeEntities('&lt;&gt;&amp;&quot;&apos;&#65;&#x42;&desconocida;')).toBe(
      `<>&"'AB&desconocida;`,
    );
  });
});

describe('ventana de la guía', () => {
  const now = Date.UTC(2026, 8, 26, 12, 0);

  it('solo la ventana de 48 h, canales del catálogo, lo que parece un evento, con tvg-shift', async () => {
    const text = `<tv>
<programme start="20260926183000 +0200" stop="20260926203000 +0200" channel="MLaLigaTV2.es"><title>Real Sociedad - Villarreal</title></programme>
<programme start="20260926100000 +0200" stop="20260926110000 +0200" channel="MLaLigaTV2.es"><title>Ya pasó - Algo</title></programme>
<programme start="20261005183000 +0200" stop="20261005203000 +0200" channel="MLaLigaTV2.es"><title>Muy lejos - Algo</title></programme>
<programme start="20260926183000 +0200" stop="20260926203000 +0200" channel="MLaLigaTV2.es"><title>Telediario</title></programme>
<programme start="20260926183000 +0200" stop="20260926203000 +0200" channel="otro.es"><title>A - B</title></programme>
<programme start="20260926183000" stop="20260926203000" channel="desplazado.es"><title>Casa - Dos</title></programme>
</tv>`;
    const window = await buildGuideWindow(body(text), {
      now,
      channels: new Map([
        ['mlaligatv2.es', 0],
        ['desplazado.es', -2],
      ]),
    });
    expect(window.programmes).toBe(2);
    expect(window.byChannel.get('mlaligatv2.es')?.map((p) => p.title)).toEqual([
      'Real Sociedad - Villarreal',
    ]);
    expect(window.byChannel.get('desplazado.es')?.[0]?.start).toBe(Date.UTC(2026, 8, 26, 16, 30));
    const again = guideFromStored(JSON.parse(JSON.stringify(guideToStored(window, 'p_x'))), 'p_x');
    expect(again?.programmes).toBe(2);
    expect(guideFromStored(guideToStored(window, 'p_x'), 'p_otro')).toBe(null);
  });

  it('la ventana por la clase que junta (la de la guía completa) da lo mismo que buildGuideWindow', async () => {
    const text = `<tv>
<programme start="20260926183000 +0200" stop="20260926203000 +0200" channel="MLaLigaTV2.es"><title>Real Sociedad - Villarreal</title></programme>
<programme start="20260926183000 +0200" stop="20260926203000 +0200" channel="MLaLigaTV2.es"><title>Telediario</title></programme>
</tv>`;
    const options = { now, channels: new Map([['mlaligatv2.es', 0]]) };
    const collector = new GuideWindowCollector(options);
    await parseXmltvStream(body(text), { onProgramme: (p) => collector.add(p) });
    expect(guideToStored(collector.finish(), 'p_x')).toEqual(
      guideToStored(await buildGuideWindow(body(text), options), 'p_x'),
    );
  });

  it('looksLikeEvent', () => {
    const base = { subTitle: '', desc: '', categories: [] as string[] };
    expect(looksLikeEvent({ ...base, title: 'Barça vs. Madrid' })).toBe(true);
    expect(looksLikeEvent({ ...base, title: 'Noticias' })).toBe(false);
    expect(looksLikeEvent({ ...base, title: 'Carrusel', categories: ['Fútbol'] })).toBe(true);
  });
});

describe('lo que lee la Guía TV (docs/iptv.md §20.3)', () => {
  it('episodio, año, edad, nota, reparto, imagen, franja compartida y el logo del canal', async () => {
    const text = `<tv>
<channel id="cine.es"><display-name>Cine</display-name><icon src="https://logos.example/cine.png"/><icon src="https://otro.example/x.png"/></channel>
<programme start="20261003200000 +0000" stop="20261003220000 +0000" channel="cine.es" clumpidx="1/2">
  <title lang="es">Película</title>
  <episode-num system="xmltv_ns">1.4.0/1</episode-num>
  <episode-num system="onscreen">T2 Ep. 5</episode-num>
  <date>2019</date>
  <credits><director>Ana Pérez</director><actor role="X">Luis Gómez</actor><actor>Marta Ruiz</actor><writer>No</writer></credits>
  <rating system="ES"><value>+12</value></rating>
  <star-rating><value>4/5</value></star-rating>
  <icon src="https://imagenes.example/p.jpg"/>
</programme>
</tv>`;
    const channels: XmltvChannel[] = [];
    const programmes: XmltvProgramme[] = [];
    await parseXmltvStream(body(text, 7), {
      onChannel: (c) => channels.push(c),
      onProgramme: (p) => programmes.push(p),
    });
    expect(channels).toEqual([
      { id: 'cine.es', names: ['Cine'], icon: 'https://logos.example/cine.png' },
    ]);
    const [p] = programmes;
    expect(p?.clump).toEqual({ index: 1, total: 2 });
    expect(p?.episodeNums).toEqual([
      { system: 'xmltv_ns', value: '1.4.0/1' },
      { system: 'onscreen', value: 'T2 Ep. 5' },
    ]);
    expect(p?.date).toBe('2019');
    expect(p?.directors).toEqual(['Ana Pérez']);
    expect(p?.actors).toEqual(['Luis Gómez', 'Marta Ruiz']);
    expect(p?.rating).toBe('+12');
    expect(p?.stars).toBe('4/5');
    expect(p?.icon).toBe('https://imagenes.example/p.jpg');
  });

  it('título, subtítulo y sinopsis: el de lang="es" si lo hay; si no, el primero', async () => {
    const [first, spanish, none] = await programmesOf(`<tv>
<programme start="20261003200000 +0000" stop="20261003210000 +0000" channel="a"><title lang="en">Football</title><title lang="es">Fútbol</title><desc lang="en">Match</desc><desc lang="es-ES">Partido</desc></programme>
<programme start="20261003200000 +0000" stop="20261003210000 +0000" channel="a"><title lang="es">Uno</title><title lang="es">Dos</title><title lang="en">Three</title></programme>
<programme start="20261003200000 +0000" stop="20261003210000 +0000" channel="a"><title lang="fr">Premier</title><title>Second</title></programme>
</tv>`);
    expect(first?.title).toBe('Fútbol');
    expect(first?.desc).toBe('Partido');
    expect(spanish?.title).toBe('Uno');
    expect(none?.title).toBe('Premier');
  });

  it('zonas: número, ±hh:mm, abreviaturas sin dudas; las ambiguas y las fechas imposibles', () => {
    const base = Date.UTC(2007, 6, 28, 17, 33);
    expect(parseXmltvDate('200707281733 BST')).toEqual({ at: base - 3_600_000, naive: false });
    expect(parseXmltvDate('20070728173300 +01:00')?.at).toBe(base - 3_600_000);
    expect(parseXmltvDate('20070728173300 CEST')?.at).toBe(base - 2 * 3_600_000);
    expect(parseXmltvDate('20070728173300 UTC')).toEqual({ at: base, naive: false });
    expect(parseXmltvDate('20070728173300 GMT')?.naive).toBe(false);
    expect(parseXmltvDate('20070728173300 EST')?.at).toBe(base + 5 * 3_600_000);
    /* CST es China o EE. UU.: sin zona (UTC más el tvg-shift). */
    expect(parseXmltvDate('20070728173300 CST', 2)).toEqual({
      at: base + 2 * 3_600_000,
      naive: true,
    });
    expect(parseXmltvDate('20071328173300 +0000')).toBe(null);
    expect(parseXmltvDate('20070728253300 +0000')).toBe(null);
    expect(parseXmltvDate('20070728176100')).toBe(null);
  });

  it('dice latin1 pero trae UTF-8: cada texto se vuelve a leer bien', async () => {
    const xml = `<?xml version="1.0" encoding="ISO-8859-1"?><tv><programme start="20261003200000 +0000" stop="20261003210000 +0000" channel="a"><title>Fútbol: Atlético - Málaga</title><desc>¿Quién ganará? Ñandú</desc></programme></tv>`;
    const list: XmltvProgramme[] = [];
    await parseXmltvStream(Readable.from([Buffer.from(xml, 'utf8')]), {
      onProgramme: (p) => list.push(p),
    });
    expect(list[0]?.title).toBe('Fútbol: Atlético - Málaga');
    expect(list[0]?.desc).toBe('¿Quién ganará? Ñandú');
    /* Un latin1 de verdad no se toca. */
    const real = Buffer.from(xml.replace('UTF', 'X'), 'latin1');
    const kept: XmltvProgramme[] = [];
    await parseXmltvStream(Readable.from([real]), { onProgramme: (p) => kept.push(p) });
    expect(kept[0]?.title).toBe('Fútbol: Atlético - Málaga');
    expect(repairMojibake('Ya bien: Fútbol')).toBe('Ya bien: Fútbol');
    expect(repairMojibake('FÃºtbol')).toBe('Fútbol');
  });

  it('dice UTF-8 (o nada) pero trae bytes latin1: desde ese trozo se lee como latin1', async () => {
    const head = '<?xml version="1.0"?><tv>' + ' '.repeat(300);
    const programme = Buffer.from(
      '<programme start="20261003200000 +0000" stop="20261003210000 +0000" channel="a"><title>Fútbol en España</title></programme></tv>',
      'latin1',
    );
    const list: XmltvProgramme[] = [];
    await parseXmltvStream(Readable.from([Buffer.from(head, 'utf8'), programme]), {
      onProgramme: (p) => list.push(p),
    });
    expect(list[0]?.title).toBe('Fútbol en España');
  });

  it('cede el hilo con sliceMs: un temporizador corre mientras se lee una guía grande de golpe', async () => {
    const programme =
      '<programme start="20261003200000 +0000" stop="20261003210000 +0000" channel="a"><title>T</title><desc>' +
      'x'.repeat(200) +
      '</desc></programme>\n';
    const xml = Buffer.from(`<tv>${programme.repeat(40_000)}</tv>`);
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 1);
    let count = 0;
    try {
      await parseXmltvStream(
        Readable.from([xml]),
        { onProgramme: () => (count += 1) },
        { sliceMs: 5 },
      );
    } finally {
      clearInterval(timer);
    }
    expect(count).toBe(40_000);
    expect(ticks).toBeGreaterThan(0);
  });
});
