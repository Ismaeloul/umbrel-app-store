/* Capa IPTV de la resolución (docs/iptv.md §4.3 a §4.6 y §5.2), con una
   capa IPTV de mentira: IPTV primera, la guía gana, la pista de la guía no
   adelanta a AceStream ≥ 92, canal suelto sin IPTV → not_found sin buscar,
   partido sin canales → solo guía, ids IPTV de favoritos e historial
   convertidos o descartados, y con el motor caído sigue la IPTV.

   Buscador (docs/iptv.md §14.4): el canal IPTV tocado sale primero aunque el
   título no case; uno de otro proveedor o un hash de AceStream se ignoran;
   la búsqueda inversa (`engine`) trae AceStream ≥ 92 (sin Hypermotion) y
   funciona sin IPTV y con el motor caído; sin ella, el motor no se toca. */

import { describe, expect, it } from 'vitest';
import { channelMatchScore, type ResolutionCandidate } from '@ace/shared';
import {
  overlayIptv,
  resolveFootballChannel,
  type BaseCandidate,
  type ResolutionIptv,
  type ResolveDeps,
  type ResolvableItem,
} from './resolution.js';
import { SemanticVectorCache, type SemanticOptions } from './ai.js';

const IPTV_ID = 'f'.repeat(39) + '1';
const IPTV_GUIDE_ID = 'f'.repeat(39) + '2';
const IPTV_FAV = 'f'.repeat(39) + '3';
const IPTV_OLD = 'e'.repeat(40);
const ACE = 'a'.repeat(40);
const ACE_HINT = 'b'.repeat(40);

function iptvCandidate(
  id: string,
  title: string,
  score: number,
  guide: boolean,
  matched: string,
): BaseCandidate {
  return {
    id,
    title: `${title} --> Casa`,
    alias: null,
    ih: false,
    source: 'iptv',
    score,
    matchedChannel: matched,
    soloFamilia: false,
    familyFallbackAllowed: false,
    listaId: 'p_Ab3dE5gH',
    availability: null,
    bitrate: null,
    iptv: { provider: 'Casa', quality: 'fhd', backup: false, guide },
  };
}

function layer(
  options: {
    readonly candidates?: BaseCandidate[];
    readonly hints?: string[];
  } = {},
): ResolutionIptv & { readonly calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    resolve(channels) {
      calls.push([...channels]);
      return { candidates: options.candidates ?? [], hints: options.hints ?? [], consulted: true };
    },
    classify(id) {
      if (id.startsWith('f')) return 'owned';
      if (id.startsWith('e')) return 'iptv_gone';
      return 'engine';
    },
    convert(id, match) {
      return iptvCandidate(id, 'Favorito IPTV', match.score, false, match.matchedChannel);
    },
    tapped(id) {
      if (!id.startsWith('f')) return [];
      return [iptvCandidate(id, 'Telecinco', 100, false, 'Telecinco')];
    },
    sameChannel(channel, title) {
      return channelMatchScore(channel, title);
    },
  };
}

function deps(
  iptv: ResolutionIptv | undefined,
  search: ResolveDeps['search'] = async () => [],
): ResolveDeps & {
  readonly searched: string[];
} {
  const searched: string[] = [];
  return {
    searched,
    search: async (query) => {
      searched.push(query);
      return search(query);
    },
    applyLearned: (_channels, candidates) =>
      candidates.map((candidate): ResolutionCandidate => ({
        ...candidate,
        learned: null,
        reported: null,
        rejectedByLearning: false,
        quarantined: false,
      })),
    refreshLists: () => undefined,
    semantic: { enabled: false } as SemanticOptions,
    model: 'x',
    programChannels: [],
    ...(iptv ? { iptv } : {}),
  };
}

const found = (items: ResolvableItem[]) => async (): Promise<readonly ResolvableItem[]> => items;

describe('resolveFootballChannel con IPTV', () => {
  it('la IPTV va primera (antes que AceStream ≥ 92) y es la candidata; checked empieza por iptv', async () => {
    const d = deps(
      layer({ candidates: [iptvCandidate(IPTV_ID, 'DAZN LaLiga', 100, false, 'DAZN LaLiga')] }),
      found([{ id: ACE, title: 'DAZN LaLiga --> ELCANO', ih: true, availability: 30 }]),
    );
    const result = await resolveFootballChannel({}, ['DAZN LaLiga'], d);
    expect(result.status).toBe('found');
    expect(result.candidates.map((c) => c.id)).toEqual([IPTV_ID, ACE]);
    expect(result.candidate?.id).toBe(IPTV_ID);
    expect(result.checked[0]).toBe('iptv');
  });

  it('la confirmada por la guía va delante de la IPTV por nombre, aunque las dos den 100', async () => {
    const d = deps(
      layer({
        candidates: [
          iptvCandidate(IPTV_ID, 'DAZN LaLiga', 100, false, 'DAZN LaLiga'),
          iptvCandidate(IPTV_GUIDE_ID, 'M+ LaLiga TV 2', 100, true, 'M+ LaLiga TV 2'),
        ],
      }),
    );
    const result = await resolveFootballChannel({}, ['DAZN LaLiga'], d);
    expect(result.candidates.map((c) => c.id)).toEqual([IPTV_GUIDE_ID, IPTV_ID]);
  });

  it('la pista de la guía suma AceStream con el nivel topado (91): nunca adelanta a una ≥ 92', async () => {
    const d = deps(
      layer({ hints: ['M+ LaLiga TV 2'] }),
      found([
        { id: ACE, title: 'DAZN LaLiga --> ELCANO', ih: true, availability: 30 },
        { id: ACE_HINT, title: 'M+ LaLiga TV 2 --> NEW ERA', ih: true, availability: 90 },
      ]),
    );
    const result = await resolveFootballChannel({}, ['DAZN LaLiga'], d);
    expect(result.candidates.map((c) => c.id)).toEqual([ACE, ACE_HINT]);
    const hinted = result.candidates.find((c) => c.id === ACE_HINT);
    expect(hinted?.score).toBe(91);
    expect(hinted?.matchedChannel).toBe('M+ LaLiga TV 2');
    /* La pista también se busca en el motor. */
    expect(d.searched).toContain('M+ LaLiga TV 2');
  });

  it('canal suelto sin ninguna IPTV: not_found y candidates vacío, sin buscar en el motor', async () => {
    const d = deps(layer(), found([{ id: ACE, title: 'Antena 3', ih: true }]));
    const state = { favorites: [{ id: ACE, title: 'Antena 3' }] };
    const result = await resolveFootballChannel(state, ['Antena 3'], d, { scope: 'channel' });
    expect(result.status).toBe('not_found');
    expect(result.candidates).toEqual([]);
    expect(result.candidate).toBe(null);
    expect(d.searched).toEqual([]);
  });

  it('canal suelto con IPTV: la IPTV y detrás solo las hermanas ≥ 92 de la biblioteca', async () => {
    const d = deps(
      layer({ candidates: [iptvCandidate(IPTV_ID, 'Antena 3', 100, false, 'Antena 3')] }),
    );
    const state = {
      favorites: [
        { id: ACE, title: 'Antena 3 HD' },
        { id: ACE_HINT, title: 'Antena 3 Internacional' },
      ],
    };
    const result = await resolveFootballChannel(state, ['Antena 3'], d, { scope: 'channel' });
    expect(result.status).toBe('found');
    expect(result.candidates.map((c) => c.id)).toEqual([IPTV_ID, ACE]);
    expect(d.searched).toEqual([]);
  });

  it('partido sin canales: solo la guía y sus pistas en la biblioteca; sin motor; sin nada, not_found', async () => {
    const withHint = deps(
      layer({
        candidates: [iptvCandidate(IPTV_GUIDE_ID, 'M+ LaLiga TV 2', 100, true, 'M+ LaLiga TV 2')],
        hints: ['M+ LaLiga TV 2'],
      }),
    );
    const state = { favorites: [{ id: ACE_HINT, title: 'M+ LaLiga TV 2 --> NEW ERA' }] };
    const result = await resolveFootballChannel(state, [], withHint, { scope: 'guide' });
    expect(result.candidates.map((c) => c.id)).toEqual([IPTV_GUIDE_ID, ACE_HINT]);
    expect(result.candidates[1]?.score).toBe(91);
    expect(withHint.searched).toEqual([]);
    const nothing = await resolveFootballChannel({}, [], deps(layer()), { scope: 'guide' });
    expect(nothing.status).toBe('not_found');
  });

  it('ids IPTV de favoritos, historial y vínculos: los vigentes se convierten; los viejos se descartan; del buscador, fuera', async () => {
    const state = {
      favorites: [
        { id: IPTV_FAV, title: 'DAZN LaLiga' },
        { id: IPTV_OLD, title: 'DAZN LaLiga' },
      ],
      history: [{ id: ACE, title: 'DAZN LaLiga' }],
      channelBindings: [{ channel: 'DAZN LaLiga', id: IPTV_OLD, title: 'DAZN LaLiga' }],
    };
    const d = deps(layer(), found([{ id: IPTV_OLD, title: 'DAZN LaLiga', ih: true }]));
    const result = await resolveFootballChannel(state, ['DAZN LaLiga'], d);
    expect(result.candidates.map((c) => `${c.source}:${c.id}`)).toEqual([
      `iptv:${IPTV_FAV}`,
      `history:${ACE}`,
    ]);
    expect(result.candidates[0]?.iptv?.provider).toBe('Casa');
  });

  it('como mucho 4 carteles IPTV en total (capa + convertidas), en el orden de la capa (§17)', async () => {
    const state = { favorites: [{ id: IPTV_FAV, title: 'DAZN LaLiga' }] };
    const variant = (n: number) => `${'f'.repeat(38)}a${n}`;
    const d = deps(
      layer({
        candidates: [
          iptvCandidate(IPTV_GUIDE_ID, 'M+ LaLiga TV 2', 100, true, 'M+ LaLiga TV 2'),
          iptvCandidate(IPTV_ID, 'DAZN LaLiga', 100, false, 'DAZN LaLiga'),
          iptvCandidate(variant(1), 'DAZN LaLiga', 100, false, 'DAZN LaLiga'),
          iptvCandidate(variant(2), 'DAZN LaLiga', 100, false, 'DAZN LaLiga'),
        ],
      }),
    );
    const result = await resolveFootballChannel(state, ['DAZN LaLiga'], d);
    expect(result.candidates.filter((c) => c.source === 'iptv').map((c) => c.id)).toEqual([
      IPTV_GUIDE_ID,
      IPTV_ID,
      variant(1),
      variant(2),
    ]);
  });

  it('el canal IPTV tocado trae todos sus carteles delante y en su orden', async () => {
    const v1 = `${'f'.repeat(38)}b1`;
    const v2 = `${'f'.repeat(38)}b2`;
    const iptv: ResolutionIptv = {
      ...layer({
        candidates: [iptvCandidate(IPTV_ID, 'Otro canal', 100, false, 'Telecinco')],
      }),
      tapped: (id) =>
        id.startsWith('f')
          ? [
              iptvCandidate(v1, 'Telecinco', 100, false, 'Telecinco'),
              iptvCandidate(v2, 'Telecinco', 100, false, 'Telecinco'),
            ]
          : [],
    };
    const result = await resolveFootballChannel({}, ['Telecinco'], deps(iptv), {
      scope: 'channel',
      iptvId: v1,
    });
    expect(result.candidates.map((c) => c.id)).toEqual([v1, v2, IPTV_ID]);
  });

  it('con el motor caído (el buscador falla) la IPTV sigue', async () => {
    const d = deps(
      layer({ candidates: [iptvCandidate(IPTV_ID, 'DAZN LaLiga', 100, false, 'DAZN LaLiga')] }),
      async () => {
        throw new Error('engine_unavailable');
      },
    );
    const result = await resolveFootballChannel({}, ['DAZN LaLiga'], d);
    expect(result.engineAvailable).toBe(false);
    expect(result.status).toBe('found');
    expect(result.candidate?.id).toBe(IPTV_ID);
  });

  it('§14.4 · el canal IPTV tocado sale primero aunque el título no case, y su nombre limpio se pide', async () => {
    const d = deps(layer());
    const result = await resolveFootballChannel({}, ['Tele 5'], d, {
      scope: 'channel',
      iptvId: IPTV_ID,
    });
    expect(result.status).toBe('found');
    expect(result.candidates.map((c) => c.id)).toEqual([IPTV_ID]);
    expect(result.candidate?.id).toBe(IPTV_ID);
    expect(result.channels).toEqual(['Tele 5', 'Telecinco']);
    expect(d.searched).toEqual([]);
  });

  it('§14.4 · el tocado va delante de otra IPTV que también da 100 (y cuenta en el tope de 2)', async () => {
    const d = deps(
      layer({ candidates: [iptvCandidate(IPTV_GUIDE_ID, 'Telecinco', 100, false, 'Telecinco')] }),
    );
    const result = await resolveFootballChannel({}, ['Telecinco'], d, {
      scope: 'channel',
      iptvId: IPTV_ID,
    });
    expect(result.candidates.map((c) => c.id)).toEqual([IPTV_ID, IPTV_GUIDE_ID]);
  });

  it('§14.4 · un id IPTV de otro proveedor o un hash de AceStream se ignoran: manda el nombre', async () => {
    for (const iptvId of [IPTV_OLD, ACE]) {
      const d = deps(
        layer({ candidates: [iptvCandidate(IPTV_GUIDE_ID, 'Antena 3', 100, false, 'Antena 3')] }),
      );
      const result = await resolveFootballChannel({}, ['Antena 3'], d, {
        scope: 'channel',
        iptvId,
      });
      expect(
        result.candidates.map((c) => c.id),
        iptvId,
      ).toEqual([IPTV_GUIDE_ID]);
      expect(result.channels).toEqual(['Antena 3']);
    }
  });

  it('§14.4 · búsqueda inversa: AceStream del motor ≥ 92 detrás de la IPTV, sin Hypermotion, 2 consultas como mucho', async () => {
    const d = deps(
      layer({ candidates: [iptvCandidate(IPTV_ID, 'LaLiga TV', 100, false, 'LaLiga TV')] }),
      found([
        { id: ACE, title: 'LaLiga TV --> ELCANO', ih: true, availability: 40 },
        { id: ACE_HINT, title: 'LaLiga TV Hypermotion --> NEW ERA', ih: true, availability: 90 },
        { id: IPTV_OLD, title: 'LaLiga TV', ih: true },
      ]),
    );
    const result = await resolveFootballChannel({}, ['LaLiga TV'], d, {
      scope: 'channel',
      iptvId: IPTV_ID,
      engine: true,
    });
    expect(result.candidates.map((c) => `${c.source}:${c.id}`)).toEqual([
      `iptv:${IPTV_ID}`,
      `acestream:${ACE}`,
    ]);
    expect(result.checked).toEqual(['iptv', 'saved', 'library', 'acestream']);
    expect(d.searched.length).toBeLessThanOrEqual(2);
    expect(d.searched).toContain('LaLiga TV');
  });

  it('§14.4 · búsqueda inversa sin IPTV: found con las AceStream; sin nada, not_found', async () => {
    const d = deps(undefined, found([{ id: ACE, title: 'Telecinco HD --> ELCANO', ih: true }]));
    const result = await resolveFootballChannel({}, ['Telecinco'], d, {
      scope: 'channel',
      engine: true,
    });
    expect(result.status).toBe('found');
    expect(result.candidates.map((c) => c.id)).toEqual([ACE]);
    const none = await resolveFootballChannel({}, ['Telecinco'], deps(undefined), {
      scope: 'channel',
      engine: true,
    });
    expect(none.status).toBe('not_found');
    expect(none.candidates).toEqual([]);
  });

  it('§14.4 · búsqueda inversa con el motor caído: la IPTV y la biblioteca, engineAvailable false', async () => {
    const d = deps(
      layer({ candidates: [iptvCandidate(IPTV_ID, 'Antena 3', 100, false, 'Antena 3')] }),
      async () => {
        throw new Error('engine_unavailable');
      },
    );
    const state = { favorites: [{ id: ACE, title: 'Antena 3 HD' }] };
    const result = await resolveFootballChannel(state, ['Antena 3'], d, {
      scope: 'channel',
      engine: true,
    });
    expect(result.engineAvailable).toBe(false);
    expect(result.candidates.map((c) => c.id)).toEqual([IPTV_ID, ACE]);
  });

  it('§14.4 · sin engine el canal suelto sigue sin tocar el motor', async () => {
    const d = deps(
      layer({ candidates: [iptvCandidate(IPTV_ID, 'Antena 3', 100, false, 'Antena 3')] }),
      found([{ id: ACE, title: 'Antena 3 --> ELCANO', ih: true }]),
    );
    const result = await resolveFootballChannel({}, ['Antena 3'], d, {
      scope: 'channel',
      engine: false,
      iptvId: IPTV_ID,
    });
    expect(d.searched).toEqual([]);
    expect(result.candidates.map((c) => c.id)).toEqual([IPTV_ID]);
  });

  it('sin capa IPTV todo como siempre (y sin canales, channel_required)', async () => {
    const result = await resolveFootballChannel({}, ['DAZN LaLiga'], deps(undefined));
    expect(result.checked).toEqual(['saved', 'm3u', 'library', 'acestream']);
    await expect(resolveFootballChannel({}, [], deps(undefined))).rejects.toMatchObject({
      code: 'channel_required',
    });
  });
});

describe('overlayIptv: la IPTV de ahora sobre un precalentado (M1)', () => {
  const dazn = () =>
    layer({ candidates: [iptvCandidate(IPTV_ID, 'DAZN LaLiga', 100, false, 'DAZN LaLiga')] });
  const engine = found([{ id: ACE, title: 'DAZN LaLiga --> ELCANO', ih: true, availability: 30 }]);

  it('la misma lista y el mismo `checked` que una pasada nueva con la IPTV', async () => {
    const snapshot = await resolveFootballChannel({}, ['DAZN LaLiga'], deps(undefined, engine));
    expect(snapshot.candidates.map((c) => c.id)).toEqual([ACE]);
    const fresh = await resolveFootballChannel({}, ['DAZN LaLiga'], deps(dazn(), engine));
    const iptv = dazn();
    const overlaid = overlayIptv(snapshot, snapshot.channels, null, iptv, deps(iptv).applyLearned);
    expect(overlaid.candidates.map((c) => c.id)).toEqual(fresh.candidates.map((c) => c.id));
    expect(overlaid.checked).toEqual(fresh.checked);
    expect(overlaid.candidate?.id).toBe(IPTV_ID);
    expect(iptv.calls).toEqual([['DAZN LaLiga']]);
  });

  it('las IPTV guardadas se quitan y se ponen las de ahora; un id IPTV que ya no vale, fuera', async () => {
    const iptv = dazn();
    const snapshot = await resolveFootballChannel(
      { favorites: [{ id: IPTV_OLD, title: 'DAZN LaLiga' }] },
      ['DAZN LaLiga'],
      deps(
        layer({
          candidates: [iptvCandidate(IPTV_GUIDE_ID, 'DAZN LaLiga', 100, false, 'DAZN LaLiga')],
        }),
        engine,
      ),
    );
    expect(snapshot.candidates.map((c) => c.id)).toEqual([IPTV_GUIDE_ID, ACE]);
    const overlaid = overlayIptv(snapshot, snapshot.channels, null, iptv, deps(iptv).applyLearned);
    expect(overlaid.candidates.map((c) => c.id)).toEqual([IPTV_ID, ACE]);
    /* Un favorito IPTV guardado cuando la IPTV no estaba: se convierte (§4.1). */
    const withoutIptv = await resolveFootballChannel(
      { favorites: [{ id: IPTV_FAV, title: 'DAZN LaLiga' }] },
      ['DAZN LaLiga'],
      deps(undefined, engine),
    );
    const converted = overlayIptv(
      withoutIptv,
      withoutIptv.channels,
      null,
      layer(),
      deps(layer()).applyLearned,
    );
    expect(converted.candidates.map((c) => `${c.source}:${c.id}`)).toEqual([
      `iptv:${IPTV_FAV}`,
      `acestream:${ACE}`,
    ]);
  });

  it('sin capa IPTV consultada no nombra la IPTV y deja la elegida del precalentado', async () => {
    const snapshot = await resolveFootballChannel({}, ['DAZN LaLiga'], deps(dazn(), engine));
    const paused: ResolutionIptv = {
      ...layer(),
      resolve: () => ({ candidates: [], hints: [], consulted: false }),
      classify: (id) => (id.startsWith('f') ? 'iptv_disabled' : 'engine'),
    };
    const overlaid = overlayIptv(
      { ...snapshot, candidate: snapshot.candidates[1] ?? null },
      snapshot.channels,
      null,
      paused,
      deps(paused).applyLearned,
    );
    expect(overlaid.candidates.map((c) => c.id)).toEqual([ACE]);
    expect(overlaid.checked).not.toContain('iptv');
    expect(overlaid.candidate?.id).toBe(ACE);
  });
});

describe('plazo de la etapa del motor de una resolución interactiva (M3)', () => {
  const budget = { withIptv: 8000, withoutIptv: 12000 };

  /** Un plazo que vence cuando el test lo dice. */
  function manualDeadline() {
    const asked: number[] = [];
    let controller: AbortController | null = null;
    return {
      asked,
      fire: () => controller?.abort(new Error('plazo')),
      deadline: (ms: number) => {
        asked.push(ms);
        controller = new AbortController();
        return { signal: controller.signal, cancel: () => undefined };
      },
    };
  }
  const never = (): Promise<readonly ResolvableItem[]> => new Promise(() => {});
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('con IPTV, 8 s: al vencer sigue con la IPTV y no dice «motor caído»', async () => {
    const timer = manualDeadline();
    const pending = resolveFootballChannel(
      {},
      ['DAZN LaLiga'],
      {
        ...deps(
          layer({ candidates: [iptvCandidate(IPTV_ID, 'DAZN LaLiga', 100, false, 'DAZN LaLiga')] }),
          never,
        ),
        deadline: timer.deadline,
      },
      { engineBudget: budget },
    );
    await tick();
    expect(timer.asked).toEqual([8000]);
    timer.fire();
    const result = await pending;
    expect(result).toMatchObject({ status: 'found', engineAvailable: true });
    expect(result.candidate?.id).toBe(IPTV_ID);
  });

  it('sin IPTV, 12 s; lo de la biblioteca sale igual', async () => {
    const timer = manualDeadline();
    const pending = resolveFootballChannel(
      { favorites: [{ id: ACE, title: 'DAZN LaLiga' }] },
      ['DAZN LaLiga'],
      { ...deps(undefined, never), deadline: timer.deadline },
      { engineBudget: budget },
    );
    await tick();
    expect(timer.asked).toEqual([12000]);
    timer.fire();
    const result = await pending;
    expect(result).toMatchObject({ status: 'found', engineAvailable: true });
    expect(result.candidate?.id).toBe(ACE);
  });

  it('el buscador recibe la señal del plazo y la de la petición; sin `engineBudget` (precalentado), sin plazo', async () => {
    const timer = manualDeadline();
    const signals: (AbortSignal | undefined)[] = [];
    const outer = new AbortController();
    await resolveFootballChannel(
      {},
      ['DAZN LaLiga'],
      {
        ...deps(undefined),
        search: async (_query, signal) => {
          signals.push(signal);
          return [];
        },
        deadline: timer.deadline,
      },
      { engineBudget: budget, signal: outer.signal },
    );
    expect(signals[0]?.aborted).toBe(false);
    outer.abort();
    expect(signals[0]?.aborted).toBe(true);
    const preheat = manualDeadline();
    await resolveFootballChannel({}, ['DAZN LaLiga'], {
      ...deps(undefined),
      deadline: preheat.deadline,
    });
    expect(preheat.asked).toEqual([]);
  });

  it('la IA corre dentro del plazo: si vence, sin su nota y con `ai_timeout`', async () => {
    const timer = manualDeadline();
    const semantic: SemanticOptions = {
      enabled: true,
      cache: new SemanticVectorCache(),
      embed: () => new Promise(() => {}),
    };
    const pending = resolveFootballChannel(
      {},
      ['M+ Liga de Campeones'],
      {
        ...deps(
          undefined,
          found([{ id: ACE, title: 'M+ Liga de Campeones', ih: true, availability: 30 }]),
        ),
        semantic,
        deadline: timer.deadline,
      },
      { engineBudget: budget },
    );
    await tick();
    await tick();
    timer.fire();
    const result = await pending;
    expect(result.ai).toMatchObject({ used: false, error: 'ai_timeout' });
    expect(result.candidate?.id).toBe(ACE);
  });
});
