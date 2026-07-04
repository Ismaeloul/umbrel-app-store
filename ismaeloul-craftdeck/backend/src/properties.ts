import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { serverDir } from './store.js';

const PROPS_FILE = 'server.properties';

export async function readProperties(id: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const raw = await readFile(path.join(serverDir(id), PROPS_FILE), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  } catch { /* aún no existe */ }
  return out;
}

/** Actualiza claves preservando comentarios y orden del archivo. */
export async function writeProperties(id: string, patch: Record<string, string>): Promise<void> {
  const file = path.join(serverDir(id), PROPS_FILE);
  let lines: string[] = [];
  try {
    lines = (await readFile(file, 'utf8')).split(/\r?\n/);
  } catch { /* archivo nuevo */ }
  const pending = new Map(Object.entries(patch));
  lines = lines.map((line) => {
    if (!line || line.startsWith('#')) return line;
    const eq = line.indexOf('=');
    if (eq <= 0) return line;
    const key = line.slice(0, eq).trim();
    if (!pending.has(key)) return line;
    const val = pending.get(key)!;
    pending.delete(key);
    return `${key}=${val}`;
  });
  for (const [key, val] of pending) lines.push(`${key}=${val}`);
  await writeFile(file, lines.join('\n').replace(/\n*$/, '\n'));
}

/* ---- editor de archivos (restringido) ---- */
const EDITABLE_RE = /\.(properties|json|yml|yaml|toml|txt|conf|cfg)$/i;
const MAX_SIZE = 512 * 1024;

function resolveInside(id: string, rel: string): string {
  const base = serverDir(id);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('Ruta fuera del servidor');
  return abs;
}

export async function listEditableFiles(id: string): Promise<string[]> {
  const base = serverDir(id);
  const found: string[] = [];
  async function walk(rel: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(path.join(base, rel), { withFileTypes: true });
    } catch { return; }
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const isConfigRoot = rel === '' && ['config', 'defaultconfigs'].includes(e.name);
        if ((isConfigRoot || rel !== '') && depth > 0) await walk(relPath, depth - 1);
      } else if (EDITABLE_RE.test(e.name)) {
        found.push(relPath);
      }
    }
  }
  await walk('', 3);
  return found.sort((a, b) => (a.includes('/') === b.includes('/') ? a.localeCompare(b) : a.includes('/') ? 1 : -1));
}

export async function readEditableFile(id: string, rel: string): Promise<string> {
  const abs = resolveInside(id, rel);
  if (!EDITABLE_RE.test(abs)) throw new Error('Tipo de archivo no editable');
  const st = await stat(abs);
  if (st.size > MAX_SIZE) throw new Error('Archivo demasiado grande para el editor');
  return readFile(abs, 'utf8');
}

export async function writeEditableFile(id: string, rel: string, content: string): Promise<void> {
  const abs = resolveInside(id, rel);
  if (!EDITABLE_RE.test(abs)) throw new Error('Tipo de archivo no editable');
  if (content.length > MAX_SIZE) throw new Error('Contenido demasiado grande');
  await writeFile(abs, content);
}
