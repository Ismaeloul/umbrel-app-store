/* El backend deja de ser root nada más arrancar (endurecimiento de la 0.9.12).

   Por qué: desde la 0.9.5 la sala de «Ver juntos» llega desde internet hasta
   este proceso (Caddy → storage:3000). Si algún día un fallo del código dejara
   ejecutar algo, mejor que sea como un usuario sin privilegios que como el
   root del contenedor.

   Docker arranca storage como root porque antes hace `apk add ffmpeg`. Con
   `ACE_RUN_AS=<uid>:<gid>` en el entorno, `main` llama a `dropRoot` antes de
   abrir ningún fichero:
   1. pone a ese usuario como dueño de lo que haya en DATA_DIR (lo que crearon
      las versiones que corrían como root); sin seguir enlaces y sin tocar lo
      que ya es suyo, así que a partir del segundo arranque no cambia nada;
   2. `setgroups` + `setgid` + `setuid`: el proceso (y el ffmpeg que lance) ya
      no es root y no puede volver a serlo (`no-new-privileges` del compose).

   Grupos de más (`ACE_RUN_GROUPS`, docs/ver-juntos.md §17.6): `setgroups`
   dejaba solo el gid de `ACE_RUN_AS` y se perdían los del `group_add` del
   compose (render y video), sin los que ffmpeg no abre la gráfica
   (`/dev/dri/renderD128`). Lista separada por comas de gid y/o `dri`: `dri` son
   los grupos dueños de `/dev/dri/card*` y `/dev/dri/renderD*` (los de este NAS
   u otro, sin escribir números a mano). Nunca el 0 (root); lo que no vale se
   ignora con un aviso en el resultado.

   Si algo falla se sigue como root y se avisa en el registro: una app que no
   arranca es peor que una app sin esta capa de más. */

import { lchownSync, lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Lo que `dropRoot` necesita del sistema (en los tests, falsos). */
export interface PrivilegeOps {
  getuid(): number;
  setgroups(groups: number[]): void;
  setgid(gid: number): void;
  setuid(uid: number): void;
  lstat(file: string): { uid: number; gid: number; isDirectory(): boolean };
  lchown(file: string, uid: number, gid: number): void;
  readdir(dir: string): string[];
}

export type DropResult =
  | { readonly status: 'off' }
  | { readonly status: 'not-root' }
  | {
      readonly status: 'dropped';
      readonly uid: number;
      readonly gid: number;
      /** Todos los grupos que se quedan (el gid y los de `ACE_RUN_GROUPS`). */
      readonly groups: readonly number[];
      readonly chowned: number;
      /** Lo de `ACE_RUN_GROUPS` que no valía (se ignora). */
      readonly ignored?: readonly string[];
    }
  | { readonly status: 'failed'; readonly reason: string };

/** `"1000:1000"` → `{ uid: 1000, gid: 1000 }`; cualquier otra cosa, null. */
export function parseRunAs(value: string | undefined): { uid: number; gid: number } | null {
  const match = /^\s*(\d{1,10}):(\d{1,10})\s*$/.exec(value ?? '');
  if (!match) return null;
  const uid = Number(match[1]);
  const gid = Number(match[2]);
  return uid > 0 && gid > 0 ? { uid, gid } : null;
}

/** Dónde están los nodos de la gráfica (para `dri`). */
export const DRI_DIR = '/dev/dri';
const DRI_NODE_RE = /^(card|renderD)\d+$/;

/**
 * `ACE_RUN_GROUPS` → los gid de más (sin repetir, sin 0) y lo que no valía. `dri` lee los dueños de
 * los nodos de `/dev/dri` (sin `/dev/dri`, ninguno).
 */
export function resolveRunGroups(
  value: string | undefined,
  ops: Pick<PrivilegeOps, 'lstat' | 'readdir'>,
): { groups: number[]; ignored: string[] } {
  const groups = new Set<number>();
  const ignored: string[] = [];
  for (const raw of (value ?? '').split(',')) {
    const token = raw.trim().toLowerCase();
    if (!token) continue;
    if (token === 'dri') {
      let names: string[];
      try {
        names = ops.readdir(DRI_DIR);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!DRI_NODE_RE.test(name)) continue;
        try {
          const gid = ops.lstat(path.posix.join(DRI_DIR, name)).gid;
          if (gid > 0) groups.add(gid);
        } catch {}
      }
      continue;
    }
    if (/^\d{1,10}$/.test(token) && Number(token) > 0) groups.add(Number(token));
    else ignored.push(raw.trim());
  }
  return { groups: [...groups], ignored };
}

function nodeOps(): PrivilegeOps | null {
  const { getuid, setgroups, setgid, setuid } = process;
  if (!getuid || !setgroups || !setgid || !setuid) return null;
  return {
    getuid: () => getuid(),
    setgroups: (groups) => setgroups(groups),
    setgid: (gid) => setgid(gid),
    setuid: (uid) => setuid(uid),
    lstat: (file) => lstatSync(file),
    lchown: (file, uid, gid) => lchownSync(file, uid, gid),
    readdir: (dir) => readdirSync(dir),
  };
}

/** Pone `uid:gid` como dueño de `root` y de todo lo de dentro. Devuelve cuántos cambió. */
function chownTree(ops: PrivilegeOps, root: string, uid: number, gid: number): number {
  let changed = 0;
  const pending = [root];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    let stat: ReturnType<PrivilegeOps['lstat']>;
    try {
      stat = ops.lstat(file);
    } catch (error) {
      /* La carpeta de datos aún no existe (primera instalación): ya la creará el usuario nuevo. */
      if (file === root && (error as NodeJS.ErrnoException).code === 'ENOENT') return changed;
      throw error;
    }
    if (stat.uid !== uid || stat.gid !== gid) {
      ops.lchown(file, uid, gid);
      changed += 1;
    }
    if (stat.isDirectory()) {
      for (const name of ops.readdir(file)) pending.push(path.join(file, name));
    }
  }
  return changed;
}

/**
 * Deja de ser root si `ACE_RUN_AS` lo pide. Nunca lanza: devuelve qué pasó
 * para que `main` lo anote cuando ya tenga registro.
 */
export function dropRoot(
  env: Readonly<Record<string, string | undefined>>,
  dataDir: string,
  ops: PrivilegeOps | null = nodeOps(),
): DropResult {
  const raw = env.ACE_RUN_AS;
  if (raw === undefined || raw.trim() === '') return { status: 'off' };
  const target = parseRunAs(raw);
  if (!target)
    return { status: 'failed', reason: `ACE_RUN_AS no vale: "${raw}" (uid:gid, sin root)` };
  if (!ops) return { status: 'failed', reason: 'este sistema no permite cambiar de usuario' };
  if (ops.getuid() !== 0) return { status: 'not-root' };
  try {
    const chowned = chownTree(ops, dataDir, target.uid, target.gid);
    const extra = resolveRunGroups(env.ACE_RUN_GROUPS, ops);
    const groups = [target.gid, ...extra.groups.filter((gid) => gid !== target.gid)];
    ops.setgroups(groups);
    ops.setgid(target.gid);
    ops.setuid(target.uid);
    return {
      status: 'dropped',
      uid: target.uid,
      gid: target.gid,
      groups,
      chowned,
      ...(extra.ignored.length ? { ignored: extra.ignored } : {}),
    };
  } catch (error) {
    return { status: 'failed', reason: (error as Error).message };
  }
}
