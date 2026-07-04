import { createWriteStream } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': 'craftdeck/0.1' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.json() as Promise<T>;
}

export async function download(url: string, dest: string): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': 'craftdeck/0.1' } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} descargando ${url}`);
  const tmp = dest + '.part';
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  await rename(tmp, dest);
}

export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; onLine?: (line: string) => void } = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const feed = (chunk: Buffer) => {
      if (!opts.onLine) return;
      for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) opts.onLine(line);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? -1));
  });
}

/** Compara versiones tipo "1.20.4" numéricamente. */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
