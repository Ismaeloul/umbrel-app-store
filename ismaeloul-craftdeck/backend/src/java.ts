import { mkdir, readdir, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { RUNTIMES_DIR, CACHE_DIR } from './paths.js';
import { fetchJson, download, run } from './util.js';

/** Adoptium publica LTS: mapeamos el Java mínimo que pide MC al LTS que lo cubre. */
export function pickJavaMajor(required: number): number {
  for (const lts of [8, 11, 17, 21, 25]) if (required <= lts) return lts;
  return required; // majors futuros: Adoptium suele publicarlos también
}

function platform(): { os: string; arch: string; exe: string } {
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  return { os, arch, exe: os === 'windows' ? 'java.exe' : 'java' };
}

interface AdoptiumAsset {
  binary: { image_type: string; package: { link: string; name: string } };
}

async function findJavaBin(jreDir: string, exe: string): Promise<string | null> {
  try {
    for (const entry of await readdir(jreDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidates = [
        path.join(jreDir, entry.name, 'bin', exe),
        path.join(jreDir, entry.name, 'Contents', 'Home', 'bin', exe), // macOS
      ];
      for (const c of candidates) {
        try { await access(c); return c; } catch { /* siguiente */ }
      }
    }
  } catch { /* el directorio no existe aún */ }
  return null;
}

/** Garantiza que hay un JRE del major dado y devuelve la ruta al ejecutable java. */
export async function ensureJre(major: number, log: (msg: string) => void): Promise<string> {
  const { os, arch, exe } = platform();
  const jreDir = path.join(RUNTIMES_DIR, `jre-${major}-${os}-${arch}`);

  const existing = await findJavaBin(jreDir, exe);
  if (existing) return existing;

  log(`Descargando Java ${major} (Temurin JRE, ${os}/${arch})…`);
  const assets = await fetchJson<AdoptiumAsset[]>(
    `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?os=${os}&architecture=${arch}&image_type=jre`,
  );
  const pkg = assets.find((a) => a.binary.image_type === 'jre')?.binary.package;
  if (!pkg) throw new Error(`Adoptium no tiene JRE ${major} para ${os}/${arch}`);

  await mkdir(CACHE_DIR, { recursive: true });
  const archive = path.join(CACHE_DIR, pkg.name);
  await download(pkg.link, archive);

  log(`Extrayendo ${pkg.name}…`);
  await rm(jreDir, { recursive: true, force: true });
  await mkdir(jreDir, { recursive: true });
  // tar de sistema: en Windows 10+ bsdtar también abre .zip
  const code = await run('tar', ['-xf', archive, '-C', jreDir]);
  if (code !== 0) throw new Error(`Fallo extrayendo el JRE (tar exit ${code})`);
  await rm(archive, { force: true });

  const bin = await findJavaBin(jreDir, exe);
  if (!bin) throw new Error(`No se encontró ${exe} tras extraer el JRE ${major}`);
  log(`Java ${major} listo.`);
  return bin;
}
