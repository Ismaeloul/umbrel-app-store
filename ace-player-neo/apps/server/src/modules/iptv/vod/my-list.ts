/* «Mi lista» de Películas y series (0.9.1): los títulos que Isma guarda
   para ver luego («Cuando me meta en una serie… un botón que diga "Añadir a
   mi lista"»).

   `v2/vod-mi-lista.json`, por casa (vale en el PC y en el iPhone), con su
   cola, escritura atómica, `.bak` y cuarentena (`createDocumentStore`).
   Aparte de `v2/vod.json` por lo mismo que los idiomas: ese se vacía al
   cambiar de proveedor y se borra al eliminar la IPTV; la lista es de Isma.
   Lo que deja de estar en el catálogo se QUEDA (la web dice «Ya no está en
   tu IPTV») hasta que se quite, y si vuelve con otro id (otro proveedor, una
   copia de otro Umbrel) se vuelve a enganchar por su título (`relink`).

   Cada entrada guarda su id sellado, el tipo, el título y el año: nada del
   proveedor. 500 como mucho (`VOD_LIST.itemsMax`): al llenarse, añadir da
   `vod_list_full` (nunca se tira nada sin avisar). El fichero se crea con
   la primera escritura. */

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { VOD_LIST, VodListFileSchema, type VodListEntry, type VodListFile } from '@ace/shared';
import type { Clock } from '../../../core/clock.js';
import { AppError } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';
import { createDocumentStore, type ManagedDocumentStore } from '../../state/documents.js';

export interface VodListStoreOptions {
  readonly file: string;
  readonly clock: Clock;
  readonly logger: Logger;
}

const EMPTY: VodListFile = { version: 1, items: [] };

/** De la más nueva a la más vieja, sin ids repetidos (se queda la primera) y con el tope. */
export function tidyList(items: readonly VodListEntry[]): VodListEntry[] {
  const seen = new Set<string>();
  const out: VodListEntry[] = [];
  for (const item of [...items].sort((a, b) => b.addedAt - a.addedAt)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out.slice(0, VOD_LIST.itemsMax);
}

/**
 * La lista tras una copia de seguridad: en Reemplazar, la de la copia; en
 * Combinar, la de aquí más lo de la copia que no esté (por id o por tipo y
 * título), hasta el tope (se quedan las más nuevas).
 */
export function mergeLists(
  current: readonly VodListEntry[],
  incoming: readonly VodListEntry[],
  mode: 'replace' | 'merge',
): VodListEntry[] {
  if (mode === 'replace') return tidyList(incoming);
  const ids = new Set(current.map((item) => item.id));
  const names = new Set(current.map((item) => sameTitleKey(item)));
  const extra = incoming.filter((item) => !ids.has(item.id) && !names.has(sameTitleKey(item)));
  return tidyList([...current, ...extra]);
}

/** Clave para reconocer un título por su nombre (tipo, título sin mayúsculas ni acentos, año). */
export function sameTitleKey(item: Pick<VodListEntry, 'kind' | 'title' | 'year'>): string {
  return `${item.kind}|${normalTitle(item.title)}|${item.year ?? ''}`;
}

/** Igual sin el año (un título sin año en un lado casa con el mismo título con año en el otro). */
export function titleOnlyKey(item: Pick<VodListEntry, 'kind' | 'title'>): string {
  return `${item.kind}|${normalTitle(item.title)}`;
}

function normalTitle(title: string): string {
  return title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export class VodListStore {
  private store: ManagedDocumentStore<VodListFile> | null = null;
  private memory: VodListEntry[];

  constructor(private readonly options: VodListStoreOptions) {
    this.memory = existsSync(options.file) ? tidyList(this.open().read().items) : [];
  }

  private open(): ManagedDocumentStore<VodListFile> {
    if (!this.store) mkdirSync(path.dirname(this.options.file), { recursive: true });
    this.store ??= createDocumentStore<VodListFile>({
      name: 'vod-mi-lista',
      file: this.options.file,
      schema: VodListFileSchema,
      defaults: () => ({ ...EMPTY, items: [] }),
      clock: this.options.clock,
      logger: this.options.logger,
    });
    return this.store;
  }

  /** La lista, de la más nueva a la más vieja. */
  read(): readonly VodListEntry[] {
    return this.memory;
  }

  has(id: string): boolean {
    return this.memory.some((item) => item.id === id);
  }

  /** Sustituye la lista entera y la guarda. */
  async replace(items: readonly VodListEntry[]): Promise<void> {
    const next = tidyList(items);
    await this.open().update((draft) => {
      draft.version = 1;
      draft.items = next;
    });
    this.memory = next;
  }

  /**
   * Añade un título (arriba del todo). Si ya estaba, no cambia nada (ni su
   * sitio): pulsar dos veces o desde dos aparatos da lo mismo. Devuelve si
   * cambió algo. Llena: `vod_list_full`.
   */
  async add(entry: Omit<VodListEntry, 'addedAt'>): Promise<boolean> {
    if (this.has(entry.id)) return false;
    if (this.memory.length >= VOD_LIST.itemsMax) {
      throw new AppError('vod_list_full', { detail: `${VOD_LIST.itemsMax}` });
    }
    await this.replace([{ ...entry, addedAt: this.options.clock.now() }, ...this.memory]);
    this.options.logger.info({ kind: entry.kind, items: this.memory.length }, 'añadido a Mi lista');
    return true;
  }

  /** Quita un título. Devuelve si estaba. */
  async remove(id: string): Promise<boolean> {
    if (!this.has(id)) return false;
    await this.replace(this.memory.filter((item) => item.id !== id));
    this.options.logger.info({ items: this.memory.length }, 'quitado de Mi lista');
    return true;
  }

  async flush(): Promise<void> {
    await this.store?.flush();
  }
}
