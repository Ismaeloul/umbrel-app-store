/* Parsers M3U y HTML (server.js:2751-2812). No tenían test en la 0.6.59
   (comportamientos-tests §3.2); las salidas esperadas son las que da la
   0.6.59 con estas mismas listas (lo vigila también contrast-0659.test.ts). */

import { describe, expect, it } from 'vitest';
import { createHarness } from './test-support.js';
import { HASHES, HTML_AGREGADOR, M3U_CRLF, M3U_NEW_ERA } from './fixtures.js';
import { parseHtml, parseM3u } from './parsers.js';

describe('parseM3u (B-191)', () => {
  it('lee #EXTINF con tvg-id como alias, group-title como categoría y el título tras la coma', () => {
    expect(parseM3u(M3U_NEW_ERA)).toEqual([
      {
        id: HASHES.dazn1,
        title: 'DAZN 1 --> NEW ERA',
        alias: 'DAZN 1 HD',
        type: 'web',
        category: 'DAZN',
      },
      {
        id: HASHES.dazn2,
        title: 'DAZN 2 --> NEW ERA, 1080p',
        alias: 'DAZN 2 HD',
        type: 'web',
        category: 'DAZN',
      },
      {
        id: HASHES.m1,
        title: 'M+ Liga de Campeones & más',
        alias: '',
        type: 'web',
        category: 'Movistar & Deportes',
      },
      {
        id: HASHES.laliga,
        title: 'LALIGA TV HYPERMOTION',
        alias: 'LaLiga TV',
        type: 'web',
        category: 'LALIGA',
      },
      { id: HASHES.dazn1, title: 'DAZN 1 (copia)', alias: '', type: 'web', category: 'DAZN' },
      {
        id: HASHES.sinNombre,
        title: `Stream ${HASHES.sinNombre.slice(0, 8)}`,
        alias: '',
        type: 'web',
        category: 'DAZN',
      },
      {
        id: HASHES.mayusculas.toLowerCase(),
        title: 'Eurosport 1',
        alias: 'Eurosport 1',
        type: 'web',
        category: 'Eurosport',
      },
      {
        id: HASHES.eurosport,
        title: 'Sin categoría',
        alias: '',
        type: 'web',
        category: 'Importado',
      },
    ]);
  });

  it('acepta CRLF y un #EXTINF sin coma da «Stream M3U» con categoría Importado', () => {
    expect(parseM3u(M3U_CRLF)).toEqual([
      { id: HASHES.dazn1, title: 'Canal CRLF', alias: '', type: 'web', category: 'TV' },
      { id: HASHES.dazn2, title: 'Stream M3U', alias: '', type: 'web', category: 'Importado' },
    ]);
  });

  it('sin hashes, vacío', () => {
    expect(parseM3u('')).toEqual([]);
    expect(parseM3u('#EXTM3U\n#EXTINF:-1,Nada\nhttps://example.com/x.ts\n')).toEqual([]);
  });

  it('el título se limpia como cleanTitle y se corta a 120', () => {
    const [stream] = parseM3u(`#EXTINF:-1,${'x'.repeat(200)}\n${HASHES.dazn1}`);
    expect(stream?.title).toHaveLength(120);
  });
});

describe('parseHtml (B-191)', () => {
  it('enlaces acestream://, ?id= y &content_id=, y después los hashes sueltos, sin repetir', () => {
    expect(parseHtml(HTML_AGREGADOR)).toEqual([
      { id: HASHES.html1, title: 'DAZN 1 & más', type: 'web', category: 'Importado' },
      { id: HASHES.html2, title: 'M+ LaLiga', type: 'web', category: 'Importado' },
      {
        id: HASHES.html3,
        title: `Stream ${HASHES.html3.slice(0, 8)}`,
        type: 'web',
        category: 'Importado',
      },
      {
        id: HASHES.suelto,
        title: `Stream ${HASHES.suelto.slice(0, 8)}`,
        type: 'web',
        category: 'Importado',
      },
      {
        id: HASHES.query,
        title: `Stream ${HASHES.query.slice(0, 8)}`,
        type: 'web',
        category: 'Importado',
      },
    ]);
  });

  it('una página sin enlaces AceStream da vacío', () => {
    expect(parseHtml('<a href="https://example.com">x</a>')).toEqual([]);
  });
});

describe('parseM3u/parseHtml del servicio: canales ya normalizados como se guardan', () => {
  it('quita duplicados, pone fecha del reloj y no guarda un alias vacío o igual al título', () => {
    const { service, core } = createHarness();
    const items = service.parseM3u(M3U_NEW_ERA);
    expect(items.map((item) => item.id)).toEqual([
      HASHES.dazn1,
      HASHES.dazn2,
      HASHES.m1,
      HASHES.laliga,
      HASHES.sinNombre,
      HASHES.mayusculas.toLowerCase(),
      HASHES.eurosport,
    ]);
    expect(items[0]).toEqual({
      id: HASHES.dazn1,
      title: 'DAZN 1 --> NEW ERA',
      alias: 'DAZN 1 HD',
      type: 'web',
      category: 'DAZN',
      date: core.clock.date().toISOString(),
      fromWebSync: false,
      ih: false,
    });
    expect(items[2]).not.toHaveProperty('alias');
    expect(items[5]).not.toHaveProperty('alias');
    expect(service.parseHtml(HTML_AGREGADOR)).toHaveLength(5);
  });

  it('como mucho 500 canales por lista', () => {
    const { service } = createHarness();
    const lines = Array.from(
      { length: 600 },
      (_, index) => `#EXTINF:-1,Canal ${index}\n${index.toString(16).padStart(40, '0')}`,
    );
    expect(service.parseM3u(lines.join('\n'))).toHaveLength(500);
  });

  it('la categoría se corta a 48 al normalizar', () => {
    const { service } = createHarness();
    const [item] = service.parseM3u(
      `#EXTINF:-1 group-title="${'g'.repeat(80)}",X\n${HASHES.dazn1}`,
    );
    expect(item?.category).toHaveLength(48);
  });
});
