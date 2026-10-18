/* «Ver juntos» (docs/ver-juntos.md, D36): las salas con el reloj falso y un
   playback de mentira (solo `acquireVod`).

   - crear, ver antes de entrar, entrar (nombres repetidos, sala llena) y la
     credencial que no vale;
   - el reloj de la sala: reproducir avanza, pausar y saltar fijan;
   - esperar al que carga (gracia, vuelta y tope de `holdMaxMs`);
   - el SSE: primero `party.snapshot`, luego lo que pasa; el chat y su tope;
   - el vídeo: `acquireVod` con la sala, su posición y su audio; la sala
     aprende título, duración y pistas;
   - un traspaso o un fallo de la sesión deja la sala en pausa e
     «interrumpida» (menos el del cambio de idioma);
   - cerrar (solo el anfitrión), salir y la sala vacía que caduca. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PARTY,
  PartyEventSchema,
  type PartyCreateBody,
  type PartyEvent,
  type VodGrant,
  type VodStreamQuery,
} from '@ace/shared';
import { createTestCore } from '../../../test/helpers/index.js';
import type { FakeClock } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import { FakeSink } from '../events/test-support.js';
import type { ViewerIdentity } from '../playback/types.js';
import type { VodAcquireOptions } from '../playback/types.js';
import { createPartyService, type PartyService } from './index.js';

const PELI = '4b5c6d7e8f9012345678abcdef0123457a8b9c0d';
const GRANT = JSON.parse(
  readFileSync(
    new URL('../../../../../packages/shared/fixtures/web/v1/partyStream.json', import.meta.url),
    'utf8',
  ),
) as VodGrant;

const BODY: PartyCreateBody = {
  titleId: PELI,
  kind: 'movie',
  artId: PELI,
  poster: null,
  title: 'Dune',
  subtitle: null,
  audio: null,
  name: 'Isma',
};

interface Call {
  readonly id: string;
  readonly query: VodStreamQuery;
  readonly viewer: ViewerIdentity;
  readonly options: VodAcquireOptions | undefined;
}

function setup() {
  const core = createTestCore();
  const clock = core.clock as FakeClock;
  const calls: Call[] = [];
  const party = createPartyService({
    ...core,
    playback: {
      acquireVod: async (id, query, viewer, _signal, options) => {
        calls.push({ id, query, viewer, options });
        return GRANT;
      },
    },
  });
  return { core, clock, calls, party };
}

type DataOf<K extends PartyEvent['type']> = Extract<PartyEvent, { type: K }>['data'];

/** Un SSE abierto con lo que va llegando ya parseado. */
function listen(party: PartyService, code: string, token: string) {
  const sink = new FakeSink();
  const controller = new AbortController();
  const done = party.attach(code, token, sink, controller.signal);
  const events = (): PartyEvent[] =>
    sink.chunks
      .filter((chunk) => chunk.startsWith('event: '))
      .map((chunk) => {
        const [typeLine, dataLine] = chunk.split('\n');
        return PartyEventSchema.parse({
          type: typeLine?.slice('event: '.length),
          data: JSON.parse(dataLine?.slice('data: '.length) ?? 'null'),
        });
      });
  function of<K extends PartyEvent['type']>(type: K): DataOf<K>[] {
    const found: unknown[] = events()
      .filter((event) => event.type === type)
      .map((event) => event.data);
    return found as DataOf<K>[];
  }
  return { sink, done, hangUp: () => controller.abort(), events, of };
}

function code(error: unknown): string | undefined {
  return error instanceof AppError ? error.code : undefined;
}

const viewer = (viewerId: string): ViewerIdentity => ({
  viewerId,
  deviceId: `pc-${viewerId}`,
  device: null,
});

describe('«Ver juntos»: salas', () => {
  it('crear, ver antes de entrar y entrar; nombres repetidos, sala llena y credencial mala', () => {
    const { party } = setup();
    const host = party.create(BODY);
    expect(host.room.members).toEqual([
      { id: host.member.id, name: 'Isma', host: true, online: true, buffering: false },
    ]);
    expect(host.room.hostId).toBe(host.member.id);
    expect(host.room.code).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(host.chat.map((m) => m.text)).toEqual(['Isma ha creado la sala.']);

    const preview = party.preview(host.room.code);
    expect(preview).toEqual({
      code: host.room.code,
      title: host.room.title,
      members: ['Isma'],
      full: false,
    });

    const ana = party.join(host.room.code, 'Ana');
    expect(ana.room.members.map((m) => m.name)).toEqual(['Isma', 'Ana']);
    expect(party.join(host.room.code, 'isma').room.members.at(-1)?.name).toBe('isma 2');

    for (let i = 3; i < PARTY.maxMembers; i += 1) party.join(host.room.code, `P${i}`);
    expect(code(catchError(() => party.join(host.room.code, 'Sobra')))).toBe('party_full');
    expect(party.preview(host.room.code).full).toBe(true);

    expect(code(catchError(() => party.preview('AAAAAAAAAAAAAAAA')))).toBe('party_not_found');
    const forged = `${ana.member.id}.${'x'.repeat(32)}`;
    expect(
      code(
        catchError(() =>
          party.status(host.room.code, { token: forged, positionS: 0, buffering: false }),
        ),
      ),
    ).toBe('party_forbidden');
    /* La credencial de otra sala tampoco vale. */
    const other = party.create(BODY);
    expect(
      code(
        catchError(() =>
          party.status(other.room.code, {
            token: ana.member.token,
            positionS: 0,
            buffering: false,
          }),
        ),
      ),
    ).toBe('party_forbidden');
  });

  it('el reloj de la sala: reproducir avanza, pausar y saltar fijan, y cada orden sube rev', () => {
    const { party, clock } = setup();
    const host = party.create(BODY);
    const room = host.room.code;
    const token = host.member.token;
    const sse = listen(party, room, token);
    party.control(room, { token, action: 'play', positionS: 100 });
    clock.advance(10_000);
    party.control(room, { token, action: 'pause', positionS: 110 });
    party.control(room, { token, action: 'seek', positionS: 2_000 });
    const states = sse.of('party.playback');
    expect(states.map((s) => [s.action, s.playback.playing, s.playback.positionS])).toEqual([
      ['play', true, 100],
      ['pause', false, 110],
      ['seek', false, 2_000],
    ]);
    expect(states.map((s) => s.playback.rev)).toEqual([2, 3, 4]);
    expect(states.every((s) => s.by === host.member.id)).toBe(true);
    expect(sse.of('party.chat').map((c) => c.message.text)).toEqual([
      'Isma ha dado a reproducir.',
      'Isma ha pausado.',
      'Isma ha saltado a 33:20.',
    ]);
  });

  it('espera al que carga: tras la gracia se para el reloj; sigue cuando vuelve o a los 20 s', async () => {
    const { party, clock, calls } = setup();
    const host = party.create(BODY);
    const room = host.room.code;
    const ana = party.join(room, 'Ana');
    const sse = listen(party, room, host.member.token);
    /* El vídeo da la duración: sin ella, la posición no tiene tope. */
    await party.stream(room, streamQuery(host.member.token, 'v-isma'), viewer('v-isma'), live());
    expect(calls).toHaveLength(1);
    party.control(room, { token: host.member.token, action: 'play', positionS: 0 });

    /* Un parpadeo de menos de la gracia no para a nadie. */
    party.status(room, { token: ana.member.token, positionS: 0, buffering: true });
    clock.advance(PARTY.bufferingGraceMs - 100);
    party.status(room, { token: ana.member.token, positionS: 0, buffering: false });
    expect(sse.of('party.playback').map((s) => s.action)).toEqual(['play']);

    clock.advance(5_000);
    party.status(room, { token: ana.member.token, positionS: 5, buffering: true });
    clock.advance(PARTY.bufferingGraceMs);
    clock.advance(1_000);
    let last = sse.of('party.playback').at(-1);
    expect(last?.action).toBe('wait');
    expect(last?.playback.waitingFor).toEqual([ana.member.id]);
    const frozen = last?.playback.positionS ?? -1;
    expect(frozen).toBeGreaterThan(5);
    expect(frozen).toBeLessThanOrEqual(7.5);

    clock.advance(3_000);
    party.status(room, { token: ana.member.token, positionS: frozen, buffering: false });
    last = sse.of('party.playback').at(-1);
    expect(last?.action).toBe('resume');
    expect(last?.playback.waitingFor).toEqual([]);
    expect(last?.playback.positionS).toBe(frozen);
    expect(last?.playback.at).toBe(clock.now());

    /* Si no vuelve nunca, a los 20 s la sala sigue sin ella. */
    party.status(room, { token: ana.member.token, positionS: frozen, buffering: true });
    clock.advance(PARTY.bufferingGraceMs + 1_000);
    expect(sse.of('party.playback').at(-1)?.action).toBe('wait');
    clock.advance(PARTY.holdMaxMs);
    expect(sse.of('party.playback').at(-1)?.action).toBe('resume');
    /* Y no se la vuelve a esperar enseguida. */
    clock.advance(2_000);
    expect(sse.of('party.playback').at(-1)?.action).toBe('resume');
  });

  it('el SSE empieza con la foto entera; el chat llega a todos y tiene tope por minuto', () => {
    const { party, clock } = setup();
    const host = party.create(BODY);
    const room = host.room.code;
    const ana = party.join(room, 'Ana');
    const sse = listen(party, room, ana.member.token);
    expect(sse.sink.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    const first = sse.events()[0];
    expect(first?.type).toBe('party.snapshot');
    if (first?.type !== 'party.snapshot') return;
    expect(first.data.room.members.map((m) => m.name)).toEqual(['Isma', 'Ana']);
    expect(first.data.chat.map((m) => m.text)).toEqual([
      'Isma ha creado la sala.',
      'Ana se ha unido.',
    ]);

    party.chat(room, { token: host.member.token, text: '¿Le doy?' });
    expect(sse.of('party.chat').at(-1)?.message).toMatchObject({
      kind: 'chat',
      memberId: host.member.id,
      name: 'Isma',
      text: '¿Le doy?',
    });
    for (let i = 1; i < PARTY.chatPerMinute; i += 1) {
      party.chat(room, { token: host.member.token, text: `m${i}` });
    }
    expect(
      code(catchError(() => party.chat(room, { token: host.member.token, text: 'uno más' }))),
    ).toBe('rate_limited');
    clock.advance(60_000);
    party.chat(room, { token: host.member.token, text: 'ya puedo' });
    expect(sse.of('party.chat').at(-1)?.message.text).toBe('ya puedo');
  });

  it('el vídeo: la sala, su posición y su audio; aprende título, duración y pistas', async () => {
    const { party, clock, calls } = setup();
    const host = party.create({ ...BODY, audio: 1 });
    const room = host.room.code;
    const sse = listen(party, room, host.member.token);
    party.control(room, { token: host.member.token, action: 'play', positionS: 600 });
    clock.advance(30_000);
    await party.stream(room, streamQuery(host.member.token, 'v-isma'), viewer('v-isma'), live());
    expect(calls[0]).toMatchObject({
      id: PELI,
      query: { client: 'web', viewer: 'v-isma', hevc: '0', start: 630, audio: 1 },
      options: { partyKey: room },
    });
    const update = sse.of('party.room').at(-1);
    expect(update?.title).toMatchObject({ title: 'Dune', durationS: 9_360 });
    expect(update?.audio).toEqual({
      index: 1,
      tracks: [
        { index: 0, label: 'Castellano 5.1' },
        { index: 1, label: 'Inglés 5.1' },
      ],
    });
    /* La credencial va en la query: sin ella, nada. */
    await expect(
      party.stream(
        room,
        streamQuery(`${host.member.id}.${'y'.repeat(32)}`, 'v'),
        viewer('v'),
        live(),
      ),
    ).rejects.toMatchObject({ code: 'party_forbidden' });
  });

  it('alguien de casa pone otra cosa: la sala se pausa «interrumpida»; el cambio de idioma no cuenta', async () => {
    const { party, clock, core } = setup();
    await party.start();
    const host = party.create(BODY);
    const room = host.room.code;
    const sse = listen(party, room, host.member.token);
    await party.stream(room, streamQuery(host.member.token, 'v-isma'), viewer('v-isma'), live());
    party.control(room, { token: host.member.token, action: 'play', positionS: 0 });

    /* Cambiar el idioma reabre la sesión: el traspaso del mismo título es de la sala. */
    party.control(room, { token: host.member.token, action: 'audio', positionS: 10, audio: 1 });
    core.bus.emit('playback.handoff', handoff(['v-isma'], PELI));
    expect(sse.of('party.room').at(-1)?.interrupted).toBeNull();
    await party.stream(room, streamQuery(host.member.token, 'v-isma'), viewer('v-isma'), live());

    clock.advance(60_000);
    core.bus.emit('playback.handoff', handoff(['v-isma'], 'e'.repeat(40)));
    expect(sse.of('party.room').at(-1)?.interrupted).toBe('taken');
    const paused = sse.of('party.playback').at(-1);
    expect(paused?.action).toBe('pause');
    expect(paused?.playback.playing).toBe(false);
    expect(paused?.playback.positionS).toBeCloseTo(70, 0);
    expect(sse.of('party.chat').at(-1)?.message.text).toBe(
      'Alguien ha puesto otra cosa en la IPTV de casa. La sala está en pausa.',
    );
    /* «Reanudar»: abrir otra vez la quita. */
    await party.stream(room, streamQuery(host.member.token, 'v-isma'), viewer('v-isma'), live());
    expect(sse.of('party.room').at(-1)?.interrupted).toBeNull();

    /* Un fallo del productor también. */
    core.bus.emit('stream.closed', {
      sessionId: GRANT.session.id,
      viewerIds: ['v-isma'],
      reason: 'remux_failed',
      code: 'vod_dropped',
    });
    expect(sse.of('party.room').at(-1)?.interrupted).toBe('failed');
    await party.stop();
  });

  it('cerrar solo el anfitrión; salir; la sala vacía caduca a los 10 min', async () => {
    const { party, clock } = setup();
    const host = party.create(BODY);
    const room = host.room.code;
    const ana = party.join(room, 'Ana');
    const sse = listen(party, room, host.member.token);
    expect(code(catchError(() => party.close(room, ana.member.token)))).toBe('party_host_only');
    party.leave(room, ana.member.token);
    expect(
      sse
        .of('party.room')
        .at(-1)
        ?.members.map((m) => m.name),
    ).toEqual(['Isma']);
    expect(
      code(catchError(() => party.chat(room, { token: ana.member.token, text: 'hola' }))),
    ).toBe('party_forbidden');
    party.close(room, host.member.token);
    expect(sse.of('party.closed')).toEqual([{ reason: 'host' }]);
    expect(sse.sink.writableEnded).toBe(true);
    await sse.done;
    expect(code(catchError(() => party.preview(room)))).toBe('party_not_found');

    const other = party.create(BODY);
    expect(party.health()).toEqual({ rooms: 1, members: 1, connections: 0 });
    clock.advance(PARTY.memberTimeoutMs + PARTY.emptyRoomTtlMs + 2_000);
    expect(code(catchError(() => party.preview(other.room.code)))).toBe('party_not_found');
    expect(party.health().rooms).toBe(0);
  });

  it('con alguien conectado la sala no caduca; tope de salas abiertas', () => {
    const { party, clock } = setup();
    const host = party.create(BODY);
    listen(party, host.room.code, host.member.token);
    clock.advance(PARTY.emptyRoomTtlMs * 3);
    expect(party.preview(host.room.code).members).toEqual(['Isma']);
    for (let i = 1; i < PARTY.maxRooms; i += 1) party.create(BODY);
    expect(code(catchError(() => party.create(BODY)))).toBe('party_limit');
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

function live(): AbortSignal {
  return new AbortController().signal;
}

function streamQuery(t: string, viewerId: string) {
  return { client: 'web' as const, viewer: viewerId, hevc: '0' as const, t };
}

function handoff(viewerIds: string[], hash: string) {
  return {
    sessionId: GRANT.session.id,
    viewerIds,
    byDeviceId: 'pc-casa',
    byClient: 'web' as const,
    hash,
    title: 'Otra cosa',
    reason: 'other_channel' as const,
  };
}
