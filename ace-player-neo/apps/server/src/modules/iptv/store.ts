/* Ficheros cifrados de la IPTV (docs/iptv.md §2.1): `v2/iptv/catalogo.enc`
   y `v2/iptv/guia.enc`, con 0600 en una carpeta 0700. La configuración
   (`v2/iptv.json`) la lleva el documento de `state` (`state.iptv()`).

   También `v2/iptv/vod.enc` y la carpeta `v2/iptv/arte/` de Películas y
   series (docs/vod.md §4.6 y §8): `removeAll` las borra con lo demás, porque
   todos los ids cambian con otro proveedor. Quien los escribe y los lee es
   `vod/catalog.ts` y `vod/art.ts`.

   Escritura atómica en binario (tmp + rename). Un fichero que no se puede
   descifrar o no tiene la forma esperada se ignora (y se borra): se vuelve a
   descargar. */

import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { IptvKeys } from '../../config/keys.js';
import type { Logger } from '../../core/logger.js';
import { Catalog } from './catalog.js';
import {
  FILE_MODE,
  catalogAad,
  ensureIptvDir,
  guideAad,
  openBlob,
  sealBlob,
  sealBlobChunks,
} from './crypto.js';
import { guideFromStored, guideToStored, type GuideWindow } from './guide.js';

export interface IptvFilePaths {
  readonly iptvDir: string;
  readonly iptvCatalogFile: string;
  readonly iptvGuideFile: string;
  /** Catálogo VOD (docs/vod.md §4.6); opcional en los tests que montan rutas a mano. */
  readonly vodCatalogFile?: string;
  /** Caché de carteles (docs/vod.md §8). */
  readonly vodArtDir?: string;
}

/** Escritura atómica de un fichero cifrado de la IPTV (0600 en la carpeta 0700). */
export async function writeSecret(file: string, dir: string, data: Buffer): Promise<void> {
  ensureIptvDir(dir);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, data, { mode: FILE_MODE });
  await chmod(tmp, FILE_MODE).catch(() => undefined);
  await rename(tmp, file);
}

export class IptvFiles {
  constructor(
    private readonly paths: IptvFilePaths,
    private readonly keys: () => IptvKeys,
    private readonly logger: Logger,
    /** Solo lectura (el ensayo): un fichero ilegible no se borra. */
    private readonly readOnly = false,
  ) {}

  async saveCatalog(catalog: Catalog): Promise<void> {
    const blob = await sealBlobChunks(
      this.keys().secrets,
      catalogAad(catalog.providerId),
      catalog.storedChunks(),
    );
    await writeSecret(this.paths.iptvCatalogFile, this.paths.iptvDir, blob);
  }

  /** El catálogo guardado de ese proveedor, o null. */
  async loadCatalog(providerId: string): Promise<Catalog | null> {
    let blob: Buffer;
    try {
      blob = await readFile(this.paths.iptvCatalogFile);
    } catch {
      return null;
    }
    try {
      const catalog = Catalog.fromStored(
        openBlob(this.keys().secrets, catalogAad(providerId), blob),
      );
      if (catalog && catalog.providerId === providerId) return catalog;
    } catch {
      this.logger.warn(
        { errorCode: 'iptv_secret_unreadable' },
        'catálogo IPTV ilegible: se descarta',
      );
    }
    if (!this.readOnly) {
      await rm(this.paths.iptvCatalogFile, { force: true }).catch(() => undefined);
    }
    return null;
  }

  async saveGuide(window: GuideWindow, providerId: string): Promise<void> {
    const blob = sealBlob(
      this.keys().secrets,
      guideAad(providerId),
      guideToStored(window, providerId),
    );
    await writeSecret(this.paths.iptvGuideFile, this.paths.iptvDir, blob);
  }

  async loadGuide(providerId: string): Promise<GuideWindow | null> {
    let blob: Buffer;
    try {
      blob = await readFile(this.paths.iptvGuideFile);
    } catch {
      return null;
    }
    try {
      const window = guideFromStored(
        openBlob(this.keys().secrets, guideAad(providerId), blob),
        providerId,
      );
      if (window) return window;
    } catch {
      this.logger.warn({ errorCode: 'iptv_secret_unreadable' }, 'guía IPTV ilegible: se descarta');
    }
    if (!this.readOnly) await rm(this.paths.iptvGuideFile, { force: true }).catch(() => undefined);
    return null;
  }

  /**
   * Borra catálogo y guía (y sus restos), el catálogo VOD y la caché de
   * carteles (docs/vod.md §10.5). La clave local, si la hay, se queda.
   */
  async removeAll(): Promise<void> {
    const vod = this.paths.vodCatalogFile;
    for (const file of [
      this.paths.iptvCatalogFile,
      `${this.paths.iptvCatalogFile}.tmp`,
      this.paths.iptvGuideFile,
      `${this.paths.iptvGuideFile}.tmp`,
      ...(vod ? [vod, `${vod}.tmp`] : []),
    ]) {
      await rm(file, { force: true }).catch(() => undefined);
    }
    if (this.paths.vodArtDir) {
      await rm(this.paths.vodArtDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async removeGuide(): Promise<void> {
    await rm(this.paths.iptvGuideFile, { force: true }).catch(() => undefined);
  }
}
