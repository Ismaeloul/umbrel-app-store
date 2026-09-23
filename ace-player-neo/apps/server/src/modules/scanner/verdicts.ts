/* Veredictos por fuente (`scannerCache`, server.js:161) y la máquina de
   estados explícita de una fuente (arquitectura §5.9; backend-modulos §7.3).

   Nombres: desconocida = sin veredicto vigente (`queued`), comprobando =
   sonda en curso (`checking`), verificada = `working`, floja = `weak`,
   fallida = `failed`. Reglas (server.js:3304-3353):
   - lo que cuenta el reproductor manda 3 min sobre cualquier sonda;
   - una verificada (en los últimos 10 min) que falla UNA sonda por una causa
     que no es del vídeo queda floja (`intermittent`); el segundo fallo
     seguido la deja fallida;
   - los veredictos caducan: 10 min los buenos y el retraso de reintento
     (10 min por defecto) los fallidos.
   Sin estado global: cada comprobador tiene su caché (`VerdictCache`). */

import type { VerdictState } from '@ace/shared';
import { PLAYER_VERDICT_HOLD_MS, SCANNER_GOOD_TTL_MS, SCANNER_HARD_FAILURES } from './constants.js';
import { playableOnFromState } from './evidence.js';

export type VerdictSource = 'scanner' | 'player';

/** Lo mínimo de un resultado para anotarlo (probe o reproductor). */
export interface VerdictInput {
  readonly state: VerdictState;
  readonly reason: string;
  readonly by?: VerdictSource | string;
  readonly checkedAt?: string | null;
  readonly [field: string]: unknown;
}

/** Veredicto como lo devuelve `recordScannerVerdict`: el resultado con `by`. */
export type Verdict = VerdictInput & { readonly by: VerdictSource };

/** Entrada de la caché: el veredicto y cuándo se guardó. */
export type CachedVerdict = Verdict & { readonly cachedAt: number };

export interface VerdictPolicy {
  /** Vida de un `failed` (server.js:102: el retraso de reintento). */
  readonly badTtlMs: number;
  /** Vida de un `working` o `weak` (server.js:101). */
  readonly goodTtlMs: number;
  /** Retención del veredicto del reproductor (server.js:107). */
  readonly holdMs: number;
}

export function verdictPolicy(badTtlMs: number): VerdictPolicy {
  return { badTtlMs, goodTtlMs: SCANNER_GOOD_TTL_MS, holdMs: PLAYER_VERDICT_HOLD_MS };
}

/** Estados de una fuente con sus nombres de la API (arquitectura §5.9). */
export type SourceState = 'desconocida' | 'comprobando' | 'verificada' | 'floja' | 'fallida';

export const API_NAME_OF_STATE: Readonly<Record<SourceState, string>> = {
  desconocida: 'queued',
  comprobando: 'checking',
  verificada: 'working',
  floja: 'weak',
  fallida: 'failed',
};

const STATE_OF_VERDICT: Readonly<Record<VerdictState, SourceState>> = {
  working: 'verificada',
  weak: 'floja',
  failed: 'fallida',
};

function ttlOf(entry: CachedVerdict, policy: VerdictPolicy): number {
  return entry.state === 'failed' ? policy.badTtlMs : policy.goodTtlMs;
}

/** ¿Sigue vigente este veredicto? (`scannerCacheHit`, server.js:3304-3313). */
export function isFresh(
  entry: CachedVerdict | undefined,
  now: number,
  policy: VerdictPolicy,
): boolean {
  return Boolean(entry && now - entry.cachedAt <= ttlOf(entry, policy));
}

/** ¿Manda aún el reproductor? (`playerVerdictHeld`, server.js:3315-3318). */
export function isHeldByPlayer(
  entry: CachedVerdict | undefined,
  now: number,
  policy: VerdictPolicy,
): boolean {
  return Boolean(entry && entry.by === 'player' && now - entry.cachedAt < policy.holdMs);
}

/** Estado explícito de una fuente a partir de su veredicto guardado. */
export function sourceStateOf(
  entry: CachedVerdict | undefined,
  now: number,
  policy: VerdictPolicy,
  checking = false,
): SourceState {
  if (checking) return 'comprobando';
  if (!entry || !isFresh(entry, now, policy)) return 'desconocida';
  return STATE_OF_VERDICT[entry.state];
}

export interface VerdictTransition {
  /** Lo que devuelve `recordScannerVerdict`. */
  readonly verdict: Verdict | (CachedVerdict & { readonly cached: true });
  /** La nueva entrada de la caché, o null si no cambia (manda el reproductor). */
  readonly entry: CachedVerdict | null;
}

/**
 * La transición de la máquina al llegar un veredicto (`recordScannerVerdict`,
 * server.js:3330-3339), sin efectos: la usan la caché y los tests de la
 * máquina completa.
 */
export function applyVerdict(
  previous: CachedVerdict | undefined,
  result: VerdictInput,
  now: number,
  policy: VerdictPolicy,
): VerdictTransition {
  const byPlayer = result.by === 'player';
  if (!byPlayer && previous && isHeldByPlayer(previous, now, policy)) {
    return { verdict: { ...previous, cached: true }, entry: null };
  }
  let verdict: Verdict = { ...result, by: byPlayer ? 'player' : 'scanner' };
  if (
    !byPlayer &&
    verdict.state === 'failed' &&
    !SCANNER_HARD_FAILURES.has(verdict.reason) &&
    previous?.state === 'working' &&
    now - previous.cachedAt <= policy.goodTtlMs
  ) {
    verdict = { ...verdict, state: 'weak', reason: 'intermittent' };
    /* D6: si el resultado traía dónde se puede ver, lo floja se ve en los dos. */
    if ('playableOn' in verdict) verdict = { ...verdict, playableOn: playableOnFromState('weak') };
  }
  return { verdict, entry: { ...verdict, cachedAt: now } };
}

/** `scannerCache` por instancia (server.js:161). */
export class VerdictCache {
  private readonly entries = new Map<string, CachedVerdict>();

  constructor(readonly policy: VerdictPolicy) {}

  get size(): number {
    return this.entries.size;
  }

  /** La entrada tal cual, vigente o no. */
  peek(id: string): CachedVerdict | undefined {
    return this.entries.get(id);
  }

  /** `scannerCacheHit` (server.js:3304-3313): la entrada vigente; la caducada se borra. */
  hit(id: string, now: number): CachedVerdict | null {
    const cached = this.entries.get(id);
    if (!cached) return null;
    if (!isFresh(cached, now, this.policy)) {
      this.entries.delete(id);
      return null;
    }
    return cached;
  }

  /** `playerVerdictHeld` (server.js:3315-3318). */
  held(id: string, now: number): boolean {
    return isHeldByPlayer(this.entries.get(id), now, this.policy);
  }

  /** `recordScannerVerdict` sin la copia a los trabajos (eso lo hace el servicio). */
  record(id: string, result: VerdictInput, now: number): VerdictTransition {
    const transition = applyVerdict(this.entries.get(id), result, now, this.policy);
    if (transition.entry) this.entries.set(id, transition.entry);
    return transition;
  }

  delete(id: string): void {
    this.entries.delete(id);
  }

  /** Poda de lo caducado (server.js:3370-3373). */
  prune(now: number): void {
    for (const [id, cached] of this.entries) {
      if (!isFresh(cached, now, this.policy)) this.entries.delete(id);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
