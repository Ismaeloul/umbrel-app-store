/* Fuentes de la sala en directo (directo §14), con la lógica de la ficha:

   - se ven las IPTV, la que suena y las AceStream verificadas; las flojas y el
     resto van plegadas, los gemelos de otro país también, las reportadas fuera;
   - el número es el de la lista entera y los grupos van con la IPTV primero;
   - quién puede cambiar: el líder, los co-líderes (aunque no controlen) y el anfitrión;
   - la pestaña pide la ruta de la sala con su credencial y «Poner» manda `from`. */

import type {
  PartyMember,
  PartyRoom,
  ResolutionCandidate,
  ScanCandidate,
  ScanJob,
} from '@ace/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import { resetMode, setMode } from '../../api/mode.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import { PartyClient, type PartyEnv } from './client.ts';
import { LiveSources } from './LivePanels.tsx';
import { canSwitchLive, roomEntries, roomScreen, roomSourcesModel } from './liveSources.ts';

const H = (n: number) => n.toString(16).padStart(40, '0');
const HOST = 'm_IsmaAnfitrion';
const ANA = 'm_AnaInvitada01';
const BASE = joined.room as PartyRoom;

function candidate(id: string, patch: Partial<ResolutionCandidate> = {}): ResolutionCandidate {
  return {
    id,
    title: 'DAZN 1 --> Elcano',
    alias: null,
    ih: true,
    source: 'acestream',
    score: 90,
    matchedChannel: 'DAZN 1',
    soloFamilia: false,
    familyFallbackAllowed: false,
    listaId: null,
    availability: null,
    bitrate: null,
    learned: null,
    reported: null,
    rejectedByLearning: false,
    quarantined: false,
    ...patch,
  };
}

const iptv = (id: string, country: string | null = null) =>
  candidate(id, {
    source: 'iptv',
    title: country ? `${country}: DAZN 1` : 'DAZN 1',
    iptv: {
      provider: 'Casa',
      quality: 'fhd',
      backup: false,
      guide: true,
      country,
      channel: 'dazn 1',
    },
  });

function probe(id: string, state: ScanCandidate['state']): ScanCandidate {
  return {
    id,
    state,
    checkedAt: null,
    retryAt: null,
    durationMs: 0,
    bytes: 0,
    peers: 12,
    speedDown: 0,
    rateKbps: 4200,
    intakeKbps: 4200,
    streamKbps: 0,
    reason: '',
    mediaValid: true,
    browserCompatible: true,
    videoCodec: 'h264',
    audioCodecs: [],
    cached: false,
    attempts: 1,
  };
}

const CANDIDATES = [
  iptv(H(1)),
  iptv(H(2), 'DE'),
  candidate(H(3)),
  candidate(H(4)),
  candidate(H(5)),
  candidate(H(6)),
  candidate(H(7), { quarantined: true }),
  candidate(H(8), { matchedChannel: 'M+ LaLiga', title: 'M+ LaLiga --> Elcano' }),
  /* Repetida: fuera. */
  candidate(H(3)),
];

const SCAN: ScanJob = {
  id: 'abcdefabcdefabcdefabcdef',
  kind: 'interactive',
  status: 'running',
  createdAt: '2026-11-01T18:00:00.000Z',
  updatedAt: '2026-11-01T18:00:05.000Z',
  total: 5,
  checked: 4,
  playable: 2,
  failed: 1,
  waiting: 0,
  retryAt: null,
  initialCount: 3,
  candidates: [
    probe(H(3), 'working'),
    probe(H(4), 'weak'),
    probe(H(5), 'failed'),
    probe(H(6), 'checking'),
    probe(H(8), 'working'),
  ],
};

const LIVE = {
  hash: H(9),
  channel: 'DAZN 1 · 1080p',
  source: 'engine' as const,
  matchId: 'fltv-1',
  match: 'Real Madrid – Barcelona',
  auto: true,
};

describe('roomSourcesModel', () => {
  it('IPTV, la que suena y las verificadas; flojas, resto y gemelos plegados; reportadas fuera', () => {
    const entries = roomEntries(CANDIDATES, SCAN, LIVE, 0);
    /* La que suena va primero aunque la resolución no la traiga. */
    expect(entries[0]?.id).toBe(H(9));
    expect(entries.filter((entry) => entry.id === H(3))).toHaveLength(1);
    const model = roomSourcesModel(
      entries,
      LIVE,
      roomScreen({ live: LIVE, interrupted: null }),
      true,
      0,
    );
    const shown = model.groups.flatMap((group) => group.rows.map((item) => item.choice.hash));
    expect(shown).toEqual([H(9), H(1), H(3), H(8)]);
    expect(model.groups.map((group) => group.name)).toEqual(['DAZN 1', 'M+ LaLiga']);
    expect(model.weak.map((item) => item.choice.hash)).toEqual([H(4)]);
    expect(model.rest.map((item) => item.choice.hash)).toEqual([H(5), H(6)]);
    expect([model.failed, model.checking]).toEqual([1, 1]);
    expect(model.foreign.map((item) => item.choice.hash)).toEqual([H(2)]);
    /* El número es el de la lista entera (la que suena, 1; sin renumerar por grupos). */
    const m8 = model.groups[1]?.rows[0];
    expect(m8?.row.number).toBe(9);
    expect(m8?.choice).toEqual({
      hash: H(8),
      channel: 'M+ LaLiga · 1080p',
      source: 'engine',
      matchId: 'fltv-1',
      match: 'Real Madrid – Barcelona',
    });
    /* Sin repetir el canal del grupo: el proveedor. */
    expect(m8?.name).toBe('Elcano');
    expect(m8?.meta).toContain('12 pares');
    expect(model.groups[0]?.rows.find((item) => item.iptv)?.meta).toContain('Casa');
    expect(model.groups[0]).toMatchObject({ total: 7 });
  });

  it('quién puede cambiar la fuente', () => {
    const live: PartyRoom = {
      ...BASE,
      live: LIVE,
      settings: { ...BASE.settings, coleaders: false },
    };
    expect(canSwitchLive(live, HOST)).toBe(true);
    expect(canSwitchLive(live, ANA)).toBe(false);
    const coleader: PartyRoom = {
      ...live,
      members: live.members.map((member): PartyMember =>
        member.id === ANA ? { ...member, role: 'coleader' } : member,
      ),
    };
    expect(canSwitchLive(coleader, ANA)).toBe(true);
    /* El anfitrión que ha perdido la corona, también. */
    expect(canSwitchLive({ ...live, leaderId: ANA }, HOST)).toBe(true);
    expect(canSwitchLive({ ...BASE, live: null }, HOST)).toBe(false);
  });
});

describe('LiveSources', () => {
  let net: ReturnType<typeof mockFetch> | undefined;
  beforeEach(() => {
    resetMode();
    setMode('live', 'bootstrap');
  });
  afterEach(() => {
    net?.restore();
    net = undefined;
    resetMode();
  });

  it('pide la ruta de la sala con la credencial y «Poner» manda `from`', async () => {
    net = mockFetch({
      [`GET /api/v1/party/${BASE.code}/sources`]: () =>
        json({ candidates: CANDIDATES.slice(0, 8), scan: { ...SCAN, status: 'complete' } }),
      [`POST /api/v1/party/${BASE.code}/control`]: () => json({ serverNow: 1, rev: 2 }),
    });
    const env: PartyEnv = {
      now: () => 1_000,
      eventSource: () => new EventTarget() as unknown as EventSource,
      setInterval: () => 0,
      clearInterval: () => undefined,
    };
    const client = new PartyClient(BASE.code, { id: HOST, token: `${HOST}.secreto` }, env);
    const room: PartyRoom = { ...BASE, live: LIVE };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LiveSources room={room} client={client} />
      </QueryClientProvider>,
    );
    const group = await screen.findByRole('region', { name: 'M+ LaLiga' });
    expect(net.calls[0]?.url).toContain('t=m_IsmaAnfitrion.secreto');
    expect(screen.getByText('Ver 1 floja')).toBeTruthy();
    fireEvent.click(within(group).getByRole('button', { name: 'Poner' }));
    await waitFor(() => expect(net?.calls.some((call) => call.method === 'POST')).toBe(true));
    const sent = net.calls.find((call) => call.method === 'POST')?.body as Record<string, unknown>;
    expect(sent).toMatchObject({ action: 'live', from: H(9), live: { hash: H(8) } });
  });
});
