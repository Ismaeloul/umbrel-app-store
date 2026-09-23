/* Módulo `directories`: listas M3U/HTML/IPFS y su sincronización
   (arquitectura §5.11; backend-modulos §3.14; B-191 a B-199).

   Cambios respecto a la 0.6.59:
   - UN solo cerrojo para todas las sincronizaciones (periódica cada 3 h, de
     arranque, la que lanza la resolución si una lista lleva más de 30 min y
     la manual). Se aplica el resultado solo si la URL y el tipo del
     directorio no cambiaron mientras tanto (backend-modulos §8.2.6).
   - Un directorio que falla siempre deja de relanzarse en cada resolución:
     espera exponencial (§8.2.7).
   - IPFS sin pasarela, con cada bloque del CAR comprobado contra su sha256
     (T-121, B-196); la pasarela pública solo si IPFS falla, y de ipfs.io a
     dweb.link si se satura (T-117, B-197).

   Tests a portar: T-116 (B-195), T-117 (B-197), T-119 (B-194),
   T-121 (B-196), y T-036 (B-185, renombres que sobreviven a la sincronización).

   Decisiones del paso 1.1 (docs/cobertura/directories.md):
   - `AUTO_SYNC=false` apaga TODA sincronización automática (arranque,
     periódica y la de la resolución), como la 0.6.59 (`autoSyncWeb` volvía
     sin hacer nada, server.js:5092, también desde `refrescarListasSiTocan`).
     Solo `autoSync('manual')` y `sync()` salen a internet con él.
   - El cerrojo es una cola FIFO por directorio: la periódica suelta el
     cerrojo entre un directorio y el siguiente, así que una sincronización
     manual espera como mucho a que termine el directorio en curso.
   - La espera exponencial (5 min, 10, 20… hasta 3 h) solo frena a la
     sincronización que lanza la resolución, y esta solo refresca los
     directorios que tocan (más de 30 min y sin espera pendiente). */

import type { DirectorySyncBody, DirectoryView, Item, LegacyDirectoryResponse } from '@ace/shared';
import type { CoreDeps, Lifecycle } from '../../core/module.js';
import type { NetClient } from '../net/types.js';
import type { StateService } from '../state/types.js';

export interface DirectoriesDeps extends CoreDeps {
  readonly net: NetClient;
  readonly state: StateService;
  /** DNSLink: registros TXT (por defecto, `dns.promises.resolveTxt`). Los tests lo sustituyen. */
  readonly resolveTxt?: (hostname: string) => Promise<string[][]>;
  /** Aleatorio de los ids nuevos `directorio-<base36>-<5>` (por defecto, `Math.random`). */
  readonly random?: () => number;
}

/** Canal tal y como lo devuelven los parsers de la 0.6.59, antes de normalizar. */
export type { ParsedStream } from './parsers.js';

/** Por qué se sincroniza (para el log y para decidir la espera exponencial). */
export type SyncReason = 'manual' | 'startup' | 'periodic' | 'resolution';

export interface DirectoriesService extends Lifecycle {
  /** Directorios guardados y canales del activo (GET /api/v1/directories). */
  view(): DirectoryView;
  /**
   * Añadir o refrescar un directorio (POST /api/streams/sync). Descarga,
   * parsea (M3U o HTML), conserva renombres y ocultos, y guarda. Lanza
   * `source_limit`, `source_not_found`, `empty_directory` o cualquier error de
   * `net`. Devuelve la forma antigua (`directoryResponse`); v1 usa `view()`.
   */
  sync(body: DirectorySyncBody | Record<string, unknown>): Promise<LegacyDirectoryResponse>;
  /** Elegir el directorio activo (`source_not_found`). */
  activate(sourceId: string): Promise<LegacyDirectoryResponse>;
  /** Borrar un directorio: nunca el último (`last_source`, `source_not_found`). */
  remove(sourceId: string): Promise<LegacyDirectoryResponse>;
  /**
   * `autoSyncWeb` (server.js:5091): sincroniza en serie los directorios que
   * tocan. Con `AUTO_SYNC=false` no sale a internet salvo con `manual`
   * (T-119). Si ya hay una en marcha, devuelve esa.
   */
  autoSync(reason: SyncReason): Promise<void>;
  /** La resolución la llama sin esperar: refresca lo que lleve más de 30 min (B-193). */
  refreshStaleInBackground(): void;

  // --- Funciones puras (sin red), expuestas para sus tests ---
  /**
   * `parseM3u` (server.js:2751): `#EXTINF` con `tvg-id` como alias y
   * `group-title` como categoría. Devuelve los canales YA normalizados como
   * se guardarían (tope de 500, sin duplicados, con fecha del reloj); la forma
   * cruda de la 0.6.59 está en legacy-exports.ts.
   */
  parseM3u(text: string): Item[];
  /** `parseHtml` (server.js:2787): enlaces `acestream://` y `?id=` de una página (normalizados). */
  parseHtml(text: string): Item[];
}
