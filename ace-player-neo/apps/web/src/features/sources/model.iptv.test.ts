/* Reglas puras de la IPTV en el selector (docs/iptv.md §7 y §8): IPTV
   primero sin «Verificada», el puente, el tope de saltos, nunca plegada,
   sin hash, la calidad que declara y los motivos del comprobador. */

import type { ResolutionCandidate } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import {
  bridgeAllowed,
  BRIDGE_WINDOW_MS,
  checkedLabel,
  describeSource,
  detailOf,
  effectiveOf,
  entryFromCandidate,
  iptvQualityText,
  isIptv,
  isIptvAccountFailure,
  isShownWhileScanning,
  NOTHING_ON_SCREEN,
  pickAutoSource,
  pickBridgeTarget,
  pickNextIptvVariant,
  presentationOf,
  qualityLabel,
  resolutionSourceLabel,
  signalOf,
  type Effective,
  type SourceEntry,
} from './model.ts';

const NOW = Date.parse('2026-09-23T18:30:00.000Z');
const hash = (n: number) => n.toString(16).padStart(40, '0');

function candidate(n: number, extra: Partial<ResolutionCandidate> = {}): ResolutionCandidate {
  return {
    id: hash(n),
    title: `DAZN LaLiga --> Prov${n}`,
    alias: null,
    ih: false,
    source: 'm3u',
    score: 100,
    matchedChannel: 'DAZN LaLiga',
    soloFamilia: false,
    familyFallbackAllowed: false,
    listaId: 'principal',
    availability: null,
    bitrate: null,
    learned: null,
    reported: null,
    rejectedByLearning: false,
    quarantined: false,
    ...extra,
  };
}

const iptvCandidate = (n: number, extra: Partial<ResolutionCandidate> = {}) =>
  candidate(n, {
    title: 'DAZN LaLiga --> Casa',
    source: 'iptv',
    listaId: 'p_Ab3dE5gH',
    iptv: { provider: 'Casa', quality: 'fhd', backup: false, guide: false },
    ...extra,
  });

function probeOf(state: 'working' | 'weak' | 'failed' | 'checking' | 'queued', reason = '') {
  return {
    state,
    reason,
    peers: 0,
    speedDown: 0,
    rateKbps: null,
    intakeKbps: null,
    streamKbps: 0,
    videoCodec: '',
    attempts: state === 'queued' ? 0 : 1,
    retryAt: null,
    playableOnWeb: null,
  };
}

function effects(entries: SourceEntry[]): Map<string, Effective> {
  return new Map(entries.map((e) => [e.id, effectiveOf(e, NOTHING_ON_SCREEN, NOW)]));
}

describe('IPTV: entradas y presentación', () => {
  it('la candidata IPTV conserva su proveedor y se presenta como «IPTV · Casa»', () => {
    const entry = entryFromCandidate(iptvCandidate(1), NOW);
    expect(isIptv(entry)).toBe(true);
    expect(entry.iptv).toEqual({ provider: 'Casa', quality: 'fhd', backup: false, guide: false });
    expect(presentationOf(entry, [{ id: 'p_Ab3dE5gH', name: 'No es una lista' }])).toEqual({
      type: 'IPTV',
      list: '',
      provider: 'Casa',
      label: 'IPTV · Casa',
      short: 'Casa',
    });
    expect(isIptv(entryFromCandidate(candidate(2), NOW))).toBe(false);
  });

  it('calidad declarada (1080p, 720p, 4K, SD y «reserva») mientras no se mide', () => {
    const base = entryFromCandidate(iptvCandidate(1), NOW);
    expect(qualityLabel(base)).toBe('1080p');
    expect(qualityLabel({ ...base, iptv: { ...base.iptv!, quality: 'hd' } })).toBe('720p');
    expect(qualityLabel({ ...base, iptv: { ...base.iptv!, quality: 'uhd' } })).toBe('4K');
    expect(qualityLabel({ ...base, iptv: { ...base.iptv!, quality: 'sd', backup: true } })).toBe(
      'SD · reserva',
    );
    expect(qualityLabel({ ...base, iptv: { ...base.iptv!, quality: null } })).toBeNull();
    // Con medida del comprobador, manda la medida.
    expect(qualityLabel({ ...base, probe: { ...probeOf('working'), rateKbps: 1900 } })).toBe(
      '720p',
    );
  });

  it('describeSource sin «Hash …»', () => {
    const entry = entryFromCandidate(iptvCandidate(1), NOW);
    const effective = effectiveOf(entry, NOTHING_ON_SCREEN, NOW);
    const text = describeSource(entry, 1, effective, presentationOf(entry), true);
    expect(text).toBe('Fuente 1: DAZN LaLiga · IPTV · Casa · 1080p · se prueba al reproducirla');
    expect(text).not.toMatch(/Hash/);
  });

  it('motivos del comprobador en lenguaje humano', () => {
    const entry = {
      ...entryFromCandidate(iptvCandidate(1), NOW),
      probe: probeOf('weak', 'iptv_busy'),
    };
    expect(detailOf(effectiveOf(entry, NOTHING_ON_SCREEN, NOW), entry)).toBe('conexión ocupada');
    for (const [reason, phrase] of [
      ['iptv_auth_failed', 'la cuenta no entra'],
      ['iptv_account_expired', 'cuenta caducada'],
      ['iptv_gone', 'ya no está en la lista'],
      ['iptv_timeout', 'no respondió a tiempo'],
      ['iptv_unreachable', 'el proveedor no responde'],
      ['iptv_dropped', 'se cortó en el proveedor'],
      ['iptv_unsupported', 'formato no compatible'],
    ] as const) {
      const failed = { ...entry, probe: probeOf('failed', reason) };
      expect(detailOf(effectiveOf(failed, NOTHING_ON_SCREEN, NOW), failed)).toBe(phrase);
    }
  });

  it('una IPTV «en cola» del comprobador se lee «Sin comprobar · se prueba al reproducirla»; el país va en su etiqueta', () => {
    const entry = { ...entryFromCandidate(iptvCandidate(1), NOW), probe: probeOf('queued') };
    const effective = effectiveOf(entry, NOTHING_ON_SCREEN, NOW);
    expect(signalOf(effective, entry)).toEqual({ state: 'pending', word: 'Sin comprobar' });
    expect(detailOf(effective, entry)).toBe('se prueba al reproducirla');
    const german = entryFromCandidate(
      iptvCandidate(2, {
        iptv: { provider: 'Casa', quality: 'hd', backup: false, guide: false, country: 'DE' },
      }),
      NOW,
    );
    expect(qualityLabel(german)).toBe('DE · 720p');
  });

  it('variantes (§17): la siguiente IPTV no probada ni caída en 60 s, en el orden del servidor', () => {
    const entries = [
      entryFromCandidate(iptvCandidate(1), NOW),
      {
        ...entryFromCandidate(
          iptvCandidate(2, {
            iptv: { provider: 'Casa', quality: 'uhd', backup: false, guide: false },
          }),
          NOW,
        ),
        autoTried: true,
      },
      entryFromCandidate(
        iptvCandidate(3, {
          iptv: { provider: 'Casa', quality: 'hd', backup: false, guide: false },
        }),
        NOW,
      ),
      entryFromCandidate(candidate(4, { source: 'acestream' }), NOW),
    ];
    const next = pickNextIptvVariant(entries, effects(entries), entries[0]!, NOW);
    expect(next?.id).toBe(hash(3));
    expect(iptvQualityText(next!)).toBe('720p');
    const fallen = entries.map((entry) =>
      entry.id === hash(3) ? { ...entry, failedAt: NOW - 10_000 } : entry,
    );
    expect(pickNextIptvVariant(fallen, effects(fallen), entries[0]!, NOW)).toBeNull();
  });

  it('«Tu IPTV» en «Encontrar canal» y «IPTV» en lo consultado', () => {
    expect(resolutionSourceLabel('iptv')).toBe('Tu IPTV');
    expect(checkedLabel('iptv')).toBe('IPTV');
  });

  it('nunca se pliega, ni caída ni mientras se comprueba', () => {
    const entry = {
      ...entryFromCandidate(iptvCandidate(1), NOW),
      probe: probeOf('failed', 'iptv_gone'),
    };
    const effective = effectiveOf(entry, NOTHING_ON_SCREEN, NOW);
    expect(isShownWhileScanning(entry, effective, null)).toBe(true);
  });
});

describe('IPTV primero y el puente', () => {
  const ace = (n: number, state: 'working' | 'weak' | 'failed' | 'checking') => ({
    ...entryFromCandidate(candidate(n), NOW),
    probe: probeOf(state),
  });

  it('la IPTV arranca sin «Verificada»; «Floja» no la frena, «Sin señal» sí', () => {
    const iptv = entryFromCandidate(iptvCandidate(1), NOW);
    const entries = [iptv, ace(2, 'working')];
    expect(pickAutoSource(entries, effects(entries), false)?.id).toBe(hash(1));
    const busy = [{ ...iptv, probe: probeOf('weak', 'iptv_busy') }, ace(2, 'working')];
    expect(pickAutoSource(busy, effects(busy), false)?.id).toBe(hash(1));
    const gone = [{ ...iptv, probe: probeOf('failed', 'iptv_gone') }, ace(2, 'working')];
    expect(pickAutoSource(gone, effects(gone), false)?.id).toBe(hash(2));
    // Ya probada: la siguiente verificada.
    const tried = [{ ...iptv, autoTried: true }, ace(2, 'working')];
    expect(pickAutoSource(tried, effects(tried), false)?.id).toBe(hash(2));
    // Sin la IPTV (el puente decide aparte).
    expect(pickAutoSource(entries, effects(entries), false, { iptv: false })?.id).toBe(hash(2));
  });

  it('cae la IPTV → la mejor AceStream verificada no probada (floja solo con el comprobador terminado)', () => {
    const iptv = { ...entryFromCandidate(iptvCandidate(1), NOW), autoTried: true };
    const entries = [iptv, ace(2, 'failed'), ace(3, 'weak'), ace(4, 'working')];
    expect(pickBridgeTarget(entries, effects(entries), 'iptv', false, NOW)?.id).toBe(hash(4));
    const weakOnly = [iptv, ace(2, 'failed'), ace(3, 'weak')];
    expect(pickBridgeTarget(weakOnly, effects(weakOnly), 'iptv', false, NOW)).toBeNull();
    expect(pickBridgeTarget(weakOnly, effects(weakOnly), 'iptv', true, NOW)?.id).toBe(hash(3));
  });

  it('cae una AceStream → la IPTV no «Sin señal», no reportada y no caída hace < 60 s', () => {
    const iptv = entryFromCandidate(iptvCandidate(1), NOW);
    const entries = [{ ...iptv, autoTried: true, failedAt: NOW - 61_000 }, ace(2, 'working')];
    expect(pickBridgeTarget(entries, effects(entries), 'acestream', true, NOW)?.id).toBe(hash(1));
    const recent = [{ ...iptv, failedAt: NOW - 30_000 }, ace(2, 'working')];
    expect(pickBridgeTarget(recent, effects(recent), 'acestream', true, NOW)).toBeNull();
    // Sonaba bien hace 30 s y se dejó a mano: sí se vuelve a ella.
    const left = [{ ...iptv, autoTried: true }, ace(2, 'working')];
    expect(pickBridgeTarget(left, effects(left), 'acestream', true, NOW)?.id).toBe(hash(1));
    const failed = [
      { ...iptv, playerVerdict: { state: 'failed' as const, reason: 'player_failed', at: NOW } },
      ace(2, 'working'),
    ];
    expect(pickBridgeTarget(failed, effects(failed), 'acestream', true, NOW)).toBeNull();
    const reported = [
      { ...iptv, reported: { reason: 'not_starting' as const, until: NOW + 60_000 } },
      ace(2, 'working'),
    ];
    expect(pickBridgeTarget(reported, effects(reported), 'acestream', true, NOW)).toBeNull();
  });

  it('tope de 2 saltos en 3 min; los de antes se olvidan', () => {
    expect(bridgeAllowed([], NOW)).toBe(true);
    expect(bridgeAllowed([NOW - 1000], NOW)).toBe(true);
    expect(bridgeAllowed([NOW - 2000, NOW - 1000], NOW)).toBe(false);
    expect(bridgeAllowed([NOW - BRIDGE_WINDOW_MS - 1, NOW - 1000], NOW)).toBe(true);
  });

  it('los fallos de cuenta son los de §4.3', () => {
    expect(isIptvAccountFailure('iptv_busy')).toBe(true);
    expect(isIptvAccountFailure('iptv_auth_failed')).toBe(true);
    expect(isIptvAccountFailure('iptv_account_expired')).toBe(true);
    expect(isIptvAccountFailure('iptv_dropped')).toBe(false);
    expect(isIptvAccountFailure(undefined)).toBe(false);
  });
});
