import { DeviceIdSchema, ViewerIdSchema } from '@ace/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetMemoryStorage } from '../lib/storage.ts';
import { getDeviceId, getViewerId, isForThisViewer, resetIdentity } from './identity.ts';

beforeEach(() => {
  resetIdentity();
  resetMemoryStorage();
});

describe('identidad', () => {
  it('el dispositivo es persistente y cumple el esquema', () => {
    const first = getDeviceId();
    expect(DeviceIdSchema.safeParse(first).success).toBe(true);
    expect(localStorage.getItem('aceneo-device')).toBe(first);
    resetIdentity();
    expect(getDeviceId()).toBe(first);
  });

  it('respeta un id guardado válido e ignora uno roto', () => {
    localStorage.setItem('aceneo-device', 'web_salon01');
    expect(getDeviceId()).toBe('web_salon01');
    resetIdentity();
    resetMemoryStorage();
    localStorage.setItem('aceneo-device', 'con.punto');
    expect(getDeviceId()).not.toBe('con.punto');
  });

  it('el visor es de esta pestaña y NO se guarda (P12)', () => {
    const viewer = getViewerId();
    expect(ViewerIdSchema.safeParse(viewer).success).toBe(true);
    expect(getViewerId()).toBe(viewer);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(viewer);
    resetIdentity();
    expect(getViewerId()).not.toBe(viewer);
  });

  it('filtra los eventos dirigidos a otros visores', () => {
    const viewer = getViewerId();
    expect(isForThisViewer([viewer, 'otro_1'])).toBe(true);
    expect(isForThisViewer(['otro_1'])).toBe(false);
    expect(isForThisViewer(undefined)).toBe(true);
  });
});
