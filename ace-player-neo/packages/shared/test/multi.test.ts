/* Contrato de varios dispositivos a la vez (docs/multidispositivo.md §2.2):
   los campos nuevos son opcionales, validan lo que deben y lo de antes
   sigue valiendo tal cual. */

import { describe, expect, it } from 'vitest';
import {
  BootstrapResponseSchema,
  ChannelStreamQuerySchema,
  MULTI_TIMINGS,
  PlaybackHandoffEventSchema,
  SessionSummarySchema,
  SessionViewerSchema,
  TIMEOUTS,
} from '../src/index.js';

const base = { client: 'web', viewer: 'viewer_tab01' } as const;
const SID = 's_Q2FuYWxEZVBydWViYQ';

describe('ChannelStreamQuerySchema con others, from, join, match y follows', () => {
  it('acepta la petición de siempre sin los campos nuevos', () => {
    const parsed = ChannelStreamQuerySchema.parse(base);
    expect(parsed).not.toHaveProperty('others');
    expect(parsed).not.toHaveProperty('join');
  });

  it('acepta los valores válidos', () => {
    const parsed = ChannelStreamQuerySchema.parse({
      ...base,
      others: 'move',
      from: SID,
      join: '1',
      match: 'fltv-2026-09-23-3',
      follows: '1',
    });
    expect(parsed).toMatchObject({ others: 'move', from: SID, join: '1', follows: '1' });
    expect(ChannelStreamQuerySchema.parse({ ...base, others: 'stop', follows: '0' })).toMatchObject(
      { others: 'stop', follows: '0' },
    );
  });

  it.each([
    ['others', 'all'],
    ['from', 'no-es-una-sesion'],
    ['join', '0'],
    ['join', 'true'],
    ['match', ''],
    ['match', 'x'.repeat(101)],
    ['follows', 'si'],
  ])('rechaza %s=%s', (field, value) => {
    expect(ChannelStreamQuerySchema.safeParse({ ...base, [field]: value }).success).toBe(false);
  });
});

describe('visor y resumen de sesión', () => {
  const viewer = {
    client: 'ios',
    deviceId: 'dev_iphone01',
    lastBeatAt: '2026-09-23T18:30:00.000Z',
    viewerId: 'viewer_iphone01',
    deviceName: 'iPhone de Isma',
    platform: 'ios',
    playing: true,
  } as const;

  it('follows y away solo valen true (ausentes = no)', () => {
    expect(SessionViewerSchema.safeParse(viewer).success).toBe(true);
    expect(SessionViewerSchema.safeParse({ ...viewer, follows: true, away: true }).success).toBe(
      true,
    );
    expect(SessionViewerSchema.safeParse({ ...viewer, follows: false }).success).toBe(false);
    expect(SessionViewerSchema.safeParse({ ...viewer, away: false }).success).toBe(false);
  });

  it('matchId opcional en el resumen', () => {
    const summary = {
      id: SID,
      hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      mode: 'hls',
      openedAt: '2026-09-23T18:30:00.000Z',
      viewers: [viewer],
      title: 'DAZN 1',
      protocol: 'hls',
    } as const;
    expect(SessionSummarySchema.safeParse(summary).success).toBe(true);
    expect(SessionSummarySchema.safeParse({ ...summary, matchId: 'fltv-1' }).success).toBe(true);
    expect(SessionSummarySchema.safeParse({ ...summary, matchId: '' }).success).toBe(false);
  });
});

describe('playback.handoff', () => {
  const data = {
    sessionId: SID,
    viewerIds: ['viewer_tab01'],
    byDeviceId: 'dev_iphone01',
    byClient: 'ios',
    hash: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890',
    title: 'M+ LaLiga',
    reason: 'other_channel',
  } as const;

  it('sin los campos nuevos sigue valiendo', () => {
    expect(PlaybackHandoffEventSchema.safeParse({ type: 'playback.handoff', data }).success).toBe(
      true,
    );
  });

  it('con byDeviceName, follow y matchId', () => {
    const event = {
      type: 'playback.handoff',
      data: { ...data, byDeviceName: 'iPhone de Isma', follow: true, matchId: 'fltv-1' },
    };
    expect(PlaybackHandoffEventSchema.safeParse(event).success).toBe(true);
    const long = { type: 'playback.handoff', data: { ...data, byDeviceName: 'x'.repeat(81) } };
    expect(PlaybackHandoffEventSchema.safeParse(long).success).toBe(false);
  });
});

describe('bootstrap.features.multi y MULTI_TIMINGS', () => {
  it('features.multi es opcional', () => {
    const shape = BootstrapResponseSchema.shape.features;
    const features = { scanner: true, ai: false, demoSchedule: false };
    expect(shape.safeParse(features).success).toBe(true);
    expect(shape.safeParse({ ...features, multi: true }).success).toBe(true);
    expect(shape.safeParse({ ...features, multi: 'si' }).success).toBe(false);
  });

  it('away llega antes que la caducidad del visor y después de un latido perdido', () => {
    expect(MULTI_TIMINGS.viewerAwayMs).toBeGreaterThan(TIMEOUTS.viewerHeartbeatMs);
    expect(MULTI_TIMINGS.viewerAwayMs).toBeLessThan(TIMEOUTS.viewerExpiryMs);
  });
});
