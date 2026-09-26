/* Ficheros cifrados de la IPTV (docs/iptv.md §2.1): `v2/iptv/catalogo.enc`
   y `v2/iptv/guia.enc`, con 0600 en una carpeta 0700. La configuración
   (`v2/iptv.json`) la lleva el documento de `state` (`state.iptv()`).

   Escritura atómica en binario (tmp + rename). Un fichero que no se puede
   descifrar o no tiene la forma esperada se ignora (y se borra): se vuelve a
   descargar. */

import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { IptvKeys } from '../../config/keys.js';
import type { Logger } from '../../core/logger.js';
import { Catalog } from './catalog.js';
import { FILE_MODE, catalogAad, ensureIptvDir, guideAad, openBlob, sealBlob } from './crypto.js';
import { guideFromStored, guideToStored, type GuideWindow } from './guide.js';

export interface IptvFilePaths {
  readonly iptvDir: string;
  readonly iptvCatalogFile: string;
  readonly iptvGuideFile: string;
}

async function writeSecret(file: string, dir: string, data: Buffer): Promise<void> {
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
  ) {}

  async saveCatalog(catalog: Catalog): Promise<void> {
    const blob = sealBlob(this.keys().secrets, catalogAad(catalog.providerId), catalog.toStored());
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
    await rm(this.paths.iptvCatalogFile, { force: true }).catch(() => undefined);
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
    await rm(this.paths.iptvGuideFile, { force: true }).catch(() => undefined);
    return null;
  }

  /** Borra catálogo y guía (y sus restos). La clave local, si la hay, se queda. */
  async removeAll(): Promise<void> {
    for (const file of [
      this.paths.iptvCatalogFile,
      `${this.paths.iptvCatalogFile}.tmp`,
      this.paths.iptvGuideFile,
      `${this.paths.iptvGuideFile}.tmp`,
    ]) {
      await rm(file, { force: true }).catch(() => undefined);
    }
  }

  async removeGuide(): Promise<void> {
    await rm(this.paths.iptvGuideFile, { force: true }).catch(() => undefined);
  }
}
