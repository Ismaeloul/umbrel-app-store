/* «Cambio automático si se cae» de una sala en directo (docs/ver-juntos.md §14),
   decidido en el servidor.

   Antes lo decidía el navegador de quien controlaba, con su propia lista: sin
   nadie que controlase con la página abierta no saltaba nadie, el chat nunca
   decía «Se ha caído la fuente» y la siguiente era «la primera que no se ha
   probado», sin mirar si estaba verificada. Ahora, con la misma política que
   la ficha del partido (sources/model.ts: `pickNextIptvVariant`,
   `pickBridgeTarget`, `pickAutoSource`):

   - cae una IPTV → la siguiente variante del MISMO canal IPTV (misma clave y
     mismo país); si no hay, la mejor AceStream verificada (y, sin ninguna,
     una floja);
   - cae una AceStream → la primera IPTV (no el gemelo de otro país); si no
     hay, la mejor AceStream verificada y luego una floja;
   - nunca una reportada, en cuarentena, ya probada en esta racha o con el
     último veredicto «Sin señal»;
   - nunca una IPTV que le quite la plaza a otro aparato de casa (como
     `takesFromOther` en la ficha): si solo queda esa, la AceStream o el aviso.

   Con freno: como mucho `AUTO_MAX_JUMPS` saltos seguidos sin que ninguna suene
   y uno cada `AUTO_GAP_MS`. Con el motor caído, todas fallan igual: saltar no
   arregla nada. Tras un «Poner» a mano, `AUTO_MANUAL_GRACE_MS` de margen. La
   racha se acaba cuando la fuente nueva suena `AUTO_SOUNDED_MS` seguidos (o a
   los `AUTO_STREAK_RESET_MS` sin saltos). */

import type { PartyLiveChoice, ResolutionCandidate, VerdictState } from '@ace/shared';

export const AUTO_MAX_JUMPS = 3;
export const AUTO_GAP_MS = 30_000;
/** Tras un cambio a mano, el automático espera esto (o a que la nueva suene). */
export const AUTO_MANUAL_GRACE_MS = 45_000;

const HASH_RE = /^[a-f0-9]{40}$/;

const IPTV_QUALITY: Readonly<Record<string, string>> = {
  uhd: '4K',
  fhd: '1080p',
  hd: '720p',
  sd: 'SD',
};

/** La racha del automático en una sala. */
export interface AutoStreak {
  /** Hashes ya probados en esta racha (el que se cayó incluido). */
  readonly tried: Set<string>;
  jumps: number;
  lastJumpAt: number;
  /** Hasta cuándo no actúa (tras un «Poner» a mano). */
  graceUntil: number;
  /** Desde cuándo suena la fuente de después del salto (null: aún no, o se ha vuelto a caer). */
  soundSince: number | null;
  /** Sin otra buena y con el comprobador en marcha: hasta cuándo se le espera. */
  scanWaitUntil: number | null;
}

export function newStreak(): AutoStreak {
  return {
    tried: new Set(),
    jumps: 0,
    lastJumpAt: Number.NEGATIVE_INFINITY,
    graceUntil: Number.NEGATIVE_INFINITY,
    soundSince: null,
    scanWaitUntil: null,
  };
}

export type AutoDecision =
  | { readonly kind: 'switch'; readonly choice: PartyLiveChoice }
  | { readonly kind: 'wait'; readonly ms: number }
  | { readonly kind: 'none'; readonly reason: 'grace' | 'limit' | 'no_source' | 'iptv_busy' };

/**
 * Lo de casa que importa al automático: el canal que OTRO aparato ve por la IPTV (la única
 * plaza), o null. Abrir otra IPTV se la quitaría; la misma se comparte.
 */
export interface AutoHouse {
  readonly busyIptv: string | null;
}

export const FREE_HOUSE: AutoHouse = { busyIptv: null };

function isIptv(candidate: Pick<ResolutionCandidate, 'source'>): boolean {
  return candidate.source === 'iptv';
}

function quarantined(candidate: ResolutionCandidate, now: number): boolean {
  if (candidate.quarantined) return true;
  const until = Date.parse(candidate.reported?.quarantineUntil ?? '');
  return Number.isFinite(until) && until > now;
}

/** «Elcano --> DAZN 1» → «Elcano»: el título sin el proveedor de detrás de la flecha. */
function channelPart(title: string): string {
  return title.replace(/\s*(?:--?>|={1,2}>|[→⇒➜➝⟶⟹]).*$/, '').trim();
}

function iptvKey(candidate: ResolutionCandidate): string {
  return (
    candidate.iptv?.channel ||
    channelPart(candidate.title).toLocaleLowerCase('es').replace(/\s+/g, ' ')
  );
}

/** Dos IPTV del mismo canal y país: variantes (1080p, 720p, reserva…). */
function sameIptvChannel(a: ResolutionCandidate, b: ResolutionCandidate): boolean {
  return (
    isIptv(a) &&
    isIptv(b) &&
    iptvKey(a) === iptvKey(b) &&
    (a.iptv?.country ?? null) === (b.iptv?.country ?? null)
  );
}

/** «DE: DAZN 1» junto a «DAZN 1»: otro canal, que lo automático no elige (§17). */
function isForeignTwin(
  candidate: ResolutionCandidate,
  all: readonly ResolutionCandidate[],
): boolean {
  if (!isIptv(candidate) || !candidate.iptv?.country) return false;
  const key = iptvKey(candidate);
  return all.some((other) => isIptv(other) && !other.iptv?.country && iptvKey(other) === key);
}

/** Lo que va a la sala para una candidata (como `liveSourceOf` en la web). */
export function choiceOf(
  candidate: ResolutionCandidate,
  room: Pick<PartyLiveChoice, 'matchId' | 'match'>,
): PartyLiveChoice {
  const name = channelPart(candidate.title) || candidate.matchedChannel || 'Canal';
  const quality = candidate.iptv?.quality ? (IPTV_QUALITY[candidate.iptv.quality] ?? null) : null;
  return {
    hash: candidate.id.toLowerCase(),
    channel: (quality ? `${name} · ${quality}` : name).slice(0, 120),
    source: isIptv(candidate) ? 'iptv' : 'engine',
    matchId: room.matchId,
    match: room.match,
  };
}

/**
 * La siguiente fuente buena tras caerse `failed` (sin freno: eso lo pone `decide`).
 * `verdictOf` da el último veredicto vigente del comprobador o del reproductor.
 */
export function pickLiveFallback(
  candidates: readonly ResolutionCandidate[],
  failed: Pick<PartyLiveChoice, 'hash' | 'source'>,
  verdictOf: (hash: string) => VerdictState | null,
  tried: ReadonlySet<string>,
  now: number,
  house: AutoHouse = FREE_HOUSE,
): ResolutionCandidate | null {
  const failedCandidate = candidates.find((candidate) => candidate.id === failed.hash);
  const pool = candidates.filter(
    (candidate) =>
      HASH_RE.test(candidate.id) &&
      candidate.id !== failed.hash &&
      !tried.has(candidate.id) &&
      !quarantined(candidate, now) &&
      verdictOf(candidate.id) !== 'failed' &&
      !takesIptvFromOther(candidate, house),
  );
  const engine = pool.filter((candidate) => !isIptv(candidate));
  const bestEngine = (): ResolutionCandidate | null =>
    engine.find((candidate) => verdictOf(candidate.id) === 'working') ??
    engine.find((candidate) => verdictOf(candidate.id) === 'weak') ??
    null;
  if (failed.source === 'iptv') {
    /* Primero otra variante del mismo canal IPTV; luego el puente a AceStream. */
    const variant = failedCandidate
      ? pool.find((candidate) => sameIptvChannel(candidate, failedCandidate))
      : undefined;
    return variant ?? bestEngine();
  }
  /* Cae una AceStream: la IPTV (abrir es la prueba; no espera a «Verificada»). */
  const iptv = pool.find((candidate) => isIptv(candidate) && !isForeignTwin(candidate, candidates));
  return iptv ?? bestEngine();
}

/** ¿Abrirla le quitaría la plaza IPTV a otro aparato? El mismo canal no: se comparte. */
function takesIptvFromOther(candidate: ResolutionCandidate, house: AutoHouse): boolean {
  return (
    isIptv(candidate) && house.busyIptv !== null && house.busyIptv !== candidate.id.toLowerCase()
  );
}

/** ¿Salta ya, espera al hueco entre saltos o no hace nada? Anota el salto en la racha. */
export function decide(
  streak: AutoStreak,
  candidates: readonly ResolutionCandidate[],
  current: Pick<PartyLiveChoice, 'hash' | 'source' | 'matchId' | 'match'>,
  verdictOf: (hash: string) => VerdictState | null,
  now: number,
  house: AutoHouse = FREE_HOUSE,
): AutoDecision {
  if (now < streak.graceUntil) return { kind: 'none', reason: 'grace' };
  if (streak.jumps >= AUTO_MAX_JUMPS) return { kind: 'none', reason: 'limit' };
  const wait = AUTO_GAP_MS - (now - streak.lastJumpAt);
  if (wait > 0) return { kind: 'wait', ms: wait };
  streak.tried.add(current.hash);
  const next = pickLiveFallback(candidates, current, verdictOf, streak.tried, now, house);
  if (!next) {
    /* Solo quedaba una IPTV, y la está usando otro aparato: se dice, no se le quita. */
    const busy =
      house.busyIptv !== null &&
      pickLiveFallback(candidates, current, verdictOf, streak.tried, now)?.source === 'iptv';
    return { kind: 'none', reason: busy ? 'iptv_busy' : 'no_source' };
  }
  streak.tried.add(next.id);
  streak.jumps += 1;
  streak.lastJumpAt = now;
  streak.soundSince = null;
  streak.scanWaitUntil = null;
  return { kind: 'switch', choice: choiceOf(next, current) };
}

/** Sin saltos en este rato, la racha se da por acabada: la que suena ya va bien. */
export const AUTO_STREAK_RESET_MS = 3 * 60_000;

/** La racha a cero (conserva el margen de un «Poner» a mano). */
function endStreak(streak: AutoStreak): void {
  streak.tried.clear();
  streak.jumps = 0;
  streak.lastJumpAt = Number.NEGATIVE_INFINITY;
  streak.soundSince = null;
  streak.scanWaitUntil = null;
}

/** Empieza otra racha si la última ya es vieja (conserva el margen de un «Poner» a mano). */
export function refreshStreak(streak: AutoStreak, now: number): void {
  if (streak.jumps === 0 || now - streak.lastJumpAt < AUTO_STREAK_RESET_MS) return;
  endStreak(streak);
}

/** Lo que tiene que sonar seguida la fuente nueva para dar la racha por acabada. */
export const AUTO_SOUNDED_MS = 20_000;

/**
 * Alguien de la sala la está viendo sin cargar: tras `AUTO_SOUNDED_MS` así, la racha se
 * acaba (lo probado vuelve a valer y el freno de saltos empieza de cero). Sin esto, cuatro
 * cortes con un minuto de imagen entre ellos dejaban la sala en «limit».
 */
export function heardSound(streak: AutoStreak, now: number): void {
  if (streak.jumps === 0 && streak.tried.size === 0) return;
  streak.soundSince ??= now;
  if (now - streak.soundSince >= AUTO_SOUNDED_MS) endStreak(streak);
}

/** Se ha vuelto a cortar: lo que llevaba sonando no cuenta. */
export function soundLost(streak: AutoStreak): void {
  streak.soundSince = null;
}

/** ¿Esta caída es de una fuente que acaba de poner el automático, en la misma racha? */
export function jumpedInStreak(streak: AutoStreak, hash: string): boolean {
  return streak.jumps > 0 && streak.tried.has(hash);
}

/** Sin otra buena y con el comprobador en marcha: se reintenta cada esto, hasta `AUTO_SCAN_WAIT_MS`. */
export const AUTO_SCAN_RETRY_MS = 5_000;
export const AUTO_SCAN_WAIT_MS = 2 * 60_000;

/** ¿Se espera al comprobador antes de dar el aviso? Anota hasta cuándo. */
export function waitForScan(streak: AutoStreak, scanning: boolean, now: number): boolean {
  if (!scanning) return false;
  streak.scanWaitUntil ??= now + AUTO_SCAN_WAIT_MS;
  return now < streak.scanWaitUntil;
}

/** Tras un «Poner» a mano: otra racha y `AUTO_MANUAL_GRACE_MS` sin que actúe el automático. */
export function manualSwitch(streak: AutoStreak, now: number): void {
  endStreak(streak);
  streak.graceUntil = now + AUTO_MANUAL_GRACE_MS;
}

/** El aviso del chat cuando el automático no encuentra otra. */
export const AUTO_NONE_TEXT = 'No queda otra fuente buena: el líder puede elegir una en Fuentes.';
/** Solo quedaba la IPTV, y otro aparato de casa la está usando. */
export const AUTO_IPTV_BUSY_TEXT =
  'La IPTV de casa la está usando otro aparato y no queda otra fuente buena: el líder puede elegir una en Fuentes.';
