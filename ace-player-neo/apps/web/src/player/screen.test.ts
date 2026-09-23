/* Pantalla completa e imagen dentro de imagen (inventario §8.5, B-093, B-102
   y §21 iOS): qué API se usa en cada navegador y qué pasa cuando no hay
   ninguna. jsdom no trae ninguna de las dos: cada test pone la suya. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canFullscreen,
  canPictureInPicture,
  toggleFullscreen,
  togglePictureInPicture,
  type VideoWithExtras,
} from './screen.ts';

type Writable = Record<string, unknown>;
const doc = document as unknown as Writable;
const root = document.documentElement as unknown as Writable;
const DOC_KEYS = [
  'fullscreenEnabled',
  'fullscreenElement',
  'exitFullscreen',
  'webkitFullscreenEnabled',
  'webkitFullscreenElement',
  'webkitExitFullscreen',
  'pictureInPictureEnabled',
  'pictureInPictureElement',
  'exitPictureInPicture',
];
const ROOT_KEYS = ['requestFullscreen', 'webkitRequestFullscreen'];

function define(target: Writable, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
}

function video(extra: Partial<VideoWithExtras> & { readyState?: number } = {}): VideoWithExtras {
  const el = document.createElement('video') as VideoWithExtras;
  const { readyState, ...rest } = extra;
  if (readyState !== undefined) Object.defineProperty(el, 'readyState', { value: readyState });
  Object.assign(el, rest);
  return el;
}

afterEach(() => {
  for (const key of DOC_KEYS) delete doc[key];
  for (const key of ROOT_KEYS) delete root[key];
});

describe('pantalla completa (B-102)', () => {
  it('escritorio y Android: la página entera a pantalla completa; si ya lo está, sale', async () => {
    const request = vi.fn(async () => {});
    const exit = vi.fn(async () => {});
    define(doc, 'fullscreenEnabled', true);
    define(root, 'requestFullscreen', request);
    define(doc, 'exitFullscreen', exit);
    expect(canFullscreen(null)).toBe(true);
    expect(await toggleFullscreen(video())).toBe('entered');
    expect(request).toHaveBeenCalledWith({ navigationUI: 'hide' });
    define(doc, 'fullscreenElement', document.documentElement);
    expect(await toggleFullscreen(video())).toBe('exited');
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('Safari de iPad/Mac con el prefijo webkit', async () => {
    const request = vi.fn();
    define(doc, 'webkitFullscreenEnabled', true);
    define(root, 'webkitRequestFullscreen', request);
    expect(await toggleFullscreen(video())).toBe('entered');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('iPhone: la del propio vídeo (webkitEnterFullscreen), y solo cuando ya hay imagen', async () => {
    const enter = vi.fn();
    const sinImagen = video({ webkitEnterFullscreen: enter, readyState: 0 });
    expect(canFullscreen(sinImagen)).toBe(true);
    // «La pantalla completa estará disponible cuando arranque la imagen».
    expect(await toggleFullscreen(sinImagen)).toBe('not-ready');
    expect(enter).not.toHaveBeenCalled();
    expect(await toggleFullscreen(video({ webkitEnterFullscreen: enter, readyState: 3 }))).toBe(
      'entered',
    );
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it('sin ninguna API: no se ofrece (el botón no se pinta) y, si se pide con F, se avisa', async () => {
    expect(canFullscreen(video())).toBe(false);
    // index.tsx traduce «unavailable» a «Este navegador no permite la pantalla completa aquí».
    expect(await toggleFullscreen(video())).toBe('unavailable');
  });

  it('si el navegador lo rechaza (sin gesto del usuario), no revienta', async () => {
    define(doc, 'fullscreenEnabled', true);
    define(
      root,
      'requestFullscreen',
      vi.fn(async () => Promise.reject(new Error('Permissions check failed'))),
    );
    expect(await toggleFullscreen(video())).toBe('failed');
  });
});

describe('imagen dentro de imagen (B-093)', () => {
  it('con la API estándar entra y, si ya está, sale', async () => {
    const el = video({ readyState: 3 });
    const request = vi.fn(async () => ({}) as PictureInPictureWindow);
    define(el as unknown as Writable, 'requestPictureInPicture', request);
    define(doc, 'pictureInPictureEnabled', true);
    define(
      doc,
      'exitPictureInPicture',
      vi.fn(async () => {}),
    );
    expect(canPictureInPicture(el)).toBe(true);
    expect(await togglePictureInPicture(el)).toBe('entered');
    expect(request).toHaveBeenCalledTimes(1);
    define(doc, 'pictureInPictureElement', el);
    expect(await togglePictureInPicture(el)).toBe('exited');
  });

  it('Safari de iPhone: modo de presentación de WebKit', async () => {
    const set = vi.fn();
    const el = video({
      readyState: 3,
      webkitSupportsPresentationMode: (mode: string) => mode === 'picture-in-picture',
      webkitSetPresentationMode: set,
    });
    expect(canPictureInPicture(el)).toBe(true);
    expect(await togglePictureInPicture(el)).toBe('entered');
    expect(set).toHaveBeenCalledWith('picture-in-picture');
  });

  it('sin imagen todavía, «not-ready»; sin API, «unavailable» (y el botón no se pinta)', async () => {
    const el = video({ readyState: 0 });
    define(el as unknown as Writable, 'requestPictureInPicture', vi.fn());
    define(doc, 'pictureInPictureEnabled', true);
    expect(await togglePictureInPicture(el)).toBe('not-ready');
    delete doc.pictureInPictureEnabled;
    const sinApi = video({ readyState: 3 });
    expect(canPictureInPicture(sinApi)).toBe(false);
    expect(await togglePictureInPicture(sinApi)).toBe('unavailable');
    expect(await togglePictureInPicture(null)).toBe('unavailable');
  });
});
