import { BootstrapResponseSchema, LibraryViewSchema } from '@ace/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetMemoryStorage } from '../lib/storage.ts';
import { handleDemo, resetDemoState, shiftToToday } from './demo/index.ts';
import { registerDemoHandlers } from './demo-registry.ts';

beforeEach(() => {
  resetDemoState();
  resetMemoryStorage();
});
afterEach(() => resetDemoState());

const req = (extra: Record<string, unknown> = {}) =>
  ({ params: undefined, query: undefined, body: undefined, ...extra }) as never;

describe('modo demo', () => {
  it('el arranque es de la web, sin dispositivo, y cumple el contrato', async () => {
    const boot = await handleDemo('bootstrap', req());
    expect(BootstrapResponseSchema.safeParse(boot).success).toBe(true);
    expect(boot.origin).toBe('web');
    expect(boot.device).toBeNull();
    expect(boot.features.demoSchedule).toBe(true);
  });

  it('guardar un favorito se recuerda y sobrevive a recargar', async () => {
    const item = { id: 'C3D4E5F60718293A4B5C6D7E8F9012345678901A', title: 'Canal de muestra' };
    const library = await handleDemo(
      'libraryMutate',
      req({ body: { action: 'favorite-upsert', item } }),
    );
    expect(LibraryViewSchema.safeParse(library).success).toBe(true);
    expect(library.favorites[0]).toMatchObject({
      id: item.id.toLowerCase(),
      title: 'Canal de muestra',
      type: 'fav',
    });
    resetDemoState();
    const again = await handleDemo('libraryGet', req());
    expect(again.favorites[0]?.title).toBe('Canal de muestra');
    const afterDelete = await handleDemo(
      'libraryMutate',
      req({ body: { action: 'delete', collection: 'favorites', id: item.id } }),
    );
    expect(afterDelete.favorites.some((f) => f.id === item.id.toLowerCase())).toBe(false);
  });

  it('ajustes y dispositivos', async () => {
    const settings = await handleDemo(
      'settingsUpdate',
      req({ body: { sameChannelPolicy: 'handoff' } }),
    );
    expect(settings.settings.sameChannelPolicy).toBe('handoff');
    const { devices } = await handleDemo('devicesList', req());
    const revoked = await handleDemo('deviceRevoke', req({ params: { id: devices[0]?.id } }));
    expect(revoked.device.revokedAt).not.toBeNull();
  });

  it('sincronizar directorios no funciona en demo (igual que la 0.6.59)', async () => {
    await expect(
      handleDemo('directoriesSync', req({ body: { url: 'https://x' } })),
    ).rejects.toMatchObject({ code: 'demo_unsupported' });
  });

  it('una vista puede afinar una respuesta', async () => {
    const off = registerDemoHandlers({
      ping: () => ({
        ok: true,
        app: 'ace-player-neo',
        version: 'afinada',
        apiVersion: 1,
        serverTime: 0,
      }),
    });
    await expect(handleDemo('ping', req())).resolves.toMatchObject({ version: 'afinada' });
    off();
    await expect(handleDemo('ping', req())).resolves.toMatchObject({ version: '0.7.0' });
  });

  it('la agenda de ejemplo se mueve a hoy (fechas, claves y epoch)', () => {
    const now = Date.parse('2026-09-25T10:00:00Z');
    const moved = shiftToToday(
      {
        days: [
          {
            date: '2026-09-23',
            matches: [{ id: 'fltv-2026-09-23-3', start: Date.parse('2026-09-23T19:00:00Z') }],
          },
        ],
        scores: { 'fltv-2026-09-23-3': 1 },
      },
      now,
    );
    expect(moved.days[0]?.date).toBe('2026-09-25');
    expect(moved.days[0]?.matches[0]?.id).toBe('fltv-2026-09-25-3');
    expect(moved.days[0]?.matches[0]?.start).toBe(Date.parse('2026-09-25T19:00:00Z'));
    expect(Object.keys(moved.scores)).toEqual(['fltv-2026-09-25-3']);
  });
});
