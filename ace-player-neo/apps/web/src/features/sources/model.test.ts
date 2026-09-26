/* Reglas puras del selector de fuentes: inventario §7 y reglas 19-26. */

import type { Item, ResolutionCandidate, ScanCandidate } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import {
  applyScan,
  applyVerdict,
  availabilityPercent,
  channelNameOf,
  channelNameWithoutProvider,
  channelPartOf,
  checkedLabel,
  clearScan,
  describeSource,
  detailOf,
  effectiveOf,
  entryFromCandidate,
  entryFromItem,
  failureVerdict,
  isShownWhileScanning,
  librarySiblings,
  manualEntry,
  NOTHING_ON_SCREEN,
  onScreenOf,
  pickAutoSource,
  pickInitialSwitch,
  PLAYER_VERDICT_MS,
  presentationOf,
  providerOf,
  QUALITY_KBPS,
  qualityLabel,
  reportFollowUp,
  resolutionSourceLabel,
  scanFinished,
  scanProgress,
  scanProgressText,
  signalOf,
  startScan,
  type Effective,
  type SourceEntry,
} from './model.ts';

const NOW = Date.parse('2026-09-23T18:30:00.000Z');
const hash = (n: number) => n.toString(16).padStart(40, '0');

function candidate(n: number, extra: Partial<ResolutionCandidate> = {}): ResolutionCandidate {
  return {
    id: hash(n),
    title: `M+ Liga de Campeones --> Prov${n}`,
    alias: null,
    ih: false,
    source: 'm3u',
    score: 100,
    matchedChannel: 'M+ Liga de Campeones',
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

function probe(
  n: number,
  state: ScanCandidate['state'],
  extra: Partial<ScanCandidate> = {},
): ScanCandidate {
  return {
    id: hash(n),
    state,
    checkedAt: null,
    retryAt: null,
    durationMs: 0,
    bytes: 0,
    peers: 0,
    speedDown: 0,
    rateKbps: null,
    intakeKbps: null,
    streamKbps: 0,
    reason: '',
    mediaValid: false,
    browserCompatible: false,
    videoCodec: '',
    audioCodecs: [],
    cached: false,
    attempts: 0,
    ...extra,
  };
}

function scanned(states: Array<ScanCandidate['state']>): SourceEntry[] {
  const entries = startScan(
    states.map((_, i) => entryFromCandidate(candidate(i + 1), NOW)),
    3,
  );
  return applyScan(entries, { candidates: states.map((state, i) => probe(i + 1, state)) });
}

function effects(entries: SourceEntry[], screen = NOTHING_ON_SCREEN): Map<string, Effective> {
  return new Map(entries.map((entry) => [entry.id, effectiveOf(entry, screen, NOW)]));
}

describe('presentación de la fuente', () => {
  it('el proveedor es lo que va tras la flecha (→, --> o =>)', () => {
    expect(providerOf('M+ Liga de Campeones --> Elcano')).toBe('Elcano');
    expect(providerOf('DAZN 1 → Faro')).toBe('Faro');
    expect(providerOf('LaLiga => Norte')).toBe('Norte');
    expect(providerOf('DAZN 1')).toBe('');
    expect(channelPartOf('M+ Liga de Campeones --> Elcano')).toBe('M+ Liga de Campeones');
  });

  it('nombre corto: proveedor, si no la lista sin «Directorio (de)», si no el tipo', () => {
    const lists = [{ id: 'principal', name: 'Directorio de Elcano' }];
    expect(presentationOf(entryFromCandidate(candidate(1)), lists)).toMatchObject({
      type: 'M3U',
      short: 'Prov1',
      label: 'M3U · Prov1',
    });
    const plain = entryFromCandidate(candidate(2, { title: 'DAZN 1' }));
    expect(presentationOf(plain, lists)).toMatchObject({ short: 'Elcano', label: 'M3U · Elcano' });
    const bare = entryFromCandidate(
      candidate(3, { title: 'DAZN 1', listaId: null, source: 'saved' }),
    );
    expect(presentationOf(bare, lists).short).toBe('Guardada');
    expect(presentationOf(manualEntry(hash(9), 'Stream', '')).short).toBe('Externa');
  });

  it('la disponibilidad se lee como porcentaje (arregla «0.91 fuentes», §29.9)', () => {
    expect(availabilityPercent(0.91)).toBe(91);
    expect(availabilityPercent(42)).toBe(42);
    expect(availabilityPercent(null)).toBeNull();
    expect(availabilityPercent(180)).toBe(100);
  });

  it('title y aria con todos los datos (§7.1)', () => {
    const [entry] = applyScan(startScan([entryFromCandidate(candidate(1))], 3), {
      candidates: [
        probe(1, 'working', {
          peers: 48,
          intakeKbps: 6200,
          streamKbps: 4800,
          reason: 'playable_media',
        }),
      ],
    });
    const text = describeSource(
      entry!,
      1,
      effectiveOf(entry!, NOTHING_ON_SCREEN, NOW),
      presentationOf(entry!),
      true,
    );
    expect(text).toContain('Fuente 1:');
    expect(text).toContain(`Hash ${hash(1)}`);
    expect(text).toContain('48 pares en la prueba');
    expect(text).toContain('6,2 Mbit/s del enjambre para un canal de 4,8');
    const loose = describeSource(
      entry!,
      1,
      effectiveOf(entry!, NOTHING_ON_SCREEN, NOW),
      presentationOf(entry!),
      false,
    );
    expect(loose).toContain('Disponibilidad sin medir');
  });

  it('etiquetas de la resolución', () => {
    expect(resolutionSourceLabel('saved')).toBe('Asociación guardada');
    expect(resolutionSourceLabel('raro')).toBe('Fuente disponible');
    expect(checkedLabel('ai-programming')).toBe('IA');
    expect(checkedLabel('history')).toBe('Recientes');
  });
});

describe('calidad y canal del cartel (Palco, corrección 2)', () => {
  const withProbe = (extra: Partial<ScanCandidate>): SourceEntry =>
    applyScan([entryFromCandidate(candidate(1), NOW)], {
      candidates: [probe(1, 'working', extra)],
    })[0]!;

  it('sin prueba no hay calidad que decir', () => {
    expect(qualityLabel(entryFromCandidate(candidate(1), NOW))).toBeNull();
    expect(qualityLabel(withProbe({}))).toBeNull();
  });

  it('1080p, 720p o SD por el bitrate medido; si no lo midió, el que declara el canal', () => {
    expect(qualityLabel(withProbe({ rateKbps: QUALITY_KBPS.fullHd }))).toBe('1080p');
    expect(qualityLabel(withProbe({ rateKbps: 2400 }))).toBe('720p');
    expect(qualityLabel(withProbe({ rateKbps: 900 }))).toBe('SD');
    expect(qualityLabel(withProbe({ rateKbps: null, streamKbps: 4800 }))).toBe('1080p');
    // Lo medido manda sobre lo declarado.
    expect(qualityLabel(withProbe({ rateKbps: 1200, streamKbps: 4800 }))).toBe('SD');
  });

  it('HEVC se dice aparte (H.264 no se nombra) y sale solo si no hay bitrate', () => {
    expect(qualityLabel(withProbe({ streamKbps: 4800, videoCodec: 'hevc' }))).toBe('1080p · HEVC');
    expect(qualityLabel(withProbe({ streamKbps: 4800, videoCodec: 'h264' }))).toBe('1080p');
    expect(qualityLabel(withProbe({ videoCodec: 'H.265' }))).toBe('HEVC');
  });

  it('la tesela lleva el nombre del canal, sin el proveedor', () => {
    expect(channelNameOf(entryFromCandidate(candidate(1), NOW))).toBe('M+ Liga de Campeones');
    expect(channelNameOf({ title: 'Canal suelto', matchedChannel: '' })).toBe('Canal suelto');
  });
});

describe('nombre de debajo del cartel, sin el proveedor (Isma, 26-sep)', () => {
  const sin = channelNameWithoutProvider;

  it('los cuatro casos de Isma', () => {
    expect(sin('MOVISTAR PLUS FHD --> NEW ERA III', ['New Era'])).toBe('MOVISTAR PLUS FHD');
    expect(sin('DAZN 1 HD | ELCANO', ['Elcano'])).toBe('DAZN 1 HD');
    expect(sin('M+ LaLiga (NEW ERA)', ['New Era'])).toBe('M+ LaLiga');
    expect(sin('LaLiga TV [Elcano] 1080', ['Elcano'])).toBe('LaLiga TV 1080');
  });

  it('parte de channelNameOf: la flecha ya se fue y lo que queda sale igual', () => {
    const name = channelNameOf({ title: 'MOVISTAR PLUS FHD --> NEW ERA III', matchedChannel: '' });
    expect(sin(name, ['NEW ERA III'])).toBe('MOVISTAR PLUS FHD');
  });

  it('el proveedor con o sin numeral: «NEW ERA» frente a «NEW ERA III»', () => {
    expect(sin('M+ LaLiga (NEW ERA)', ['NEW ERA III'])).toBe('M+ LaLiga');
    expect(sin('DAZN 2 | NEW ERA II', ['New Era'])).toBe('DAZN 2');
    expect(sin('Eurosport 1 - Elcano 2', ['Elcano'])).toBe('Eurosport 1');
  });

  it('todos los separadores', () => {
    for (const sep of ['-->', '->', '=>', '==>', '»', '|', '-', '–', '—', '→', '·', ':', '/'])
      expect(sin(`DAZN F1 ${sep} Elcano`, ['Elcano']), sep).toBe('DAZN F1');
    expect(sin('DAZN F1 {Elcano}', ['Elcano'])).toBe('DAZN F1');
    expect(sin('DAZN F1 ( Elcano )', ['Elcano'])).toBe('DAZN F1');
    expect(sin('DAZN F1|Elcano', ['Elcano'])).toBe('DAZN F1');
  });

  it('delante, en medio o suelto también', () => {
    expect(sin('ELCANO | DAZN 1', ['Elcano'])).toBe('DAZN 1');
    expect(sin('[Elcano] DAZN 1', ['Elcano'])).toBe('DAZN 1');
    expect(sin('DAZN 1 ELCANO', ['Elcano'])).toBe('DAZN 1');
    expect(sin('DAZN 1 HD (Elcano) --> ', ['Elcano'])).toBe('DAZN 1 HD');
  });

  it('sin mayúsculas ni tildes que valgan', () => {
    expect(sin('M+ Vamos | orion', ['Orión'])).toBe('M+ Vamos');
    expect(sin('M+ Vamos (ORIÓN)', ['orion'])).toBe('M+ Vamos');
    expect(sin('Canal Sur Andalucía [Cénit]', ['cenit'])).toBe('Canal Sur Andalucía');
  });

  it('solo palabras enteras: el proveedor dentro de otra palabra no se toca', () => {
    expect(sin('Eurosport 1', ['Sport'])).toBe('Eurosport 1');
    expect(sin('Faroe Islands TV', ['Faro'])).toBe('Faroe Islands TV');
    expect(sin('LaLiga TV 1080', ['Elcano'])).toBe('LaLiga TV 1080');
  });

  it('si no queda nombre, el original', () => {
    expect(sin('Elcano', ['Elcano'])).toBe('Elcano');
    expect(sin('(New Era)', ['New Era'])).toBe('(New Era)');
    expect(sin('DAZN 1', ['DAZN'])).toBe('DAZN 1');
  });

  it('sin proveedores (o vacíos) el nombre queda igual, con los espacios en orden', () => {
    expect(sin('  DAZN   LaLiga ', [])).toBe('DAZN LaLiga');
    expect(sin('DAZN LaLiga', ['', null, undefined, '  '])).toBe('DAZN LaLiga');
  });

  it('varios proveedores a la vez y caracteres raros en el nombre del proveedor', () => {
    expect(sin('M+ LaLiga (Casa) | Elcano', ['Casa', 'Elcano'])).toBe('M+ LaLiga');
    expect(sin('DAZN 1 | TV+ Pro', ['TV+ Pro'])).toBe('DAZN 1');
    expect(sin('DAZN 1 [a.b]', ['a.b'])).toBe('DAZN 1');
    expect(sin('DAZN 1 axb', ['a.b'])).toBe('DAZN 1 axb');
  });
});

describe('estado efectivo (regla 20 y 3 min del reproductor)', () => {
  it('reproduciendo en pantalla = verificada aunque el comprobador diga otra cosa', () => {
    const [entry] = scanned(['failed']);
    const eff = effectiveOf(entry!, { hash: hash(1), playing: true, connecting: false }, NOW);
    expect(eff).toMatchObject({ state: 'working', reason: 'player' });
    expect(detailOf(eff, entry!)).toBe('reproduciendo ahora');
  });

  it('la que se conecta en pantalla sale «comprobando» aunque el comprobador la diera por caída', () => {
    const [entry] = scanned(['failed']);
    const eff = effectiveOf(entry!, { hash: hash(1), playing: false, connecting: true }, NOW);
    expect(eff).toMatchObject({ state: 'checking', reason: 'player_check' });
    expect(signalOf(eff, entry!)).toEqual({ state: 'checking', word: 'Comprobando' });
  });

  it('lo que vio el reproductor manda 3 minutos; luego vuelve el comprobador', () => {
    const [base] = scanned(['working']);
    const entry = {
      ...base!,
      playerVerdict: { state: 'failed' as const, reason: 'player_failed', at: NOW },
    };
    expect(effectiveOf(entry, NOTHING_ON_SCREEN, NOW + PLAYER_VERDICT_MS - 1).state).toBe('failed');
    expect(effectiveOf(entry, NOTHING_ON_SCREEN, NOW + PLAYER_VERDICT_MS).state).toBe('working');
  });

  it('una reportada en cuarentena manda sobre todo y dice por qué', () => {
    const [base] = scanned(['working']);
    const entry = { ...base!, reported: { reason: 'wrong_channel' as const, until: NOW + 1000 } };
    const eff = effectiveOf(entry, { hash: hash(1), playing: true, connecting: false }, NOW);
    expect(eff.reported).toBe(true);
    expect(signalOf(eff, entry)).toEqual({ state: 'fail', word: 'Reportada' });
    expect(detailOf(eff, entry)).toBe('apartada por tu reporte (canal incorrecto)');
    // Pasada la cuarentena ya no cuenta.
    expect(effectiveOf(entry, NOTHING_ON_SCREEN, NOW + 2000).reported).toBe(false);
  });

  it('B-066: la que ya venía reportada del servidor sale marcada al montar la lista', () => {
    // El servidor decide para qué canal cuenta (un «canal incorrecto» solo en el suyo) y la manda así.
    const reportada = entryFromCandidate(
      candidate(1, {
        reported: {
          reason: 'wrong_channel',
          state: 'failed',
          quarantineUntil: new Date(NOW + 60_000).toISOString(),
        },
      }),
      NOW,
    );
    expect(reportada.reported).toEqual({ reason: 'wrong_channel', until: NOW + 60_000 });
    expect(signalOf(effectiveOf(reportada, NOTHING_ON_SCREEN, NOW), reportada).word).toBe(
      'Reportada',
    );
    // En cuarentena sin fecha: la local de 30 min (index.html:4035).
    expect(entryFromCandidate(candidate(2, { quarantined: true }), NOW).reported).toEqual({
      reason: 'not_starting',
      until: NOW + 30 * 60_000,
    });
    // Con la cuarentena ya vencida, no.
    const vencida = candidate(3, {
      reported: {
        reason: 'audio',
        state: 'working',
        quarantineUntil: new Date(NOW - 1).toISOString(),
      },
    });
    expect(entryFromCandidate(vencida, NOW).reported).toBeNull();
  });

  it('las frases de la prueba (§7.2) y el reintento con su hora (B7)', () => {
    const [entry] = applyScan(startScan([entryFromCandidate(candidate(1))], 3), {
      candidates: [probe(1, 'failed', { reason: 'timeout', retryAt: '2026-09-23T18:16:00.000Z' })],
    });
    expect(detailOf(effectiveOf(entry!, NOTHING_ON_SCREEN, NOW), entry!)).toBe(
      'sin señal; reintento a las 20:16',
    );
    const phrases: Record<string, string> = {
      unsupported_codec: 'vídeo no compatible',
      starved: 'llega menos señal de la que el canal necesita',
      player_dropped: 'se cortó en el reproductor',
      player_ok: 'funcionó en el reproductor',
      intermittent: 'intermitente: falló la última prueba',
      unverified_media: 'señal detectada · vídeo sin confirmar',
    };
    for (const [reason, phrase] of Object.entries(phrases)) {
      expect(detailOf({ state: 'weak', reason, reported: false }, entry!)).toBe(phrase);
    }
    expect(detailOf({ state: 'queued', reason: '', reported: false }, entry!)).toBe('en cola');
  });

  it('sin comprobador: disponibilidad (verde desde 60 %) o «Sin comprobar»', () => {
    const rich = entryFromCandidate(candidate(1, { availability: 0.72 }));
    const poor = entryFromCandidate(candidate(2, { availability: 0.2 }));
    const none = entryFromCandidate(candidate(3));
    const eff = (entry: SourceEntry) => effectiveOf(entry, NOTHING_ON_SCREEN, NOW);
    expect(signalOf(eff(rich), rich)).toEqual({ state: 'ok', word: '72% disponible' });
    expect(signalOf(eff(poor), poor).state).toBe('weak');
    expect(signalOf(eff(none), none)).toEqual({ state: 'pending', word: 'Sin comprobar' });
  });

  it('en pantalla solo si hay canal y no está parado', () => {
    const channel = { hash: hash(1), title: 'X' };
    expect(onScreenOf({ phase: 'reproduciendo', started: true, channel })).toEqual({
      hash: hash(1),
      playing: true,
      connecting: false,
    });
    expect(onScreenOf({ phase: 'cargando', started: false, channel }).connecting).toBe(true);
    expect(onScreenOf({ phase: 'error', started: false, channel }).hash).toBeNull();
  });
});

describe('qué se ve y qué arranca solo', () => {
  it('con comprobador: la activa, las vivas y las iniciales sin probar; las caídas no ocupan sitio (regla 22)', () => {
    const entries = scanned(['failed', 'queued', 'working', 'queued', 'weak', 'failed']);
    const eff = effects(entries);
    const shown = entries
      .filter((e) => isShownWhileScanning(e, eff.get(e.id)!, null))
      .map((e) => e.id);
    expect(shown).toEqual([hash(2), hash(3), hash(5)]);
    // La activa se ve aunque haya caído.
    expect(isShownWhileScanning(entries[0]!, eff.get(hash(1))!, hash(1))).toBe(true);
  });

  it('una que se vio 60 s y se cortó queda floja y visible (regla 21)', () => {
    expect(failureVerdict('cayo', 75)).toEqual({ state: 'weak', reason: 'player_dropped' });
    expect(failureVerdict('cayo', 20)).toEqual({ state: 'failed', reason: 'player_failed' });
    expect(failureVerdict('fallo', 0).state).toBe('failed');
  });

  it('arranque automático: la primera verificada; la floja solo con el comprobador terminado', () => {
    const entries = scanned(['failed', 'weak', 'working', 'working']);
    expect(pickAutoSource(entries, effects(entries), false)?.id).toBe(hash(3));
    const onlyWeak = scanned(['failed', 'weak', 'checking']);
    expect(pickAutoSource(onlyWeak, effects(onlyWeak), false)).toBeNull();
    expect(pickAutoSource(onlyWeak, effects(onlyWeak), true)?.id).toBe(hash(2));
  });

  it('nunca repite una probada ni una reportada', () => {
    const entries = scanned(['working', 'working', 'working']).map((entry, i) =>
      i === 0
        ? { ...entry, autoTried: true }
        : i === 1
          ? { ...entry, reported: { reason: 'audio' as const, until: NOW + 1e6 } }
          : entry,
    );
    expect(pickAutoSource(entries, effects(entries), true)?.id).toBe(hash(3));
  });

  it('salto de entrada: si la elegida sale fallida y no se ve, la primera otra viva', () => {
    const entries = scanned(['failed', 'queued', 'weak']);
    expect(pickInitialSwitch(entries, hash(1), NOTHING_ON_SCREEN, NOW)?.id).toBe(hash(3));
    expect(
      pickInitialSwitch(entries, hash(1), { hash: hash(1), playing: true, connecting: false }, NOW),
    ).toBeNull();
    expect(
      pickInitialSwitch(scanned(['working', 'weak']), hash(1), NOTHING_ON_SCREEN, NOW),
    ).toBeNull();
  });

  it('startScan marca en cola y las iniciales; clearScan lo olvida', () => {
    const entries = startScan(
      [1, 2, 3, 4].map((n) => entryFromCandidate(candidate(n))),
      2,
    );
    expect(entries.map((e) => e.initial)).toEqual([true, true, false, false]);
    expect(entries.every((e) => e.probe?.state === 'queued')).toBe(true);
    expect(clearScan(entries).every((e) => e.probe === null && !e.initial)).toBe(true);
  });

  it('un veredicto por SSE cambia la fuente al momento; lo que no cambia no crea objetos nuevos', () => {
    const entries = scanned(['checking', 'queued']);
    const next = applyVerdict(entries, {
      hash: hash(2),
      state: 'working',
      reason: 'playable_media',
    });
    expect(next[1]?.probe?.state).toBe('working');
    expect(next[0]).toBe(entries[0]);
    expect(applyScan(entries, { candidates: [probe(1, 'checking')] })).toBe(entries);
  });
});

describe('progreso del comprobador (§6)', () => {
  const entries = scanned(['working', 'weak', 'failed', 'queued']);
  const eff = effects(entries);
  const view = (status: 'running' | 'waiting' | 'complete', checked = 3) => ({
    status,
    total: 4,
    checked,
    playable: 2,
    retryAt: null,
  });

  it('textos según el estado', () => {
    expect(scanProgressText(null, [], eff, null)).toBe('Preparando fuentes');
    expect(scanProgressText(view('complete'), entries, eff, null)).toBe(
      '2 verificadas · 4 comprobadas',
    );
    expect(scanProgressText(view('waiting'), entries, eff, null)).toBe(
      '2 verificadas · fallidas en reposo',
    );
    expect(scanProgressText(view('running'), entries, eff, null)).toBe(
      '3/4 · buscando señales vivas',
    );
    // Singular con una sola.
    const one = scanned(['working']);
    expect(scanProgressText({ ...view('complete'), total: 1 }, one, effects(one), null)).toBe(
      '1 verificada · 1 comprobada',
    );
    expect(scanProgressText(null, entries, eff, null)).toBe('4 fuentes disponibles');
    expect(
      scanProgressText(null, entries, eff, {
        matchId: 'x',
        stage: 'scan',
        status: 'ready',
        updatedAt: null,
        candidateCount: 6,
        checked: 6,
        playable: 2,
        total: 6,
        error: '',
      }),
    ).toBe('6 fuentes precalentadas');
  });

  it('la barra nunca baja del 4 % y el escaneo acaba con complete o waiting', () => {
    expect(scanProgress(view('running', 0), entries)).toBe(0.04);
    expect(scanProgress(view('running', 2), entries)).toBe(0.5);
    expect(scanProgress(null, entries)).toBe(0);
    expect(scanFinished(view('waiting'))).toBe(true);
    expect(scanFinished(view('running'))).toBe(false);
    expect(scanFinished(null)).toBe(true);
  });
});

describe('reportes (§7.7)', () => {
  it('viva y «No arranca»: vuelve; viva con otro motivo: sigue apartada; muerta: apartada', () => {
    expect(reportFollowUp('not_starting', 'working')).toMatchObject({
      stillReported: false,
      message: 'El segundo motor confirma que la fuente vuelve a funcionar',
    });
    expect(reportFollowUp('stuttering', 'weak')).toMatchObject({
      stillReported: true,
      message: 'La señal está viva, pero queda apartada por tu reporte',
    });
    expect(reportFollowUp('not_starting', 'failed')).toMatchObject({
      stillReported: true,
      message: 'El segundo motor confirma que esta fuente no entrega señal',
    });
  });
});

describe('hermanas de la biblioteca (regla 23)', () => {
  const item = (n: number, title: string, type: Item['type'] = 'web'): Item => ({
    id: hash(n),
    title,
    type,
    category: 'Deportes',
    date: '2026-09-23T18:30:00.000Z',
    fromWebSync: true,
    ih: false,
  });

  it('solo las del mismo canal (≥ 92), sin repetir', () => {
    const library = {
      web: [item(1, 'DAZN 1 HD'), item(2, 'DAZN 1 FHD'), item(3, 'DAZN 2'), item(4, 'Eurosport')],
      favorites: [item(1, 'DAZN 1 HD', 'fav')],
      history: [item(5, 'DAZN 1', 'recent')],
    };
    expect(librarySiblings(library, hash(1)).map((i) => i.id)).toEqual([hash(1), hash(2), hash(5)]);
    expect(librarySiblings(library, hash(9))).toEqual([]);
  });

  it('del directorio se lee como M3U de la lista activa', () => {
    expect(entryFromItem(item(1, 'DAZN 1'), 'principal')).toMatchObject({
      origin: 'm3u',
      listaId: 'principal',
    });
    expect(entryFromItem(item(1, 'DAZN 1', 'fav'), 'principal')).toMatchObject({
      origin: 'favorites',
      listaId: null,
    });
  });
});
