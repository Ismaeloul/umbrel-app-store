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
   - cerrar (solo el anfitrión), salir y la sala vacía que caduca;
   - co-líderes, «Esperando a todos» y «está escribiendo» (§13);
   - la calidad ligera de los invitados (§17): la tabla entera de quién recibe
     `master.m3u8`, `lo.m3u8` o el `index.m3u8` de siempre. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PARTY,
  PartyEventSchema,
  PartyStreamGrantSchema,
  PartyStreamQuerySchema,
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
import { vodUnsupported } from '../remux/vod/codecs.js';
import { liteOfferFor, liteVariantFor } from '../remux/vod/lite.js';
import type { VodIndex } from '../remux/vod/types.js';
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
  control: 'leader',
  coleaders: true,
  queueMode: 'autoplay',
};

interface Call {
  readonly id: string;
  readonly query: VodStreamQuery;
  readonly viewer: ViewerIdentity;
  readonly options: VodAcquireOptions | undefined;
}

function setup(env: Record<string, string> = {}, grant: VodGrant = GRANT) {
  const core = createTestCore({ env });
  const clock = core.clock as FakeClock;
  const calls: Call[] = [];
  const beats: { sid: string; viewer: string; playing: boolean | undefined }[] = [];
  const released: { sid: string; viewer: string }[] = [];
  const control = { beatFails: false };
  const party = createPartyService({
    ...core,
    playback: {
      /* Las salas en directo tienen su prueba (live.test.ts). */
      acquire: () => Promise.reject(new Error('directo')),
      acquireVod: async (id, query, viewer, _signal, options) => {
        calls.push({ id, query, viewer, options });
        return grant;
      },
      heartbeat: async (sid, body) => {
        if (control.beatFails) throw new AppError('session_expired');
        beats.push({ sid, viewer: body.viewer, playing: body.playing });
        return {
          session: GRANT.session,
          url: GRANT.url,
          protocol: GRANT.protocol,
          viewers: 1,
        };
      },
      release: async (sid, body) => {
        released.push({ sid, viewer: body.viewer });
        return { released: true, sessionClosed: false };
      },
    },
  });
  return { core, clock, calls, beats, released, control, party };
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
  it('crear, ver antes de entrar y entrar; nombres repetidos, sala llena y credencial mala', async () => {
    const { party } = setup();
    const host = party.create(BODY);
    expect(host.room.members).toEqual([
      {
        id: host.member.id,
        name: 'Isma',
        host: true,
        leader: true,
        role: 'leader',
        ready: false,
        progress: null,
        online: true,
        buffering: false,
      },
    ]);
    expect(host.room.hostId).toBe(host.member.id);
    expect(host.room.leaderId).toBe(host.member.id);
    expect(host.room.settings).toEqual({
      control: 'leader',
      coleaders: true,
      queueMode: 'autoplay',
    });
    /* Empieza en «Esperando a todos» (§13), parada en el principio. */
    expect(host.room.playback).toMatchObject({ playing: false, positionS: 0, lobby: true });
    expect(host.room.queue).toEqual([]);
    expect(host.room.upNext).toBeNull();
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
    await expect(
      party.status(host.room.code, { token: forged, positionS: 0, buffering: false }),
    ).rejects.toMatchObject({ code: 'party_forbidden' });
    /* La credencial de otra sala tampoco vale. */
    const other = party.create(BODY);
    await expect(
      party.status(other.room.code, { token: ana.member.token, positionS: 0, buffering: false }),
    ).rejects.toMatchObject({ code: 'party_forbidden' });
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
    /* El primer «reproducir» es «Empezar para todos»: acaba la espera. */
    expect(states.map((s) => s.playback.lobby)).toEqual([false, false, false]);
    expect(sse.of('party.chat').map((c) => c.message.text)).toEqual([
      'Isma ha empezado para todos.',
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
    /* No sigue con el primer «ya no cargo» (§16): tiene que durar `resumeSettleMs`. */
    expect(sse.of('party.playback').at(-1)?.action).toBe('wait');
    clock.advance(PARTY.resumeSettleMs + 1_000);
    last = sse.of('party.playback').at(-1);
    expect(last?.action).toBe('resume');
    expect(last?.playback.waitingFor).toEqual([]);
    expect(last?.playback.positionS).toBe(frozen);
    /* La quita el barrido (cada segundo): el reloj sigue desde ese momento. */
    expect(last?.playback.at).toBeLessThanOrEqual(clock.now());
    expect(last?.playback.at).toBeGreaterThan(clock.now() - 1_000);

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

  it('§16: quien para la sala a menudo tiene más margen; un «ya no cargo» que no dura no la reanuda', async () => {
    const { party, clock } = setup();
    const host = party.create(BODY);
    const room = host.room.code;
    const ana = party.join(room, 'Ana');
    const sse = listen(party, room, host.member.token);
    await party.stream(room, streamQuery(host.member.token, 'v-isma'), viewer('v-isma'), live());
    party.control(room, { token: host.member.token, action: 'play', positionS: 0 });
    const actions = () => sse.of('party.playback').map((s) => s.action);
    const hold = () => {
      party.status(room, { token: ana.member.token, positionS: 0, buffering: true });
      clock.advance(PARTY.bufferingGraceMs + 1_000);
    };
    const recover = () => {
      party.status(room, { token: ana.member.token, positionS: 0, buffering: false });
      clock.advance(PARTY.resumeSettleMs + 1_000);
    };

    /* Recupera y enseguida vuelve a cargar: la espera sigue, sin «resume» de en medio. */
    hold();
    party.status(room, { token: ana.member.token, positionS: 0, buffering: false });
    clock.advance(200);
    party.status(room, { token: ana.member.token, positionS: 0, buffering: true });
    clock.advance(1_500);
    expect(actions()).toEqual(['play', 'wait']);
    recover();
    expect(actions().at(-1)).toBe('resume');

    /* Segunda espera, con el margen de siempre. */
    hold();
    expect(actions().at(-1)).toBe('wait');
    recover();

    /* Ya son dos en un minuto: un atasco de 1,8 s no para la sala; uno de más de 2,5 s, sí. */
    const before = actions().length;
    hold();
    expect(actions()).toHaveLength(before);
    clock.advance(PARTY.repeatBufferingGraceMs);
    expect(actions().at(-1)).toBe('wait');
  });

  it('§16: quien se recupera justo antes del tope sale de la espera sin enfriamiento', async () => {
    const { party, clock } = setup();
    const host = party.create(BODY);
    const room = host.room.code;
    const ana = party.join(room, 'Ana');
    const sse = listen(party, room, host.member.token);
    await party.stream(room, streamQuery(host.member.token, 'v-isma'), viewer('v-isma'), live());
    party.control(room, { token: host.member.token, action: 'play', positionS: 0 });
    const last = () => sse.of('party.playback').at(-1)?.action;
    party.status(room, { token: ana.member.token, positionS: 0, buffering: true });
    clock.advance(PARTY.bufferingGraceMs + 1_000);
    expect(last()).toBe('wait');
    /* «Ya no cargo» a 300 ms del tope: el tope llega antes de los 700 ms. */
    clock.advance(PARTY.holdMaxMs - 1_300);
    party.status(room, { token: ana.member.token, positionS: 0, buffering: false });
    clock.advance(1_000);
    expect(last()).toBe('resume');
    /* Sin castigo: un atasco nuevo vuelve a parar la sala. */
    clock.advance(5_000);
    party.status(room, { token: ana.member.token, positionS: 0, buffering: true });
    clock.advance(PARTY.bufferingGraceMs + 1_000);
    expect(last()).toBe('wait');
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

describe('«Ver juntos» desde fuera (docs/ver-juntos.md §9)', () => {
  it('el vídeo va por la ruta de la sala con la clave de cada persona; otra clave no vale', async () => {
    const { party } = setup();
    const host = party.create(BODY);
    const room = host.room.code;
    const ana = party.join(room, 'Ana');
    expect(code(catchError(() => party.videoSession(room, 'k'.repeat(32))))).toBe(
      'party_forbidden',
    );
    const grant = await party.stream(
      room,
      streamQuery(ana.member.token, 'v-ana'),
      viewer('v-ana'),
      live(),
    );
    expect(grant.url).toMatch(
      new RegExp(`^/api/v1/party/${room}/v/[A-Za-z0-9_-]{32}/index\\.m3u8$`),
    );
    const key = grant.url.split('/')[6] ?? '';
    expect(party.videoSession(room, key)).toBe(GRANT.session.id);
    /* La clave de Ana no es la de Isma, que aún no ha abierto el vídeo. */
    const isma = await party.stream(
      room,
      streamQuery(host.member.token, 'v-isma'),
      viewer('v-isma'),
      live(),
    );
    expect(isma.url).not.toBe(grant.url);
  });

  it('el latido de la sesión va con el estado de la sala: ok, lost y none', async () => {
    const { party, beats, control } = setup();
    const host = party.create(BODY);
    const room = host.room.code;
    const status = () =>
      party.status(room, { token: host.member.token, positionS: 0, buffering: false });
    expect((await status()).stream).toBe('none');
    await party.stream(room, streamQuery(host.member.token, 'v-isma'), viewer('v-isma'), live());
    expect((await status()).stream).toBe('ok');
    expect(beats.at(-1)).toEqual({ sid: GRANT.session.id, viewer: 'v-isma', playing: false });
    control.beatFails = true;
    expect((await status()).stream).toBe('lost');
    control.beatFails = false;
    expect((await status()).stream).toBe('none');
  });

  it('salir o cerrar la sala suelta los visores de cada uno', async () => {
    const { party, released } = setup();
    const host = party.create(BODY);
    const room = host.room.code;
    const ana = party.join(room, 'Ana');
    await party.stream(room, streamQuery(ana.member.token, 'v-ana'), viewer('v-ana'), live());
    await party.stream(room, streamQuery(host.member.token, 'v-isma'), viewer('v-isma'), live());
    party.leave(room, ana.member.token);
    expect(released).toEqual([{ sid: GRANT.session.id, viewer: 'v-ana' }]);
    party.close(room, host.member.token);
    expect(released.at(-1)).toEqual({ sid: GRANT.session.id, viewer: 'v-isma' });
  });

  it('el enlace de invitación es el del proxy con PARTY_PUBLIC_URL; sin él, null', () => {
    expect(setup().party.create(BODY).room.inviteUrl).toBeNull();
    const created = setup({ PARTY_PUBLIC_URL: 'https://sala.ismaeloul.es/' }).party.create(BODY);
    expect(created.room.inviteUrl).toBe(`https://sala.ismaeloul.es/s/${created.room.code}`);
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
  return { client: 'web' as const, viewer: viewerId, hevc: '0' as const, abr: '0' as const, t };
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

describe('«Ver juntos»: líder, co-líderes y lista (§11 y §13)', () => {
  const OTRA = '0123456789abcdef0123456789abcdef01234567';
  const EPI2 = 'aaaabbbbccccddddeeeeffff0000111122223333';

  function room2() {
    const s = setup();
    const host = s.party.create(BODY);
    const room = host.room.code;
    const ana = s.party.join(room, 'Ana');
    return { ...s, host, ana, room };
  }

  const add = (token: string, titleId = OTRA, title = 'Otra peli') => ({
    token,
    action: 'add' as const,
    titleId,
    kind: 'movie' as const,
    artId: titleId,
    poster: null,
    title,
    subtitle: null,
  });

  it('solo el líder controla; con «todos», cualquiera; los ajustes, solo el líder', () => {
    const { party, host, ana, room } = room2();
    const play = (token: string) => party.control(room, { token, action: 'play', positionS: 0 });
    expect(code(catchError(() => play(ana.member.token)))).toBe('party_leader_only');
    expect(play(host.member.token).rev).toBeGreaterThan(1);
    expect(
      code(
        catchError(() => party.settings(room, { token: ana.member.token, control: 'everyone' })),
      ),
    ).toBe('party_leader_only');
    party.settings(room, { token: host.member.token, control: 'everyone' });
    expect(() => play(ana.member.token)).not.toThrow();
  });

  it('echar: a quien echan le llega `kicked` y su credencial deja de valer; a quien creó la sala, no', () => {
    const { party, host, ana, room } = room2();
    const anaSse = listen(party, room, ana.member.token);
    party.member(room, { token: host.member.token, memberId: ana.member.id, action: 'kick' });
    expect(anaSse.of('party.closed')).toEqual([{ reason: 'kicked' }]);
    expect(
      code(catchError(() => party.chat(room, { token: ana.member.token, text: 'hola' }))),
    ).toBe('party_forbidden');
    const bea = party.join(room, 'Bea');
    party.member(room, { token: host.member.token, memberId: bea.member.id, action: 'lead' });
    expect(
      code(
        catchError(() =>
          party.member(room, { token: bea.member.token, memberId: host.member.id, action: 'kick' }),
        ),
      ),
    ).toBe('party_leader_only');
  });

  it('si el líder se va, lo es quien lleva más tiempo; quien creó la sala lo recupera cuando quiera', () => {
    const { party, host, ana, room } = room2();
    listen(party, room, ana.member.token);
    party.leave(room, host.member.token);
    expect(party.preview(room).members).toContain('Isma');
    const sse = listen(party, room, ana.member.token);
    expect(sse.of('party.snapshot')[0]?.room.leaderId).toBe(ana.member.id);
    party.member(room, { token: host.member.token, memberId: host.member.id, action: 'lead' });
    expect(sse.of('party.room').at(-1)?.leaderId).toBe(host.member.id);
  });

  it('co-líder: controla como el líder (si la sala lo deja) pero no echa ni pasa la corona', () => {
    const { party, host, ana, room } = room2();
    const bea = party.join(room, 'Bea');
    const sse = listen(party, room, host.member.token);
    const play = (token: string) => party.control(room, { token, action: 'play', positionS: 0 });
    const roles = () =>
      Object.fromEntries(
        (sse.of('party.room').at(-1)?.members ?? []).map((m) => [m.name, [m.role, m.leader]]),
      );
    /* Solo el líder hace co-líder a alguien. */
    expect(
      code(
        catchError(() =>
          party.member(room, {
            token: bea.member.token,
            memberId: ana.member.id,
            action: 'coleader',
          }),
        ),
      ),
    ).toBe('party_leader_only');
    party.member(room, { token: host.member.token, memberId: ana.member.id, action: 'coleader' });
    expect(roles()).toEqual({
      Isma: ['leader', true],
      Ana: ['coleader', false],
      Bea: ['guest', false],
    });
    expect(sse.of('party.chat').at(-1)?.message.text).toBe('Isma ha hecho co-líder a Ana.');
    /* Controla el vídeo y la regla de lo siguiente; la invitada, no. */
    expect(() => play(ana.member.token)).not.toThrow();
    expect(code(catchError(() => play(bea.member.token)))).toBe('party_leader_only');
    party.settings(room, { token: ana.member.token, queueMode: 'vote' });
    /* Pero no cambia quién controla, no echa y no pasa ni quita la corona. */
    expect(
      code(catchError(() => party.settings(room, { token: ana.member.token, coleaders: false }))),
    ).toBe('party_leader_only');
    for (const [memberId, action] of [
      [bea.member.id, 'kick'],
      [bea.member.id, 'lead'],
      [ana.member.id, 'lead'],
      [bea.member.id, 'coleader'],
    ] as const) {
      expect(
        code(catchError(() => party.member(room, { token: ana.member.token, memberId, action }))),
      ).toBe('party_leader_only');
    }
    /* «Solo yo»: los co-líderes dejan de controlar. */
    party.settings(room, { token: host.member.token, coleaders: false });
    expect(sse.of('party.chat').at(-1)?.message.text).toBe(
      'Isma se ha quedado solo con el control.',
    );
    expect(code(catchError(() => play(ana.member.token)))).toBe('party_leader_only');
    party.settings(room, { token: host.member.token, coleaders: true });
    /* Quitar el escudo. */
    party.member(room, { token: host.member.token, memberId: ana.member.id, action: 'guest' });
    expect(roles().Ana).toEqual(['guest', false]);
    expect(code(catchError(() => play(ana.member.token)))).toBe('party_leader_only');
    /* Quien pasa la corona se queda de invitado (no sigue controlando sin que nadie lo decida);
       la nueva líder deja de ser co-líder. */
    party.member(room, { token: host.member.token, memberId: bea.member.id, action: 'coleader' });
    party.member(room, { token: host.member.token, memberId: bea.member.id, action: 'lead' });
    expect(roles()).toEqual({
      Isma: ['guest', false],
      Ana: ['guest', false],
      Bea: ['leader', true],
    });
    expect(code(catchError(() => play(host.member.token)))).toBe('party_leader_only');
    /* Quien creó la sala recupera la corona y Bea vuelve a ser invitada, no co-líder. */
    party.member(room, { token: host.member.token, memberId: host.member.id, action: 'lead' });
    expect(roles()).toEqual({
      Isma: ['leader', true],
      Ana: ['guest', false],
      Bea: ['guest', false],
    });
  });

  it('«Esperando a todos»: arranca sola con todos listos (con dos o más) o con «Empezar para todos»', async () => {
    const { party, host, ana, room } = room2();
    const sse = listen(party, room, host.member.token);
    listen(party, room, ana.member.token);
    const status = (token: string, ready: boolean, progress: number) =>
      party.status(room, { token, positionS: 0, buffering: !ready, ready, progress });
    await status(host.member.token, true, 100);
    await status(ana.member.token, false, 63);
    const lobby = sse.of('party.room').at(-1)?.members;
    expect(lobby?.map((m) => [m.name, m.ready, m.progress])).toEqual([
      ['Isma', true, 100],
      ['Ana', false, 63],
    ]);
    expect(sse.of('party.playback')).toEqual([]);
    await status(ana.member.token, true, 100);
    const started = sse.of('party.playback').at(-1);
    expect(started).toMatchObject({ action: 'play', by: null });
    expect(started?.playback).toMatchObject({ playing: true, lobby: false, positionS: 0 });
    expect(sse.of('party.chat').at(-1)?.message.text).toBe('Ya estáis todos listos: empieza.');

    /* Sola en la sala recién creada no arranca: espera a que entre alguien o a que le dé ella. */
    const solo = setup();
    const own = solo.party.create(BODY);
    const soloSse = listen(solo.party, own.room.code, own.member.token);
    await solo.party.status(own.room.code, {
      token: own.member.token,
      positionS: 0,
      buffering: false,
      ready: true,
      progress: 100,
    });
    solo.clock.advance(5_000);
    expect(soloSse.of('party.playback')).toEqual([]);
    /* Una invitada no puede empezar; quien controla, sí. */
    const eva = solo.party.join(own.room.code, 'Eva');
    expect(
      code(
        catchError(() =>
          solo.party.control(own.room.code, {
            token: eva.member.token,
            action: 'play',
            positionS: 0,
          }),
        ),
      ),
    ).toBe('party_leader_only');
    solo.party.control(own.room.code, { token: own.member.token, action: 'play', positionS: 0 });
    expect(soloSse.of('party.playback').at(-1)?.playback).toMatchObject({
      playing: true,
      lobby: false,
    });
  });

  it('una app vieja (sin `ready`) cuenta como lista en cuanto abre el vídeo y no carga', async () => {
    const { party, host, ana, room } = room2();
    const sse = listen(party, room, host.member.token);
    listen(party, room, ana.member.token);
    await party.stream(room, streamQuery(host.member.token, 'v-isma'), viewer('v-isma'), live());
    await party.status(room, { token: host.member.token, positionS: 0, buffering: false });
    expect(sse.of('party.playback')).toEqual([]);
    await party.stream(room, streamQuery(ana.member.token, 'v-ana'), viewer('v-ana'), live());
    await party.status(room, { token: ana.member.token, positionS: 0, buffering: false });
    expect(sse.of('party.playback').at(-1)?.playback).toMatchObject({
      playing: true,
      lobby: false,
    });
  });

  it('«está escribiendo»: llega a todos, como mucho uno cada typingIntervalMs por persona', () => {
    const { party, clock, host, ana, room } = room2();
    const sse = listen(party, room, host.member.token);
    party.typing(room, ana.member.token);
    party.typing(room, ana.member.token);
    expect(sse.of('party.typing')).toEqual([{ memberId: ana.member.id, name: 'Ana' }]);
    clock.advance(PARTY.typingIntervalMs);
    party.typing(room, ana.member.token);
    expect(sse.of('party.typing')).toHaveLength(2);
    /* No va al chat ni se guarda. */
    expect(sse.of('party.chat')).toEqual([]);
    expect(code(catchError(() => party.typing(room, `${ana.member.id}.${'z'.repeat(32)}`)))).toBe(
      'party_forbidden',
    );
  });

  it('lista: cualquiera añade y vota; quitar, quien lo añadió o el líder; en «Elijo yo» también proponen', () => {
    const { party, host, ana, room } = room2();
    const sse = listen(party, room, host.member.token);
    party.queue(room, add(ana.member.token));
    const item = sse.of('party.room').at(-1)?.queue[0];
    expect(item).toMatchObject({ addedBy: ana.member.id, addedByName: 'Ana', votes: [] });
    party.queue(room, { token: host.member.token, action: 'vote', itemId: item!.id });
    expect(sse.of('party.room').at(-1)?.queue[0]?.votes).toEqual([host.member.id]);
    party.queue(room, add(host.member.token, EPI2, 'De Isma'));
    const mine = sse.of('party.room').at(-1)!.queue[1]!;
    expect(
      code(
        catchError(() =>
          party.queue(room, { token: ana.member.token, action: 'remove', itemId: mine.id }),
        ),
      ),
    ).toBe('party_leader_only');
    party.queue(room, { token: ana.member.token, action: 'remove', itemId: item!.id });
    expect(
      sse
        .of('party.room')
        .at(-1)
        ?.queue.map((q) => q.id),
    ).toEqual([mine.id]);
    party.settings(room, { token: host.member.token, queueMode: 'leader' });
    party.queue(room, add(ana.member.token, OTRA, 'Propuesta'));
    expect(
      sse
        .of('party.room')
        .at(-1)
        ?.queue.map((q) => q.title.title),
    ).toEqual(['De Isma', 'Propuesta']);
  });

  it('al acabar: cuenta atrás y lo primero de la lista empieza para todos', async () => {
    const { party, clock, host, ana, room, released } = room2();
    const sse = listen(party, room, host.member.token);
    await party.stream(room, streamQuery(host.member.token, 'v-isma'), viewer('v-isma'), live());
    party.queue(room, add(host.member.token));
    party.control(room, {
      token: host.member.token,
      action: 'play',
      positionS: GRANT.vod.durationS - 2,
    });
    clock.advance(3_000);
    expect(sse.of('party.playback').at(-1)?.action).toBe('ended');
    expect(sse.of('party.room').at(-1)?.upNext).toMatchObject({ title: { id: OTRA } });
    clock.advance(PARTY.upNextMs);
    const last = sse.of('party.playback').at(-1);
    expect(last?.action).toBe('title');
    /* Otro título: otra vez «Esperando a todos» (§13), y empieza en cuanto todos lo tienen. */
    expect(last?.playback).toMatchObject({ playing: false, positionS: 0, lobby: true });
    const now = sse.of('party.room').at(-1);
    expect(now?.title).toMatchObject({ id: OTRA, durationS: null });
    expect(now?.queue).toEqual([]);
    expect(released.at(-1)).toEqual({ sid: GRANT.session.id, viewer: 'v-isma' });
    for (const token of [host.member.token, ana.member.token]) {
      await party.status(room, {
        token,
        positionS: 0,
        buffering: false,
        ready: true,
        progress: 100,
      });
    }
    expect(sse.of('party.playback').at(-1)).toMatchObject({
      action: 'play',
      playback: { playing: true, lobby: false },
    });
  });

  it('en «votar» gana lo más votado; cancelar quita la cuenta atrás; en «se para», no sigue nada', async () => {
    const { party, clock, host, ana, room } = room2();
    const sse = listen(party, room, host.member.token);
    await party.stream(room, streamQuery(host.member.token, 'v-isma'), viewer('v-isma'), live());
    party.queue(room, add(host.member.token, EPI2, 'Primera'));
    party.queue(room, add(ana.member.token, OTRA, 'Votada'));
    const votada = sse.of('party.room').at(-1)!.queue[1]!;
    party.queue(room, { token: ana.member.token, action: 'vote', itemId: votada.id });
    party.settings(room, { token: host.member.token, queueMode: 'vote' });
    const end = GRANT.vod.durationS - 1;
    party.control(room, { token: host.member.token, action: 'play', positionS: end });
    clock.advance(2_000);
    expect(sse.of('party.room').at(-1)?.upNext?.title.id).toBe(OTRA);
    party.queue(room, { token: host.member.token, action: 'cancel' });
    expect(sse.of('party.room').at(-1)?.upNext).toBeNull();
    clock.advance(PARTY.upNextMs);
    expect(sse.of('party.playback').at(-1)?.action).toBe('ended');

    party.settings(room, { token: host.member.token, queueMode: 'once' });
    party.control(room, { token: host.member.token, action: 'play', positionS: end });
    clock.advance(2_000);
    expect(sse.of('party.room').at(-1)?.upNext).toBeNull();
  });

  it('sin lista, en un episodio sigue el siguiente episodio (con el mismo idioma)', async () => {
    const grant: VodGrant = {
      ...GRANT,
      vod: {
        ...GRANT.vod,
        next: { id: EPI2, title: 'The Office', label: 'T1 · E2 · Diversidad' },
      },
    };
    const s = setup({}, grant);
    const host = s.party.create({ ...BODY, kind: 'episode', audio: 1 });
    const room = host.room.code;
    const sse = listen(s.party, room, host.member.token);
    await s.party.stream(room, streamQuery(host.member.token, 'v-isma'), viewer('v-isma'), live());
    s.party.control(room, {
      token: host.member.token,
      action: 'play',
      positionS: grant.vod.durationS - 1,
    });
    s.clock.advance(2_000 + PARTY.upNextMs);
    const now = sse.of('party.room').at(-1);
    expect(now?.title).toMatchObject({
      id: EPI2,
      kind: 'episode',
      subtitle: 'T1 · E2 · Diversidad',
    });
    expect(now?.audio.index).toBe(1);
  });
});

/* «Calidad ligera para invitados» (docs/ver-juntos.md §17): qué lista recibe cada uno. La decisión
   del remux es la de verdad (`liteOfferFor`); el remux y el playback, de mentira. */
describe('«Ver juntos»: calidad ligera para invitados (§17)', () => {
  type Source = 'h264-1080' | 'h264-720' | 'hevc';
  const VIDEO: Record<Source, VodIndex['video']> = {
    'h264-1080': {
      codec: 'h264',
      codecs: 'avc1.640028',
      width: 1920,
      height: 1080,
      bitDepth: 8,
      profile: 100,
      chromaFormat: 1,
    },
    'h264-720': {
      codec: 'h264',
      codecs: 'avc1.64001f',
      width: 1280,
      height: 720,
      bitDepth: 8,
      profile: 100,
      chromaFormat: 1,
    },
    hevc: {
      codec: 'hevc',
      codecs: 'hvc1.1.6.L120.B0',
      width: 1920,
      height: 1080,
      bitDepth: 8,
      profile: 1,
      chromaFormat: 1,
    },
  };

  interface Case {
    readonly guest: boolean | undefined;
    readonly abr: '0' | '1';
    readonly lite: boolean;
    readonly source: Source;
    readonly hevc: '0' | '1';
    readonly canTranscode: boolean;
    readonly tripped: boolean;
  }

  function liteSetup(c: Case) {
    const core = createTestCore({ env: { ACE_PARTY_LITE: c.lite ? '1' : '0' } });
    const video = VIDEO[c.source];
    /* 2 GB en 100 min: 2,7 Mb/s (el 720p no necesita ligera; el 1080p, sí). */
    const index: VodIndex = {
      container: 'mkv',
      durationS: 6_000,
      keyframes: Float64Array.from([0]),
      video,
      audio: [],
      subtitles: [],
      sizeBytes: 2_000_000_000,
    };
    const grant: VodGrant = {
      ...GRANT,
      codec: { ...GRANT.codec, video: video.codec === 'hevc' ? 'hevc' : 'h264' },
      vod: {
        ...GRANT.vod,
        video: {
          codec: video.codec === 'hevc' ? 'hevc' : 'h264',
          codecs: video.codecs,
          width: video.width,
          height: video.height,
        },
      },
    };
    const acquired: string[] = [];
    const released: string[] = [];
    const party = createPartyService({
      ...core,
      playback: {
        acquire: () => Promise.reject(new Error('directo')),
        acquireVod: async (_id, query) => {
          acquired.push(query.hevc);
          /* Lo que hace assertPlayable: HEVC sin decodificador no se abre. */
          if (video.codec === 'hevc' && query.hevc === '0') {
            throw vodUnsupported('hevc', 'HEVC sin decodificador en el cliente');
          }
          return grant;
        },
        heartbeat: async () => ({
          session: GRANT.session,
          url: GRANT.url,
          protocol: GRANT.protocol,
          viewers: 1,
        }),
        release: async (_sid, body) => {
          released.push(body.viewer);
          return { released: true, sessionClosed: false };
        },
      },
      remux: {
        vodLiteOffer: (_sid, hevcOk) =>
          liteOfferFor({
            enabled: core.config.party.lite,
            ffmpegMissing: false,
            tripped: c.tripped,
            slot: c.canTranscode,
            index,
            hevcOk,
          }),
        /* Con la sesión de la sala ya abierta mira su fusible; sin ella (la sala no tiene visor),
           no lo ve: es la carrera de «se funde o se queda sin plaza mientras se abre». */
        vodLiteCovers: async (_id, sessionId) =>
          !(sessionId && c.tripped) &&
          core.config.party.lite &&
          c.canTranscode &&
          index.video.codec === 'hevc' &&
          liteVariantFor(index, false) === 'lite',
      },
    });
    return { party, acquired, released };
  }

  /** Lo que tiene que pasar: la lista, o el rechazo de hoy (HEVC sin decodificador). */
  function expected(c: Case): 'index.m3u8' | 'master.m3u8' | 'lo.m3u8' | 'vod_unsupported' {
    const wants = c.lite && c.guest === true && c.abr === '1';
    if (c.source === 'hevc' && c.hevc === '0') {
      /* Con la ligera fundida, el rechazo de hoy: nunca una concesión HEVC que no decodifica. */
      if (!wants || !c.canTranscode || c.tripped) return 'vod_unsupported';
      return 'lo.m3u8';
    }
    if (c.source === 'h264-1080' && wants && c.canTranscode && !c.tripped) return 'master.m3u8';
    return 'index.m3u8';
  }

  it('origen × abr × interruptor × fuente × hevc × plaza × fusible: index.m3u8 salvo los casos previstos', async () => {
    const cases: Case[] = [];
    for (const guest of [true, false, undefined])
      for (const abr of ['0', '1'] as const)
        for (const lite of [true, false])
          for (const source of ['h264-1080', 'h264-720', 'hevc'] as const)
            for (const hevc of ['0', '1'] as const)
              for (const canTranscode of [true, false])
                for (const tripped of [true, false])
                  cases.push({ guest, abr, lite, source, hevc, canTranscode, tripped });
    const seen = new Set<string>();
    for (const c of cases) {
      const { party, acquired, released } = liteSetup(c);
      const host = party.create(BODY);
      const query = { ...streamQuery(host.member.token, 'v-ana'), abr: c.abr, hevc: c.hevc };
      const want = expected(c);
      seen.add(want);
      const label = JSON.stringify(c);
      const options = c.guest === undefined ? undefined : { guest: c.guest };
      const result = await party
        .stream(host.room.code, query, viewer('v-ana'), live(), options)
        .then(
          (grant) => ({ grant, error: null }),
          (error: unknown) => ({ grant: null, error }),
        );
      if (want === 'vod_unsupported') {
        expect(code(result.error), label).toBe('vod_unsupported');
        /* Si se llegó a abrir por la ligera, se suelta: ni visor ni productor para nadie. */
        expect(released, label).toEqual(acquired.includes('1') ? ['v-ana'] : []);
        continue;
      }
      expect(released, label).toEqual([]);
      expect(result.error, label).toBeNull();
      const grant = result.grant as VodGrant;
      expect(grant.url, label).toBe(
        `/api/v1/party/${host.room.code}/v/${keyOf(grant.url)}/${want}`,
      );
      /* La concesión sigue siendo una `VodGrant` válida (la de la sala). */
      expect(PartyStreamGrantSchema.safeParse(grant).success, label).toBe(true);
      if (want === 'index.m3u8') {
        expect(grant.variants, label).toBeUndefined();
        expect(grant.vod.video.codecs, label).toBe(VIDEO[c.source].codecs);
      } else if (want === 'master.m3u8') {
        expect(grant.variants, label).toEqual({ hd: 'avc1.640028', lite: 'avc1.640028' });
        expect(grant.vod.video.codecs, label).toBe('avc1.640028');
      } else {
        /* Solo la ligera: el reproductor ve H.264 720p y la acepta. */
        expect(grant.variants, label).toEqual({ hd: null, lite: 'avc1.640028' });
        expect(grant.vod.video, label).toEqual({
          codec: 'h264',
          codecs: 'avc1.640028',
          width: 1280,
          height: 720,
        });
        expect(grant.codec.video, label).toBe('h264');
        expect(acquired, label).toEqual(['0', '1']);
      }
    }
    expect([...seen].sort()).toEqual(['index.m3u8', 'lo.m3u8', 'master.m3u8', 'vod_unsupported']);
  });

  it('HEVC sin decodificador y la ligera de la sala ya fundida: el rechazo, sin abrir nada', async () => {
    const c: Case = {
      guest: true,
      abr: '1',
      lite: true,
      source: 'hevc',
      hevc: '0',
      canTranscode: true,
      tripped: true,
    };
    const { party, acquired, released } = liteSetup(c);
    const host = party.create(BODY);
    /* El anfitrión, que sí decodifica HEVC, ya tiene la sesión de la sala abierta. */
    await party.stream(
      host.room.code,
      { ...streamQuery(host.member.token, 'v-casa'), hevc: '1' },
      viewer('v-casa'),
      live(),
    );
    const guest = party.join(host.room.code, 'Bea');
    const error = await party
      .stream(
        host.room.code,
        { ...streamQuery(guest.member.token, 'v-bea'), abr: '1', hevc: '0' },
        viewer('v-bea'),
        live(),
        { guest: true },
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(code(error)).toBe('vod_unsupported');
    expect(acquired).toEqual(['1', '0']);
    expect(released).toEqual([]);
  });

  it('sin remux nadie recibe otra cosa, y una consulta vieja sin abr sigue valiendo (abr = 0)', async () => {
    const s = setup({ ACE_PARTY_LITE: '1' });
    const host = s.party.create(BODY);
    const grant = (await s.party.stream(
      host.room.code,
      { ...streamQuery(host.member.token, 'v-ana'), abr: '1' },
      viewer('v-ana'),
      live(),
      { guest: true },
    )) as VodGrant;
    expect(grant.url.endsWith('/index.m3u8')).toBe(true);
    expect(grant.variants).toBeUndefined();
    const old = PartyStreamQuerySchema.parse({
      client: 'web',
      viewer: 'v-ana',
      t: host.member.token,
    });
    expect(old).toMatchObject({ abr: '0', hevc: '0' });
  });
});

/** La clave de vídeo de una URL de la sala. */
function keyOf(url: string): string {
  return /\/v\/([A-Za-z0-9_-]{32})\//.exec(url)?.[1] ?? '';
}
