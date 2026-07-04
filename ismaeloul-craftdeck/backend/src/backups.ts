import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
// archiver v7 es CJS (export =); sus tipos no casan con NodeNext+ESM, así que tipamos lo que usamos
interface Archive {
  on(event: 'error', cb: (err: Error) => void): void;
  pipe(dest: NodeJS.WritableStream): void;
  glob(pattern: string, opts: { cwd: string; ignore?: string[]; dot?: boolean }): void;
  finalize(): Promise<void>;
}
const archiver = createRequire(import.meta.url)('archiver') as (format: 'zip', opts?: { zlib?: { level?: number } }) => Archive;
import cron from 'node-cron';
import { BACKUPS_DIR } from './paths.js';
import { run } from './util.js';
import { listServers, getServer, serverDir, audit } from './store.js';
import { runtimeOf, sendCommand } from './instance.js';

// no tiene sentido meter en el zip lo que se puede volver a descargar
const EXCLUDE_DIRS = new Set(['libraries', 'versions', 'cache', 'logs', 'crash-reports']);
const NAME_RE = /^[A-Za-z0-9._-]+$/;

type Broadcast = (type: string, payload: unknown) => void;
let broadcastFn: Broadcast = () => {};
export function setBackupBroadcast(fn: Broadcast): void { broadcastFn = fn; }

function backupDir(id: string): string {
  return path.join(BACKUPS_DIR, id);
}

export interface BackupInfo { name: string; size: number; createdAt: string; auto: boolean }

export async function listBackups(id: string): Promise<BackupInfo[]> {
  try {
    const files = await readdir(backupDir(id));
    const infos = await Promise.all(files.filter((f) => f.endsWith('.zip')).map(async (f) => {
      const st = await stat(path.join(backupDir(id), f));
      return { name: f.replace(/\.zip$/, ''), size: st.size, createdAt: st.mtime.toISOString(), auto: f.startsWith('auto_') };
    }));
    return infos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

const inProgress = new Set<string>();

export async function makeBackup(id: string, auto = false): Promise<BackupInfo> {
  const meta = await getServer(id);
  if (!meta) throw new Error('Servidor no encontrado');
  if (inProgress.has(id)) throw new Error('Ya hay un backup en curso');
  inProgress.add(id);
  try {
    const running = runtimeOf(id).status === 'online';
    if (running) {
      sendCommand(id, 'save-off');
      sendCommand(id, 'save-all flush');
      await new Promise((r) => setTimeout(r, 3000)); // dar tiempo a que el server escriba los chunks
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const name = `${auto ? 'auto' : 'manual'}_${stamp}`;
    const dest = path.join(backupDir(id), `${name}.zip`);
    await mkdir(backupDir(id), { recursive: true });

    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(dest);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.glob('**/*', {
        cwd: serverDir(id),
        ignore: [...EXCLUDE_DIRS].map((d) => `${d}/**`).concat(['*.jar']),
        dot: true,
      });
      void archive.finalize();
    });

    if (running) sendCommand(id, 'save-on');
    const st = await stat(dest);
    await audit('database', `Creó un backup de ${meta.name} (${(st.size / 1048576).toFixed(1)} MB)`, 'ok');
    broadcastFn('backup', { id, name });
    return { name, size: st.size, createdAt: st.mtime.toISOString(), auto };
  } finally {
    inProgress.delete(id);
  }
}

function safeBackupPath(id: string, name: string): string {
  if (!NAME_RE.test(name)) throw new Error('Nombre de backup inválido');
  return path.join(backupDir(id), `${name}.zip`);
}

export async function restoreBackup(id: string, name: string): Promise<void> {
  const meta = await getServer(id);
  if (!meta) throw new Error('Servidor no encontrado');
  if (runtimeOf(id).status !== 'offline') throw new Error('Detén el servidor antes de restaurar');
  const zip = safeBackupPath(id, name);
  await stat(zip); // valida que existe
  // borrar los mundos actuales para que el restore sea limpio
  for (const dir of ['world', 'world_nether', 'world_the_end']) {
    await rm(path.join(serverDir(id), dir), { recursive: true, force: true });
  }
  const code = await run('tar', ['-xf', zip, '-C', serverDir(id)]);
  if (code !== 0) throw new Error(`Fallo extrayendo el backup (tar exit ${code})`);
  await audit('refresh', `Restauró el backup ${name} en ${meta.name}`, 'warn');
}

export async function deleteBackup(id: string, name: string): Promise<void> {
  await rm(safeBackupPath(id, name), { force: true });
  await audit('trash', `Eliminó el backup ${name}`, 'warn');
}

export function backupFilePath(id: string, name: string): string {
  return safeBackupPath(id, name);
}

async function pruneAuto(id: string, keep: number): Promise<void> {
  const autos = (await listBackups(id)).filter((b) => b.auto);
  for (const old of autos.slice(keep)) {
    await rm(path.join(backupDir(id), `${old.name}.zip`), { force: true });
  }
}

// backup automático diario a las 04:00 para los servers que lo tengan activado
export function scheduleAutoBackups(): void {
  cron.schedule('0 4 * * *', async () => {
    for (const meta of await listServers()) {
      if (meta.provision.status !== 'ready') continue;
      if (meta.backupAuto === false) continue;
      try {
        await makeBackup(meta.id, true);
        await pruneAuto(meta.id, meta.backupKeep ?? 7);
      } catch (err) {
        console.error(`[backup] ${meta.name}:`, err);
      }
    }
  });
}
