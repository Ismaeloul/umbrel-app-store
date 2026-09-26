/* Ajustes → IPTV, reglas puras (docs/iptv.md §1): validación, cuerpo sin
   secretos vacíos, la regla de seguridad del origen y las líneas de la tarjeta. */

import { errorMessage, type IptvProviderView } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors.ts';
import {
  accountLine,
  capsuleOf,
  editForm,
  EMPTY_FORM,
  guideLine,
  hostLine,
  IPTV_DEMO_MESSAGE,
  iptvErrorMessage,
  metaLine,
  needsSecrets,
  staleLine,
  syncedText,
  syncingText,
  validateForm,
} from './model.ts';

const saved: IptvProviderView = {
  kind: 'xtream',
  name: 'Casa',
  enabled: true,
  host: 'proveedor.example:8080',
  origin: 'http://proveedor.example:8080',
  hasUrl: false,
  hasUsername: true,
  hasPassword: true,
  status: 'ok',
  channels: 812,
  updatedAt: '2026-09-26T18:30:00.000Z',
  error: null,
  staleSince: null,
  account: {
    status: 'active',
    expiresAt: '2026-12-03T00:00:00.000Z',
    maxConnections: 1,
    activeConnections: 0,
    ours: 0,
  },
  guide: {
    available: true,
    channelsWithGuide: 640,
    updatedAt: '2026-09-26T12:00:00.000Z',
    failedAt: null,
  },
};

describe('formulario', () => {
  it('M3U nueva: dirección obligatoria y http(s); el nombre es opcional', () => {
    expect(validateForm({ ...EMPTY_FORM, kind: 'm3u' }, null)).toEqual({
      ok: false,
      errors: { url: 'Escribe la dirección de la lista' },
      first: 'url',
    });
    expect(validateForm({ ...EMPTY_FORM, url: 'ftp://x/lista.m3u' }, null)).toMatchObject({
      ok: false,
      errors: { url: errorMessage('bad_url') },
    });
    expect(
      validateForm({ ...EMPTY_FORM, url: '  https://listas.example/lista.m3u  ' }, null),
    ).toEqual({ ok: true, body: { kind: 'm3u', url: 'https://listas.example/lista.m3u' } });
    expect(
      validateForm({ ...EMPTY_FORM, name: ' Casa ', url: 'https://x.example/l.m3u' }, null),
    ).toEqual({ ok: true, body: { kind: 'm3u', name: 'Casa', url: 'https://x.example/l.m3u' } });
  });

  it('Xtream nueva: servidor, usuario y contraseña, en ese orden', () => {
    const form = { ...EMPTY_FORM, kind: 'xtream' as const };
    expect(validateForm(form, null)).toMatchObject({
      ok: false,
      first: 'server',
      errors: {
        server: 'Escribe el servidor',
        username: 'Escribe el usuario',
        password: 'Escribe la contraseña',
      },
    });
    expect(
      validateForm(
        { ...form, server: 'http://proveedor.example:8080', username: 'u', password: ' p ' },
        null,
      ),
    ).toEqual({
      ok: true,
      // La contraseña no se recorta: puede llevar espacios a propósito.
      body: {
        kind: 'xtream',
        server: 'http://proveedor.example:8080',
        username: 'u',
        password: ' p ',
      },
    });
  });

  it('cambiar datos: los secretos llegan vacíos y, si no se escriben, NO se mandan', () => {
    const form = editForm(saved);
    expect(form).toEqual({
      kind: 'xtream',
      name: 'Casa',
      url: '',
      server: 'http://proveedor.example:8080',
      username: '',
      password: '',
    });
    expect(validateForm({ ...form, name: 'Salón' }, saved)).toEqual({
      ok: true,
      body: { kind: 'xtream', name: 'Salón', server: 'http://proveedor.example:8080' },
    });
  });

  it('otro origen u otro tipo exigen los secretos otra vez (§1.4)', () => {
    expect(needsSecrets({ kind: 'xtream', server: 'http://proveedor.example:8080' }, saved)).toBe(
      false,
    );
    expect(
      needsSecrets({ kind: 'xtream', server: 'HTTP://Proveedor.Example:8080/ruta' }, saved),
    ).toBe(false);
    expect(needsSecrets({ kind: 'xtream', server: 'http://otro.example:8080' }, saved)).toBe(true);
    expect(needsSecrets({ kind: 'xtream', server: 'https://proveedor.example:8080' }, saved)).toBe(
      true,
    );
    expect(needsSecrets({ kind: 'm3u', server: '' }, saved)).toBe(true);
    expect(needsSecrets({ kind: 'm3u', server: '' }, null)).toBe(true);
    const otherServer = { ...editForm(saved), server: 'http://otro.example:8080' };
    expect(validateForm(otherServer, saved)).toMatchObject({
      ok: false,
      first: 'username',
    });
  });

  it('errores: el catálogo, la demo y un fallo desconocido', () => {
    expect(iptvErrorMessage(new ApiError({ code: 'iptv_auth_failed', status: 502 }))).toBe(
      'Tu proveedor de IPTV no acepta ese usuario y contraseña.',
    );
    expect(iptvErrorMessage(new ApiError({ code: 'demo_unsupported', status: 409 }))).toBe(
      IPTV_DEMO_MESSAGE,
    );
    expect(iptvErrorMessage(new Error('x'))).toBe(
      'No se pudo guardar la IPTV. Inténtalo de nuevo.',
    );
  });
});

describe('tarjeta', () => {
  it('textos del estado de la línea', () => {
    expect(syncingText('Casa')).toBe('Conexión correcta. Descargando los canales de «Casa»…');
    expect(syncedText('Casa', 812, 6)).toBe('«Casa»: 812 canales. Se actualiza sola cada 6 h.');
  });

  it('cápsula: Activa, En pausa o Con fallos', () => {
    expect(capsuleOf(saved)).toEqual({ tone: 'ok', text: 'Activa' });
    expect(capsuleOf({ ...saved, enabled: false, status: 'disabled' })).toEqual({
      tone: 'neutral',
      text: 'En pausa',
    });
    expect(capsuleOf({ ...saved, staleSince: '2026-09-26T18:30:00.000Z' })).toEqual({
      tone: 'weak',
      text: 'Con fallos',
    });
  });

  it('meta y host sin credenciales', () => {
    expect(metaLine(saved)).toMatch(/^Xtream · 812 canales · actualizada 26 sept/);
    expect(metaLine({ ...saved, kind: 'm3u', updatedAt: null, channels: 1 })).toBe(
      'M3U · 1 canal · sin sincronizar',
    );
    expect(hostLine(saved)).toBe('proveedor.example:8080 · usuario y contraseña guardados');
    expect(hostLine({ ...saved, kind: 'm3u', host: 'proveedor.example', hasUrl: true })).toBe(
      'proveedor.example · dirección guardada',
    );
  });

  it('cuenta: caducada, conexiones en uso fuera (sin contar las nuestras) o hasta cuándo', () => {
    expect(accountLine(saved.account)).toEqual({
      text: 'Cuenta activa hasta el 3 dic · 1 conexión a la vez',
      tone: 'plain',
    });
    expect(accountLine({ ...saved.account!, status: 'expired' })).toEqual({
      text: 'La cuenta de tu IPTV ha caducado o está desactivada.',
      tone: 'err',
    });
    expect(accountLine({ ...saved.account!, activeConnections: 1, ours: 0 })).toEqual({
      text: 'Tu cuenta tiene todas sus conexiones en uso fuera de Ace Player.',
      tone: 'weak',
    });
    // La que está abierta es la nuestra: no es «de otro».
    expect(accountLine({ ...saved.account!, activeConnections: 1, ours: 1 })?.tone).toBe('plain');
    expect(accountLine(null)).toBeNull();
  });

  it('copia anterior tras un fallo, con el motivo del catálogo', () => {
    expect(
      staleLine({
        ...saved,
        staleSince: '2026-09-26T18:30:00.000Z',
        error: { code: 'iptv_unreachable', message: 'Tu proveedor de IPTV no responde.' },
      })?.text,
    ).toMatch(
      /^No se pudo actualizar: tu proveedor de IPTV no responde\. Se conserva la copia del 26 sept/,
    );
    expect(staleLine(saved)).toBeNull();
  });

  it('guía: la línea solo si la hay; si falló, la copia que se usa', () => {
    expect(guideLine(saved.guide)).toMatch(
      /^Guía: 640 canales con programación · actualizada 26 sept/,
    );
    expect(guideLine({ ...saved.guide, failedAt: '2026-09-26T20:00:00.000Z' })).toMatch(
      /^Guía: no se pudo actualizar; se usa la del 26 sept/,
    );
    expect(
      guideLine({ available: false, channelsWithGuide: 0, updatedAt: null, failedAt: null }),
    ).toBeNull();
  });
});
