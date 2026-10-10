/* Lo visto con un proveedor anterior (0.9.1): `v2/vod-visto-anterior.json`.

   Al cambiar de proveedor (o al quitar la IPTV) `v2/vod.json` se vacía:
   todos los ids sellados cambian (§10.5). Antes de vaciarlo, su progreso
   (seguir viendo, por qué capítulo va, lo visto) pasa aquí, y con el
   catálogo nuevo se vuelve a enganchar por tipo + título + año, y en las
   series además por temporada y capítulo (`VodService.relinkProgress`).
   Lo que el nuevo no tenga se QUEDA por si aparece más tarde (otro
   catálogo, o volver al proveedor de antes); 2 000 como mucho, se tiran los
   más viejos. Aparte de `v2/vod.json` por lo mismo que «Mi lista»: ese se
   borra al eliminar la IPTV. El fichero se crea con la primera escritura. */

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  VOD_PROGRESS,
  VodCarriedFileSchema,
  type VodCarriedEntry,
  type VodCarriedFile,
} from '@ace/shared';
import type { Clock } from '../../../core/clock.js';
import type { Logger } from '../../../core/logger.js';
import { createDocumentStore, type ManagedDocumentStore } from '../../state/documents.js';

export interface VodCarriedStoreOptions {
  readonly file: string;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Clave de un título guardado: lo mismo vale para dos entradas (la más nueva gana). */
function entryKey(entry: VodCarriedEntry): string {
  return entry.kind === 'movie'
    ? `movie|${entry.title}|${entry.year ?? ''}`
    : `episode|${entry.title}|${entry.year ?? ''}|${entry.season ?? ''}|${entry.episode ?? ''}`;
}

/** De la más nueva a la más vieja, sin repetidos (por título y capítulo) y con el tope. */
export function tidyCarried(items: readonly VodCarriedEntry[]): VodCarriedEntry[] {
  const seen = new Set<string>();
  const out: VodCarriedEntry[] = [];
  for (const item of [...items].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const key = entryKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, VOD_PROGRESS.itemsMax);
}

export class VodCarriedStore {
  private store: ManagedDocumentStore<VodCarriedFile> | null = null;
  private memory: VodCarriedEntry[];

  constructor(private readonly options: VodCarriedStoreOptions) {
    this.memory = existsSync(options.file) ? tidyCarried(this.open().read().items) : [];
  }

  private open(): ManagedDocumentStore<VodCarriedFile> {
    if (!this.store) mkdirSync(path.dirname(this.options.file), { recursive: true });
    this.store ??= createDocumentStore<VodCarriedFile>({
      name: 'vod-visto-anterior',
      file: this.options.file,
      schema: VodCarriedFileSchema,
      defaults: () => ({ version: 1, items: [] }),
      clock: this.options.clock,
      logger: this.options.logger,
      fileMode: 0o600,
    });
    return this.store;
  }

  read(): readonly VodCarriedEntry[] {
    return this.memory;
  }

  /** Sustituye todo y lo guarda (sin fichero y sin nada que guardar, no lo crea). */
  async replace(items: readonly VodCarriedEntry[]): Promise<void> {
    const next = tidyCarried(items);
    if (!next.length && !this.store && !existsSync(this.options.file)) {
      this.memory = next;
      return;
    }
    await this.open().update((draft) => {
      draft.version = 1;
      draft.items = next;
    });
    this.memory = next;
  }

  /** Añade lo de un proveedor que se va (lo suyo gana a lo guardado de antes). */
  async add(items: readonly VodCarriedEntry[]): Promise<void> {
    if (!items.length) return;
    await this.replace([...items, ...this.memory]);
    this.options.logger.info(
      { carried: items.length, total: this.memory.length },
      'Películas y series: lo visto se guarda para el proveedor nuevo',
    );
  }

  async flush(): Promise<void> {
    await this.store?.flush();
  }
}
