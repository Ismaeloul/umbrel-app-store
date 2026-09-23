/* Fiabilidad aprendida de las fuentes (server.js:3807-3966; backend-modulos
   §7.5; B-055 a B-061). Aritmética sobre lo que pasa de verdad al
   reproducir, por hash y por proveedor:
     arranco  la señal empezó a reproducir     → intentos +1, éxitos +1
     fallo    nunca llegó a arrancar           → intentos +1
     cayo     arrancó y se murió               → caídas +1 (y si duró menos
              de 60 s, el éxito se revoca)
     sigue    solo renueva el veredicto        → no suma
   Lo anterior se desgasta con una vida media de 14 días al escribir; la
   confianza es la cota inferior de Wilson (z = 1,96) y lo desconocido vale
   0,35. Funciones puras, portadas tal cual. */

import {
  STATS_MAX_KEYS,
  TEXT_LIMITS,
  type OutcomeResult,
  type SourceStatEntry,
  type SourceStats,
  type VerdictState,
} from '@ace/shared';

const DAY = 24 * 60 * 60 * 1000;

/** Vida media del desgaste (server.js:3832). */
export const STATS_HALF_LIFE_MS = 14 * DAY;
/** Menos de un minuto no cuenta como que funcionó (server.js:3834). */
export const STATS_SHORT_PLAY_S = 60;
/** Lo desconocido: por debajo de lo probado bueno y por encima de lo probado malo (server.js:3835). */
export const STATS_NEUTRAL = 0.35;
/** Lo que pesa la fama del proveedor frente a la del hash (server.js:3929). */
export const PROVIDER_WEIGHT = 0.9;

/** Lee una clave propia (nunca del prototipo: un proveedor puede llamarse "constructor"). */
export function ownEntry<T>(record: Readonly<Record<string, T>> | null | undefined, key: string) {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Escribe una clave propia aunque sea `__proto__`. */
export function setOwn<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** `statsVacias` (server.js:3837-3839). */
export function emptyStat(): SourceStatEntry {
  return { intentos: 0, exitos: 0, caidas: 0, segundos: 0, ultimo: 0 };
}

/** `normalizeSourceStatEntry` (server.js:3841-3853). */
export function normalizeSourceStatEntry(value: unknown): SourceStatEntry {
  const record = (value ?? null) as Record<string, unknown> | null;
  const numero = (raw: unknown, tope: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, tope) : 0;
  };
  return {
    intentos: numero(record?.intentos, 100_000),
    exitos: numero(record?.exitos, 100_000),
    caidas: numero(record?.caidas, 100_000),
    segundos: numero(record?.segundos, 100_000_000),
    ultimo: numero(record?.ultimo, Number.MAX_SAFE_INTEGER),
  };
}

/** `normalizeSourceStatsGroup` (server.js:3855-3866): 600 claves, las más recientes; fuera las de 0 intentos. */
export function normalizeSourceStatsGroup(value: unknown): Record<string, SourceStatEntry> {
  const salida: Record<string, SourceStatEntry> = {};
  const entradas = value && typeof value === 'object' ? Object.entries(value) : [];
  const ordenadas = entradas
    .map(
      ([clave, stat]) =>
        [String(clave).slice(0, TEXT_LIMITS.statKey), normalizeSourceStatEntry(stat)] as const,
    )
    .filter(([clave, stat]) => clave && stat.intentos > 0)
    .sort((a, b) => b[1].ultimo - a[1].ultimo)
    .slice(0, STATS_MAX_KEYS);
  for (const [clave, stat] of ordenadas) setOwn(salida, clave, stat);
  return salida;
}

/** `normalizeSourceStats` (server.js:3868-3873). */
export function normalizeSourceStats(value: unknown): SourceStats {
  const record = (value ?? null) as { hashes?: unknown; proveedores?: unknown } | null;
  return {
    hashes: normalizeSourceStatsGroup(record?.hashes),
    proveedores: normalizeSourceStatsGroup(record?.proveedores),
  };
}

/**
 * `desgastar` (server.js:3877-3888): el pasado pesa menos cuanto más viejo.
 * Se aplica al escribir para que las lecturas salgan gratis.
 */
export function desgastar(stat: SourceStatEntry, ahora: number): SourceStatEntry {
  if (!stat.ultimo || ahora <= stat.ultimo) return stat;
  const factor = Math.pow(0.5, (ahora - stat.ultimo) / STATS_HALF_LIFE_MS);
  if (factor >= 0.999) return stat;
  return {
    intentos: stat.intentos * factor,
    exitos: stat.exitos * factor,
    caidas: stat.caidas * factor,
    segundos: stat.segundos * factor,
    ultimo: stat.ultimo,
  };
}

/** `anotarResultado` (server.js:3890-3906). T-090, T-091. */
export function anotarResultado(
  stat: SourceStatEntry | null | undefined,
  resultado: OutcomeResult | string,
  segundos: number,
  ahora: number,
): SourceStatEntry {
  const previo = desgastar(stat || emptyStat(), ahora);
  const siguiente = { ...previo, ultimo: ahora };
  if (resultado === 'fallo') {
    siguiente.intentos += 1;
  } else if (resultado === 'arranco') {
    siguiente.intentos += 1;
    siguiente.exitos += 1;
  } else if (resultado === 'cayo') {
    siguiente.caidas += 1;
    siguiente.segundos += Math.max(0, Number(segundos) || 0);
    /* Arrancar y morirse en menos de un minuto no es que funcionara: se
       retira el éxito que se le había apuntado al empezar. */
    if ((Number(segundos) || 0) < STATS_SHORT_PLAY_S) {
      siguiente.exitos = Math.max(0, siguiente.exitos - 1);
    }
  }
  return siguiente;
}

/**
 * `tasaFiable` (server.js:3911-3919): cota inferior de Wilson sobre la tasa
 * de éxito. Un 1 de 1 no vale lo mismo que un 20 de 20. `null` sin datos. T-089.
 */
export function tasaFiable(
  stat: Pick<SourceStatEntry, 'intentos' | 'exitos'> | null | undefined,
): number | null {
  if (!stat || stat.intentos < 1) return null;
  const n = stat.intentos;
  const p = Math.min(1, Math.max(0, stat.exitos / n));
  const z = 1.96;
  const z2 = z * z;
  const centro = p + z2 / (2 * n);
  const margen = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (centro - margen) / (1 + z2 / n));
}

/** Lo que usa `proveedorDeSeñal` de un candidato. */
export interface ProviderInput {
  readonly title?: unknown;
  readonly listaId?: unknown;
  readonly source?: unknown;
}

/**
 * `proveedorDeSeñal` (server.js:3774-3778): la coletilla tras la flecha del
 * título en minúsculas ("LIGA DE CAMPEONES --> ELCANO" → "elcano"); si no,
 * el `listaId`, la procedencia u "otros". T-063.
 */
export function proveedorDeSeñal(candidate: ProviderInput | null | undefined): string {
  const coletilla = /(?:--?>|={1,2}>|[→⇒➜➝⟶⟹])\s*(.+)$/.exec(String(candidate?.title || ''));
  if (coletilla) return (coletilla[1] ?? '').trim().toLowerCase();
  return String(candidate?.listaId || candidate?.source || 'otros');
}

/**
 * `fiabilidadDeCandidato` (server.js:3924-3930): la del hash; si nunca se ha
 * probado, la de su proveedor × 0,9; sin datos, null.
 */
export function fiabilidadDeCandidato(
  candidate: (ProviderInput & { readonly id?: unknown }) | null | undefined,
  stats: Partial<SourceStats> | null | undefined,
): number | null {
  if (!stats) return null;
  const propia = tasaFiable(ownEntry(stats.hashes, String(candidate?.id ?? '')));
  if (propia !== null) return propia;
  const proveedor = tasaFiable(ownEntry(stats.proveedores, proveedorDeSeñal(candidate || {})));
  return proveedor === null ? null : proveedor * PROVIDER_WEIGHT;
}

/**
 * `veredictoDelReproductor` (server.js:3933-3937): arranco o sigue →
 * working/player_ok; cayó tras ≥ 60 s → weak/player_dropped; lo demás →
 * failed/player_failed. T-122.
 */
export function veredictoDelReproductor(
  resultado: OutcomeResult | string,
  segundos: number,
): { state: VerdictState; reason: string } {
  if (resultado === 'arranco' || resultado === 'sigue')
    return { state: 'working', reason: 'player_ok' };
  if (resultado === 'cayo' && segundos >= STATS_SHORT_PLAY_S) {
    return { state: 'weak', reason: 'player_dropped' };
  }
  return { state: 'failed', reason: 'player_failed' };
}

export const OUTCOME_RESULTS: readonly OutcomeResult[] = ['arranco', 'fallo', 'cayo', 'sigue'];
