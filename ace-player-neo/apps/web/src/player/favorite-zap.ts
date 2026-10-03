/* «Cambiar de canal rápido» entre FAVORITOS (0.8.4), como el mando de la tele.

   - Teclado: ↑ o Re Pág = favorito anterior; ↓ o Av Pág = favorito
     siguiente (index.tsx registra los atajos). ← → siguen siendo el zapping
     de siempre (favoritos + directorio, zapping.ts).
   - Táctil: deslizar en vertical sobre el vídeo (PlayerSurface.tsx).
   - La lista es la de favoritos de Canales (AceStream e IPTV) en su orden
     guardado; da la vuelta en los extremos. Si lo que suena no es un favorito,
     «siguiente» empieza por el primero y «anterior» por el último.
   - Varias pulsaciones seguidas se ACUMULAN: el cartel va enseñando el canal
     al que se llegaría y solo se abre el último cuando dejas de pulsar
     (`commitMs`). Abrir cada canal intermedio gastaría la única conexión de
     la IPTV (y arrancaría y pararía el motor para nada).
   - El cartel (nombre, «3/12», dorsal y origen) sale con la primera
     pulsación, va cambiando con las siguientes y se queda `bannerMs` con el
     canal ya abierto; luego se va solo.
   - En el centro de partido (sonando la fuente de un partido) también va por
     favoritos: es abrir otro canal, como tocarlo en Canales (una sola
     reproducción a la vez: el canal nuevo sustituye al partido).

   Aquí solo está la lógica (pura y con temporizadores inyectables, para los
   tests con relojes falsos); el cartel lo pinta PlayerSurface.tsx con
   `useZapBanner()` y quien abre el canal es index.tsx. */

import { createStore, useStore } from '../lib/store.ts';

export interface FavoriteChannel {
  id: string;
  title: string;
  /** true si el id es un infohash. */
  ih: boolean;
  /** Es un canal de tu IPTV (`iptvIds` de la biblioteca): nunca va directo al motor. */
  iptv: boolean;
  /** El nombre en tu IPTV de un id IPTV renombrado (§14.6). */
  alias?: string;
  category?: string;
}

interface LibraryLike {
  favorites?: ReadonlyArray<{
    id: string;
    title: string;
    ih?: boolean;
    alias?: string;
    category?: string;
  }>;
  iptvIds?: Readonly<Record<string, unknown>>;
}

/** Los favoritos en su orden guardado, sin repetidos. */
export function favoriteZapList(library: LibraryLike | null | undefined): FavoriteChannel[] {
  if (!library?.favorites) return [];
  const iptvIds = library.iptvIds ?? {};
  const seen = new Set<string>();
  const out: FavoriteChannel[] = [];
  for (const item of library.favorites) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const iptv = Object.hasOwn(iptvIds, item.id);
    out.push({
      id: item.id,
      title: item.title || 'Canal sin nombre',
      ih: iptv ? false : Boolean(item.ih),
      iptv,
      ...(item.alias ? { alias: item.alias } : {}),
      ...(item.category ? { category: item.category } : {}),
    });
  }
  return out;
}

/**
 * La posición a la que se llega desde `from` (índice en la lista, o -1 si lo
 * que suena no es un favorito): da la vuelta en los extremos y, desde fuera
 * de la lista, ↓ va al primero y ↑ al último.
 */
export function favoriteStep(length: number, from: number, direction: 1 | -1): number {
  if (length <= 0) return -1;
  if (from < 0 || from >= length) return direction === 1 ? 0 : length - 1;
  return (from + direction + length) % length;
}

// ---- El cartel ----------------------------------------------------------------

export interface ZapBanner {
  channel: FavoriteChannel;
  /** Posición 1…total en los favoritos. */
  position: number;
  total: number;
  /** Ya se ha abierto (dejó de pulsarse) o aún se está eligiendo. */
  committed: boolean;
  /** Cambia en cada pulsación: la animación vuelve a empezar. */
  seq: number;
}

export const zapBannerStore = createStore<ZapBanner | null>(null);

export function useZapBanner(): ZapBanner | null {
  return useStore(zapBannerStore);
}

// ---- El zapeador ----------------------------------------------------------------

/** Tras la última pulsación, lo que se espera antes de abrir el canal. */
export const ZAP_COMMIT_MS = 650;
/** Lo que se queda el cartel a la vista tras la última pulsación. */
export const ZAP_BANNER_MS = 2000;

interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface FavoriteZapperOptions {
  /** El canal que suena ahora (su hash), o null. */
  current(): string | null;
  /** Abre el canal elegido (solo el último de una ráfaga, y nunca el que ya suena). */
  open(channel: FavoriteChannel, position: number, total: number): void;
  commitMs?: number;
  bannerMs?: number;
  timers?: Timers;
  banner?: typeof zapBannerStore;
}

export class FavoriteZapper {
  private pending: { index: number; list: readonly FavoriteChannel[] } | null = null;
  private commitTimer: unknown = null;
  private bannerTimer: unknown = null;
  private seq = 0;
  private readonly timers: Timers;
  private readonly banner: typeof zapBannerStore;
  private readonly commitMs: number;
  private readonly bannerMs: number;

  constructor(private readonly options: FavoriteZapperOptions) {
    this.timers = options.timers ?? realTimers;
    this.banner = options.banner ?? zapBannerStore;
    this.commitMs = options.commitMs ?? ZAP_COMMIT_MS;
    this.bannerMs = options.bannerMs ?? ZAP_BANNER_MS;
  }

  /**
   * Una pulsación (↑ ↓, Re Pág / Av Pág o un deslizamiento). Devuelve el canal
   * al que se llegaría, o null si no hay favoritos.
   */
  press(direction: 1 | -1, list: readonly FavoriteChannel[]): FavoriteChannel | null {
    if (!list.length) return null;
    const currentId = this.options.current();
    // En mitad de una ráfaga se sigue desde lo elegido (si la lista no cambió).
    const from =
      this.pending && this.pending.list === list
        ? this.pending.index
        : currentId
          ? list.findIndex((item) => item.id === currentId)
          : -1;
    const index = favoriteStep(list.length, from, direction);
    const channel = list[index];
    if (!channel) return null;
    this.pending = { index, list };
    this.show(channel, index, list.length, false);
    if (this.commitTimer !== null) this.timers.clear(this.commitTimer);
    this.commitTimer = this.timers.set(() => this.commit(), this.commitMs);
    return channel;
  }

  /** Se dejó de pulsar: se abre lo elegido. */
  private commit(): void {
    this.commitTimer = null;
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    const channel = pending.list[pending.index];
    if (!channel) return;
    this.show(channel, pending.index, pending.list.length, true);
    // Volver al que ya suena (dar la vuelta entera) no reinicia nada.
    if (channel.id === this.options.current()) return;
    this.options.open(channel, pending.index + 1, pending.list.length);
  }

  private show(channel: FavoriteChannel, index: number, total: number, committed: boolean): void {
    this.seq += 1;
    this.banner.set({ channel, position: index + 1, total, committed, seq: this.seq });
    if (this.bannerTimer !== null) this.timers.clear(this.bannerTimer);
    this.bannerTimer = this.timers.set(() => {
      this.bannerTimer = null;
      this.banner.set(null);
    }, this.bannerMs);
  }

  /** ¿Hay una ráfaga a medias? */
  get busy(): boolean {
    return this.pending !== null;
  }

  /** Olvida la ráfaga y quita el cartel (al desmontar o al detener). */
  cancel(): void {
    if (this.commitTimer !== null) this.timers.clear(this.commitTimer);
    if (this.bannerTimer !== null) this.timers.clear(this.bannerTimer);
    this.commitTimer = null;
    this.bannerTimer = null;
    this.pending = null;
    this.banner.set(null);
  }
}

// ---- ¿Las flechas verticales son del zapping? -------------------------------------

/** Lo que usa ↑ ↓ (o Re Pág / Av Pág) por sí mismo: ahí no se zapea. */
const VERTICAL_BUSY =
  'input, select, textarea, [contenteditable="true"], [role="slider"], [role="tablist"], [role="radiogroup"], [role="listbox"], [role="option"], [role="menu"], [role="menuitem"], [role="spinbutton"], [role="grid"], [role="tree"]';

/**
 * ↑ ↓ desplazan la página: solo son del zapping si el foco no está en otra
 * cosa. A pantalla completa (o en modo teatro) siempre; si no, solo con el
 * foco en el reproductor o en ninguna parte (el <body>): con el foco en una
 * lista o en un enlace de la página, las flechas siguen desplazando.
 */
export function verticalKeysForZap(
  root: HTMLElement | null,
  immersive: boolean,
  active: Element | null = typeof document === 'undefined' ? null : document.activeElement,
): boolean {
  if (active instanceof HTMLElement && active.closest(VERTICAL_BUSY)) return false;
  if (immersive) return true;
  if (!active || active === document.body || active === document.documentElement) return true;
  return Boolean(root && root.contains(active));
}
