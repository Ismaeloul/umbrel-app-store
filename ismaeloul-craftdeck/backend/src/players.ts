import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { serverDir, audit } from './store.js';
import { sendCommand } from './instance.js';

const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;

async function readJsonList(id: string, file: string): Promise<Record<string, string>[]> {
  try {
    return JSON.parse(await readFile(path.join(serverDir(id), file), 'utf8'));
  } catch {
    return [];
  }
}

export async function playerLists(id: string): Promise<{
  ops: string[]; whitelist: string[]; banned: { name: string; reason?: string }[];
}> {
  const [ops, whitelist, banned] = await Promise.all([
    readJsonList(id, 'ops.json'),
    readJsonList(id, 'whitelist.json'),
    readJsonList(id, 'banned-players.json'),
  ]);
  return {
    ops: ops.map((o) => o.name!),
    whitelist: whitelist.map((w) => w.name!),
    banned: banned.map((b) => ({ name: b.name!, reason: b.reason })),
  };
}

const ACTIONS: Record<string, { cmd: (name: string, reason?: string) => string; audit: string; level: 'info' | 'warn' | 'err' }> = {
  kick: { cmd: (n, r) => `kick ${n}${r ? ' ' + r : ''}`, audit: 'Expulsó a', level: 'warn' },
  ban: { cmd: (n, r) => `ban ${n}${r ? ' ' + r : ''}`, audit: 'Baneó a', level: 'err' },
  pardon: { cmd: (n) => `pardon ${n}`, audit: 'Quitó el ban a', level: 'info' },
  op: { cmd: (n) => `op ${n}`, audit: 'Dio OP a', level: 'warn' },
  deop: { cmd: (n) => `deop ${n}`, audit: 'Quitó OP a', level: 'warn' },
  'whitelist-add': { cmd: (n) => `whitelist add ${n}`, audit: 'Añadió a la whitelist a', level: 'info' },
  'whitelist-remove': { cmd: (n) => `whitelist remove ${n}`, audit: 'Quitó de la whitelist a', level: 'info' },
};

export async function playerAction(id: string, action: string, name: string, reason?: string): Promise<void> {
  const spec = ACTIONS[action];
  if (!spec) throw new Error(`Acción desconocida: ${action}`);
  if (!NAME_RE.test(name)) throw new Error('Nombre de jugador inválido');
  if (reason && /[\r\n]/.test(reason)) throw new Error('Razón inválida');
  sendCommand(id, spec.cmd(name, reason));
  await audit(action === 'ban' ? 'ban' : action === 'kick' ? 'logout' : 'crown', `${spec.audit} ${name}`, spec.level);
}
