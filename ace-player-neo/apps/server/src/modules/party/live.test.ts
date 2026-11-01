/* «Ver juntos» en directo (docs/ver-juntos.md §14), con el reloj falso y un
   playback de mentira (solo `acquire`):

   - crear con un partido: título del partido, sin espera y reproduciendo;
   - el vídeo: `acquire` del canal de la sala con `partyKey` y la ruta de la sala;
   - otro canal para todos (`live`): se sueltan los visores y llega `title`;
   - ni pausa, ni saltos, ni lista; el invitado no cambia de canal;
   - «Cambio automático si se cae» y que en directo nadie espera al que carga. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PartyEventSchema,
  type ChannelStreamQuery,
  type PartyCreateBody,
  type PartyEvent,
  type StreamGrant,
} from '@ace/shared';
import { createTestCore } from '../../../test/helpers/index.js';
import type { FakeClock } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import { FakeSink } from '../events/test-support.js';
import type { LiveAcquireOptions, ViewerIdentity } from '../playback/types.js';
import { createPartyService } from './index.js';

const DAZN = 'aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00';
const MPLUS = '0123456789abcdef0123456789abcdef01234567';

const VOD = JSON.parse(
  readFileSync(
    new URL('../../../../../packages/shared/fixtures/web/v1/partyStream.json', import.meta.url),
    'utf8',
  ),
) as StreamGrant & { vod?: unknown };
const { vod: _vod, ...GRANT } = VOD;

const BODY: PartyCreateBody = {
  live: {
    hash: DAZN,
    channel: 'DAZN 1 · 1080p',
    source: 'engine',
    matchId: 'fltv-2026-10-31-aaaa',
    match: 'Real Madrid – Barcelona',
  },
  name: 'Isma',
  control: 'leader',
  coleaders: true,
};

interface Call {
  readonly hash: string;
  readonly query: ChannelStreamQuery;
  readonly options: LiveAcquireOptions | undefined;
}

function setup() {
  const core = createTestCore({});
  const clock = core.clock as FakeClock;
  const calls: Call[] = [];
  const released: string[] = [];
  const beats: { viewer: string; playing: boolean | undefined }[] = [];
  const party = createPartyService({
    ...core,
    playback: {
      acquire: async (hash, query, _viewer, _signal, options) => {
        calls.push({ hash, query, options });
        return GRANT;
      },
      acquireVod: () => Promise.reject(new Error('vod')),
      heartbeat: async (_sid, body) => {
        beats.push({ viewer: body.viewer, playing: body.playing });
        return {
          session: GRANT.session,
          url: GRANT.url,
          protocol: GRANT.protocol,
          viewers: 1,
        };
      },
      release: async (_sid, body) => {
        released.push(body.viewer);
        return { released: true, sessionClosed: false };
      },
    },
  });
  return { core, clock, calls, released, beats, party };
}

const viewer = (viewerId: string): ViewerIdentity => ({
  viewerId,
  deviceId: `pc-${viewerId}`,
  device: null,
});

const query = (t: string, viewerId: string) => ({
  client: 'web' as const,
  viewer: viewerId,
  t,
  hevc: '0' as const,
  abr: '0' as const,
});

function code(error: unknown): string | undefined {
  return error instanceof AppError ? error.code : undefined;
}

function listen(party: ReturnType<typeof setup>['party'], room: string, token: string) {
  const sink = new FakeSink();
  const controller = new AbortController();
  void party.attach(room, token, sink, controller.signal);
  return (): PartyEvent[] =>
    sink.chunks
      .filter((chunk) => chunk.startsWith('event: '))
      .map((chunk) => {
        const [typeLine, dataLine] = chunk.split('\n');
        return PartyEventSchema.parse({
          type: typeLine?.slice('event: '.length),
          data: JSON.parse(dataLine?.slice('data: '.length) ?? 'null'),
        });
      });
}

describe('«Ver juntos» en directo (§14)', () => {
  it('crear con un partido: su título, sin espera, reproduciendo y sin lista', () => {
    const { party } = setup();
    const host = party.create(BODY);
    expect(host.room.title).toMatchObject({
      id: DAZN,
      kind: 'live',
      title: 'Real Madrid – Barcelona',
      subtitle: 'DAZN 1 · 1080p',
      durationS: null,
    });
    expect(host.room.live).toEqual({ ...BODY.live, auto: true });
    expect(host.room.playback).toMatchObject({ playing: true, lobby: false });
    expect(party.preview(host.room.code).title.kind).toBe('live');
  });

  it('el vídeo: el canal de la sala con su partyKey, por la ruta de la sala', async () => {
    const { party, calls } = setup();
    const host = party.create(BODY);
    const guest = party.join(host.room.code, 'Ana');
    const grant = await party.stream(
      host.room.code,
      query(guest.member.token, 'v_ana'),
      viewer('v_ana'),
      new AbortController().signal,
    );
    expect(calls).toEqual([
      {
        hash: DAZN,
        query: expect.objectContaining({ client: 'web', viewer: 'v_ana', title: 'DAZN 1 · 1080p' }),
        options: { partyKey: host.room.code },
      },
    ]);
    expect(grant.url).toMatch(
      new RegExp(`^/api/v1/party/${host.room.code}/v/[\\w-]{32}/index\\.m3u8$`),
    );
    expect('vod' in grant).toBe(false);
    expect(party.videoSession(host.room.code, grant.url.split('/')[6] ?? '')).toBe(
      GRANT.session.id,
    );
  });

  it('otro canal para todos: se sueltan los visores, llega `title` y el chat lo dice', async () => {
    const { party, released } = setup();
    const host = party.create(BODY);
    const guest = party.join(host.room.code, 'Ana');
    await party.stream(
      host.room.code,
      query(guest.member.token, 'v_ana'),
      viewer('v_ana'),
      new AbortController().signal,
    );
    const events = listen(party, host.room.code, guest.member.token);
    party.control(host.room.code, {
      token: host.member.token,
      action: 'live',
      live: {
        hash: MPLUS,
        channel: 'M+ LaLiga',
        source: 'iptv',
        matchId: 'fltv-2026-10-31-aaaa',
        match: 'Real Madrid – Barcelona',
      },
    });
    await Promise.resolve();
    expect(released).toEqual(['v_ana']);
    const playback = events().find((event) => event.type === 'party.playback');
    expect(playback?.data).toMatchObject({ action: 'title', by: host.member.id });
    const room = events().findLast((event) => event.type === 'party.room');
    expect(room?.type === 'party.room' && room.data.live).toMatchObject({
      hash: MPLUS,
      auto: true,
    });
    const chat = events().filter((event) => event.type === 'party.chat');
    expect(JSON.stringify(chat)).toContain('Isma ha cambiado a M+ LaLiga.');
  });

  it('ni pausa ni lista; un invitado no cambia de canal; el automático lo cambia quien controla', () => {
    const { party } = setup();
    const host = party.create(BODY);
    const guest = party.join(host.room.code, 'Ana');
    const room = host.room.code;
    expect(() =>
      party.control(room, { token: host.member.token, action: 'pause', positionS: 0 }),
    ).toThrow(expect.objectContaining({ code: 'validation_error' }));
    let error: unknown;
    try {
      party.queue(room, { token: host.member.token, action: 'next' });
    } catch (caught) {
      error = caught;
    }
    expect(code(error)).toBe('validation_error');
    try {
      party.control(room, {
        token: guest.member.token,
        action: 'live',
        live: { hash: MPLUS, channel: 'M+', source: 'engine', matchId: null, match: null },
      });
    } catch (caught) {
      error = caught;
    }
    expect(code(error)).toBe('party_leader_only');
    party.settings(room, { token: host.member.token, auto: false });
    const snapshot = party.join(room, 'Leo');
    expect(snapshot.room.live?.auto).toBe(false);
  });

  it('alguien de casa coge el canal y «Reanudar»: la sala vuelve a ir (playing: true) y el latido lo dice', async () => {
    const { core, party, beats } = setup();
    await party.start();
    const host = party.create(BODY);
    const room = host.room.code;
    const events = listen(party, room, host.member.token);
    const open = () =>
      party.stream(
        room,
        query(host.member.token, 'v_isma'),
        viewer('v_isma'),
        new AbortController().signal,
      );
    await open();
    core.bus.emit('playback.handoff', {
      sessionId: GRANT.session.id,
      viewerIds: ['v_isma'],
      byDeviceId: 'pc-casa',
      byClient: 'web',
      hash: 'e'.repeat(40),
      title: 'Otra cosa',
      reason: 'other_channel',
    });
    const lastOf = <K extends PartyEvent['type']>(type: K) =>
      events().findLast((event): event is Extract<PartyEvent, { type: K }> => event.type === type);
    expect(lastOf('party.room')?.data.interrupted).toBe('taken');
    expect(lastOf('party.playback')?.data.playback.playing).toBe(false);

    /* «Reanudar»: abrir otra vez el canal. */
    await open();
    expect(lastOf('party.room')?.data.interrupted).toBeNull();
    expect(lastOf('party.playback')?.data).toMatchObject({
      action: 'resume',
      playback: { playing: true },
    });
    expect(party.join(room, 'Leo').room.playback.playing).toBe(true);
    await party.status(room, { token: host.member.token, positionS: 0, buffering: false });
    expect(beats.at(-1)).toEqual({ viewer: 'v_isma', playing: true });
    await party.stop();
  });

  it('partyArt: una sala en directo no da carteles (vod_not_found)', async () => {
    const { party } = setup();
    const host = party.create(BODY);
    await expect(
      party.art(host.room.code, host.room.title.artId, undefined, undefined),
    ).rejects.toMatchObject({ code: 'vod_not_found' });
  });

  it('en directo nadie espera al que carga', async () => {
    const { party, clock } = setup();
    const host = party.create(BODY);
    const guest = party.join(host.room.code, 'Ana');
    await party.status(host.room.code, {
      token: guest.member.token,
      positionS: 0,
      buffering: true,
    });
    clock.advance(5_000);
    const status = await party.status(host.room.code, {
      token: guest.member.token,
      positionS: 0,
      buffering: true,
    });
    expect(status.rev).toBe(host.room.playback.rev);
    expect(party.join(host.room.code, 'Leo').room.playback.waitingFor).toEqual([]);
  });
});

describe('«Ver juntos»: las salas abiertas desde casa', () => {
  it('lista las salas (la más nueva primero) y cierra una sin credencial', async () => {
    const { party, clock } = setup();
    const first = party.create(BODY);
    clock.advance(1_000);
    const second = party.create({ ...BODY, name: 'Ana' });
    party.join(second.room.code, 'Leo');
    const listed = party.list().rooms;
    expect(listed.map((room) => room.code)).toEqual([second.room.code, first.room.code]);
    expect(listed[0]).toMatchObject({ host: 'Ana', members: 2, title: { kind: 'live' } });
    const events = listen(party, first.room.code, first.member.token);
    party.end(first.room.code);
    expect(events().some((event) => event.type === 'party.closed')).toBe(true);
    expect(party.list().rooms.map((room) => room.code)).toEqual([second.room.code]);
    expect(() => party.end(first.room.code)).toThrow(
      expect.objectContaining({ code: 'party_not_found' }),
    );
  });
});
