/* Los idiomas elegidos para Películas y series (docs/vod.md §4.10).

   `v2/vod-idiomas.json`, por casa (vale en el PC y en el iPhone), con su
   cola, escritura atómica, `.bak` y cuarentena (`createDocumentStore`).
   Aparte de `v2/vod.json` a propósito: ese se vacía al cambiar de proveedor
   y se borra al eliminar la IPTV, y los idiomas son de Isma, no del
   proveedor. El fichero se crea al elegir la primera vez: hasta entonces,
   `chosen: false` y la web enseña el selector. Un fichero ilegible se
   aparta y se vuelve a preguntar (como la primera vez), nunca se inventa
   una elección. Los idiomas que no conozca esta versión se descartan al
   leer (el esquema del fichero no es estricto: una versión futura puede
   añadir campos sin que esta lo aparte). */

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  VOD_LANGS,
  VodLanguagesFileSchema,
  type VodLang,
  type VodLanguages,
  type VodLanguagesBody,
  type VodLanguagesFile,
} from '@ace/shared';
import type { Clock } from '../../../core/clock.js';
import type { Logger } from '../../../core/logger.js';
import { createDocumentStore, type ManagedDocumentStore } from '../../state/documents.js';

export interface VodLanguageStoreOptions {
  readonly file: string;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Los idiomas conocidos de una lista, sin repetir y en el orden de `VOD_LANGS`. */
export function knownLangs(values: readonly string[]): VodLang[] {
  const asked = new Set(values);
  return VOD_LANGS.filter((lang) => asked.has(lang));
}

const EMPTY: VodLanguagesFile = { version: 1, langs: [], unknown: true, updatedAt: null };

function viewOf(file: VodLanguagesFile): VodLanguages {
  return {
    chosen: file.updatedAt !== null,
    langs: knownLangs(file.langs),
    unknown: file.unknown,
    updatedAt: file.updatedAt,
  };
}

export class VodLanguageStore {
  private store: ManagedDocumentStore<VodLanguagesFile> | null = null;
  private memory: VodLanguages;

  constructor(private readonly options: VodLanguageStoreOptions) {
    this.memory = existsSync(options.file) ? viewOf(this.open().read()) : viewOf(EMPTY);
  }

  private open(): ManagedDocumentStore<VodLanguagesFile> {
    if (!this.store) mkdirSync(path.dirname(this.options.file), { recursive: true });
    this.store ??= createDocumentStore<VodLanguagesFile>({
      name: 'vod-idiomas',
      file: this.options.file,
      schema: VodLanguagesFileSchema,
      defaults: () => ({ ...EMPTY }),
      clock: this.options.clock,
      logger: this.options.logger,
    });
    return this.store;
  }

  /** La elección (o «sin elegir» la primera vez). */
  read(): VodLanguages {
    return this.memory;
  }

  /** Guarda la elección (sustituye a la anterior) y la devuelve. */
  async save(body: VodLanguagesBody): Promise<VodLanguages> {
    const langs = knownLangs(body.langs);
    const updatedAt = this.options.clock.date().toISOString();
    await this.open().update((draft) => {
      draft.version = 1;
      draft.langs = langs;
      draft.unknown = body.unknown;
      draft.updatedAt = updatedAt;
    });
    this.memory = { chosen: true, langs, unknown: body.unknown, updatedAt };
    this.options.logger.info(
      { langs: langs.length ? langs : 'todos', unknown: body.unknown },
      'idiomas de Películas y series elegidos',
    );
    return this.memory;
  }

  async flush(): Promise<void> {
    await this.store?.flush();
  }
}
