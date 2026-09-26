/* Tokenizador XMLTV (docs/iptv.md §3.6) y ventana útil de la guía. */

import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildGuideWindow, guideFromStored, guideToStored, looksLikeEvent } from './guide.js';
import { decodeEntities, parseXmltvDate, parseXmltvStream, type XmltvProgramme } from './xmltv.js';

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

  it('looksLikeEvent', () => {
    const base = { subTitle: '', desc: '', categories: [] as string[] };
    expect(looksLikeEvent({ ...base, title: 'Barça vs. Madrid' })).toBe(true);
    expect(looksLikeEvent({ ...base, title: 'Noticias' })).toBe(false);
    expect(looksLikeEvent({ ...base, title: 'Carrusel', categories: ['Fútbol'] })).toBe(true);
  });
});
