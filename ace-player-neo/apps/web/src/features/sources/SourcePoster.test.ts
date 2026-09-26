/* Lo que el cartel de fuente escribe debajo de la tesela (Isma, 26-sep):
   los datos técnicos, una etiqueta por dato y en orden (calidad y tipo). */

import { describe, expect, it } from 'vitest';
import { entryFromCandidate, presentationOf, type SourceEntry, type SourceProbe } from './model.ts';
import { posterNameOf, posterTagsOf } from './SourcePoster.tsx';
import { candidate } from './test-utils.ts';

const NOW = Date.parse('2026-09-23T19:00:00.000Z');

const PROBE: SourceProbe = {
  state: 'working',
  reason: '',
  peers: 12,
  speedDown: 600,
  rateKbps: null,
  intakeKbps: null,
  streamKbps: 0,
  videoCodec: '',
  attempts: 1,
  retryAt: null,
  playableOnWeb: true,
};

function rowOf(entry: SourceEntry) {
  return { entry, presentation: presentationOf(entry) };
}

describe('posterTagsOf', () => {
  it('calidad, códec y tipo, cada uno en su etiqueta y por ese orden', () => {
    const entry: SourceEntry = {
      ...entryFromCandidate(candidate(1), NOW),
      probe: { ...PROBE, rateKbps: 4200, videoCodec: 'hevc' },
    };
    expect(posterTagsOf(rowOf(entry))).toEqual([
      { kind: 'quality', label: '1080p' },
      { kind: 'quality', label: 'HEVC' },
      { kind: 'type', label: 'AceStream' },
    ]);
  });

  it('sin medir, solo el tipo', () => {
    expect(posterTagsOf(rowOf(entryFromCandidate(candidate(1), NOW)))).toEqual([
      { kind: 'type', label: 'AceStream' },
    ]);
  });

  it('la IPTV: la calidad que declara, «reserva» y el tipo', () => {
    const entry = entryFromCandidate(
      candidate(1, {
        source: 'iptv',
        listaId: null,
        iptv: { provider: 'Casa', quality: 'hd', backup: true, guide: false },
      }),
      NOW,
    );
    expect(posterTagsOf(rowOf(entry)).map((tag) => tag.label)).toEqual(['720p', 'reserva', 'IPTV']);
  });

  it('el tipo no se repite si ya es lo que va en la tesela: sin datos, vacío', () => {
    const saved: SourceEntry = {
      ...entryFromCandidate(candidate(1, { source: 'saved', listaId: null }), NOW),
      title: 'M+ Liga de Campeones',
    };
    const row = rowOf(saved);
    expect(row.presentation.short).toBe('Guardada');
    expect(posterTagsOf(row)).toEqual([]);
  });
});

describe('posterNameOf (§18)', () => {
  it('la IPTV «La 1 TVE 720p»: el nombre sin la calidad, que ya va en su etiqueta', () => {
    const entry = entryFromCandidate(
      candidate(1, {
        source: 'iptv',
        listaId: null,
        title: 'La 1 TVE 720p',
        matchedChannel: 'La 1',
        iptv: { provider: 'Casa', quality: 'hd', backup: false, guide: false },
      }),
      NOW,
    );
    const row = rowOf(entry);
    expect(posterTagsOf(row).map((tag) => tag.label)).toEqual(['720p', 'IPTV']);
    expect(posterNameOf(row)).toBe('La 1 TVE');
  });

  it('AceStream medida: sin «1080p» ni los asteriscos de copia; sin medir, la calidad se queda', () => {
    const measured: SourceEntry = {
      ...entryFromCandidate(candidate(1, { title: 'DAZN 2 1080p ** --> Faro' }), NOW),
      probe: { ...PROBE, rateKbps: 4200 },
    };
    expect(posterNameOf(rowOf(measured))).toBe('DAZN 2');
    const unmeasured = entryFromCandidate(candidate(1, { title: 'DAZN 2 1080p * --> Faro' }), NOW);
    expect(posterNameOf(rowOf(unmeasured))).toBe('DAZN 2 1080p');
  });
});
