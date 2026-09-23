/* Pantalla completa e imagen dentro de imagen (inventario §8.5, B-093, B-102).

   Pantalla completa: se pone a pantalla completa TODA la página y el
   reproductor pasa a «inmersivo» (el armazón lo pega a los bordes, como el
   móvil en horizontal). Así los menús y avisos del reproductor, que viven
   fuera del vídeo, se siguen viendo; con la pantalla completa de un solo
   elemento quedarían fuera. En iPhone no hay API de página: se usa la del
   propio vídeo (`webkitEnterFullscreen`), con los controles del sistema.
   Sin ninguna, se avisa y los botones no se enseñan. */

import { useEffect, useState, type RefObject } from 'react';

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
  pictureInPictureElement?: Element | null;
  pictureInPictureEnabled?: boolean;
  exitPictureInPicture?: () => Promise<void>;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export type VideoWithExtras = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
};

export type ScreenResult = 'entered' | 'exited' | 'not-ready' | 'unavailable' | 'failed';

function doc(): FullscreenDocument {
  return document as FullscreenDocument;
}

export function isPageFullscreen(): boolean {
  const d = doc();
  return Boolean(d.fullscreenElement ?? d.webkitFullscreenElement);
}

export function canFullscreen(video: VideoWithExtras | null): boolean {
  const d = doc();
  const root = document.documentElement as FullscreenElement;
  return Boolean(
    (d.fullscreenEnabled && typeof root.requestFullscreen === 'function') ||
    (d.webkitFullscreenEnabled && typeof root.webkitRequestFullscreen === 'function') ||
    typeof video?.webkitEnterFullscreen === 'function',
  );
}

export async function toggleFullscreen(video: VideoWithExtras | null): Promise<ScreenResult> {
  const d = doc();
  try {
    if (isPageFullscreen()) {
      if (typeof d.exitFullscreen === 'function') await d.exitFullscreen();
      else await d.webkitExitFullscreen?.();
      return 'exited';
    }
    const root = document.documentElement as FullscreenElement;
    if (d.fullscreenEnabled && typeof root.requestFullscreen === 'function') {
      await root.requestFullscreen({ navigationUI: 'hide' });
      return 'entered';
    }
    if (d.webkitFullscreenEnabled && typeof root.webkitRequestFullscreen === 'function') {
      await root.webkitRequestFullscreen();
      return 'entered';
    }
    if (video && typeof video.webkitEnterFullscreen === 'function') {
      // iPhone: solo con imagen (si no, Safari lo ignora o lanza).
      if (video.readyState === 0) return 'not-ready';
      video.webkitEnterFullscreen();
      return 'entered';
    }
    return 'unavailable';
  } catch {
    return 'failed';
  }
}

export function canPictureInPicture(video: VideoWithExtras | null): boolean {
  if (!video) return false;
  const d = doc();
  if (d.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') return true;
  try {
    return Boolean(video.webkitSupportsPresentationMode?.('picture-in-picture'));
  } catch {
    return false;
  }
}

export async function togglePictureInPicture(video: VideoWithExtras | null): Promise<ScreenResult> {
  if (!video) return 'unavailable';
  const d = doc();
  try {
    if (d.pictureInPictureElement) {
      await d.exitPictureInPicture?.();
      return 'exited';
    }
    if (video.webkitPresentationMode === 'picture-in-picture') {
      video.webkitSetPresentationMode?.('inline');
      return 'exited';
    }
    if (!canPictureInPicture(video)) return 'unavailable';
    if (video.readyState === 0) return 'not-ready';
    if (d.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') {
      await video.requestPictureInPicture();
    } else {
      video.webkitSetPresentationMode?.('picture-in-picture');
    }
    return 'entered';
  } catch {
    return 'failed';
  }
}

/** Pantalla completa y PiP en vivo (también cuando se sale con Escape o desde el sistema). */
export function useScreenModes(videoRef: RefObject<HTMLVideoElement | null>): {
  fullscreen: boolean;
  pip: boolean;
} {
  const [fullscreen, setFullscreen] = useState(false);
  const [pip, setPip] = useState(false);
  useEffect(() => {
    const video = videoRef.current as VideoWithExtras | null;
    const onFullscreen = () =>
      setFullscreen(isPageFullscreen() || Boolean(video?.webkitDisplayingFullscreen));
    const onEnterPip = () => setPip(true);
    const onLeavePip = () => setPip(false);
    const onPresentation = () => setPip(video?.webkitPresentationMode === 'picture-in-picture');
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('webkitfullscreenchange', onFullscreen);
    video?.addEventListener('webkitbeginfullscreen', onFullscreen);
    video?.addEventListener('webkitendfullscreen', onFullscreen);
    video?.addEventListener('enterpictureinpicture', onEnterPip);
    video?.addEventListener('leavepictureinpicture', onLeavePip);
    video?.addEventListener('webkitpresentationmodechanged', onPresentation);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('webkitfullscreenchange', onFullscreen);
      video?.removeEventListener('webkitbeginfullscreen', onFullscreen);
      video?.removeEventListener('webkitendfullscreen', onFullscreen);
      video?.removeEventListener('enterpictureinpicture', onEnterPip);
      video?.removeEventListener('leavepictureinpicture', onLeavePip);
      video?.removeEventListener('webkitpresentationmodechanged', onPresentation);
    };
  }, [videoRef]);
  return { fullscreen, pip };
}
