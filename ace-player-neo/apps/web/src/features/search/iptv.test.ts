/* `mergeSearch` (docs/iptv.md §14.3): un canal, una fila. Biblioteca con
   «IPTV» y sin repetir la fila IPTV; fila IPTV cuando no está en la
   biblioteca; resultados del motor escondidos y contados («también en
   AceStream»); canal fuera de los 50 → el primero del motor con «IPTV»; 5 a
   la vista y «Ver {N} más de tu IPTV». */

import type { IptvChannel, SearchResult } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import {
  cappedText,
  emptyTitle,
  IPTV_ID_SUBTITLE,
  iptvCountText,
  iptvSubtitle,
  liveText,
  mergeSearch,
  showMoreText,
  visibleIptv,
} from './iptv.ts';

const h = (n: number) => n.toString(16).padStart(40, '0');
const ANTENA_FAV = h(1);
const IPTV_ANTENA = h(101);
const IPTV_TELE = h(102);
const IPTV_LA1 = h(103);
const IPTV_FUERA = h(104);

const channel = (id: string, title: string, library: string[] = []): IptvChannel => ({
  id,
  title,
  quality: 'fhd',
  provider: 'Casa',
  library,
});
const result = (n: number, title: string, iptv?: string): SearchResult => ({
  id: h(n),
  title,
  category: 'Busqueda',
  availability: 0.5,
  bitrate: null,
  ih: true,
  ...(iptv ? { iptv } : {}),
});

describe('mergeSearch (§14.3)', () => {
  it('la fila de tu biblioteca lleva «IPTV» y no se repite en «En tu IPTV»', () => {
    const merged = mergeSearch({
      local: [{ id: ANTENA_FAV, title: 'Antena 3 HD' }],
      iptv: [channel(IPTV_ANTENA, 'Antena 3', [ANTENA_FAV])],
      engine: [result(10, 'Antena 3 HD --> ELCANO', IPTV_ANTENA)],
    });
    expect(merged.local).toEqual([
      { item: { id: ANTENA_FAV, title: 'Antena 3 HD' }, iptv: IPTV_ANTENA },
    ]);
    expect(merged.iptv).toEqual([]);
    expect(merged.engine).toEqual([]);
    expect(merged.hiddenEngine).toBe(1);
  });

  it('un canal que no está en tu biblioteca sale en «En tu IPTV»; uno solo de la IPTV, sin «también en AceStream»', () => {
    const merged = mergeSearch({
      local: [],
      iptv: [channel(IPTV_TELE, 'Telecinco')],
      engine: [result(11, 'Teledeporte')],
    });
    expect(merged.iptv).toEqual([{ channel: channel(IPTV_TELE, 'Telecinco'), alsoAce: false }]);
    expect(merged.engine.map((row) => row.result.title)).toEqual(['Teledeporte']);
  });

  it('los resultados del motor de un canal IPTV se esconden y cuentan: «La 1» sale una vez, «también en AceStream»', () => {
    const merged = mergeSearch({
      local: [],
      iptv: [channel(IPTV_LA1, 'La 1')],
      engine: [
        result(20, 'La 1 HD --> ELCANO', IPTV_LA1),
        result(21, 'La 1 HD --> NEW ERA', IPTV_LA1),
        result(22, 'La 10 Deportes'),
      ],
    });
    expect(merged.iptv).toEqual([{ channel: channel(IPTV_LA1, 'La 1'), alsoAce: true }]);
    expect(merged.engine.map((row) => row.result.id)).toEqual([h(22)]);
    expect(merged.hiddenEngine).toBe(2);
    expect(iptvSubtitle(merged.iptv[0]!.channel, merged.iptv[0]!.alsoAce)).toBe(
      'Casa · 1080p · también en AceStream',
    );
  });

  it('un canal IPTV fuera de los 50: el primero del motor con «IPTV» y los demás escondidos', () => {
    const merged = mergeSearch({
      local: [],
      iptv: [],
      engine: [
        result(30, 'Deportes 1 --> A', IPTV_FUERA),
        result(31, 'Deportes 1 --> B', IPTV_FUERA),
        result(32, 'Otra cosa'),
      ],
    });
    expect(merged.engine).toEqual([
      { result: result(30, 'Deportes 1 --> A', IPTV_FUERA), iptv: IPTV_FUERA },
      { result: result(32, 'Otra cosa'), iptv: null },
    ]);
    expect(merged.hiddenEngine).toBe(1);
  });

  it('un id IPTV de tu biblioteca (iptvIds) lleva «IPTV» aunque su canal no venga en la respuesta', () => {
    const merged = mergeSearch({
      local: [{ id: IPTV_TELE, title: 'Tele 5' }],
      iptv: null,
      engine: [],
      iptvIds: { [IPTV_TELE]: 'iptv_disabled' },
    });
    expect(merged.local[0]?.iptv).toBe(IPTV_TELE);
    expect(IPTV_ID_SUBTITLE.iptv_disabled).toBe('Tu IPTV está en pausa');
  });

  it('sin IPTV (null) todo como hoy', () => {
    const merged = mergeSearch({
      local: [{ id: ANTENA_FAV, title: 'Antena 3 HD' }],
      iptv: null,
      engine: [result(40, 'Antena 3 HD --> ELCANO')],
    });
    expect(merged.local[0]?.iptv).toBe(null);
    expect(merged.iptv).toEqual([]);
    expect(merged.engine).toHaveLength(1);
  });

  it('5 a la vista, «Ver {N} más de tu IPTV» y los textos de §14.5', () => {
    const rows = Array.from({ length: 8 }, (_, i) => i);
    expect(visibleIptv(rows, false, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(visibleIptv(rows, true, 5)).toHaveLength(8);
    expect(showMoreText(3)).toBe('Ver 3 más de tu IPTV');
    expect(iptvCountText(12, false)).toBe('12');
    expect(iptvCountText(200, true)).toBe('200+');
    expect(cappedText('tele')).toBe(
      'Hay más canales con «tele» en tu IPTV: escribe algo más concreto.',
    );
    expect(liveText(2, 5, 'la 1')).toBe('2 en tu IPTV y 5 en el motor para «la 1».');
    expect(emptyTitle('zzz')).toBe('Sin resultados para «zzz».');
    expect(iptvSubtitle({ provider: 'Casa', quality: null }, false)).toBe('Casa');
  });
});
