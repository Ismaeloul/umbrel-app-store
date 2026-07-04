import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import pidusage from 'pidusage';
import { ServerMeta, getServer, serverDir, audit } from './store.js';
import { ensureJre } from './java.js';

export type RunStatus = 'offline' | 'starting' | 'online' | 'stopping';
type Broadcast = (type: string, payload: unknown) => void;

export interface OnlinePlayer { name: string; joinedAt: number }

interface Instance {
  proc: ChildProcess | null;
  status: RunStatus;
  startedAt: number | null;
  console: string[];
  players: OnlinePlayer[];
}

const instances = new Map<string, Instance>();
let broadcastFn: Broadcast = () => {};
export function setBroadcast(fn: Broadcast): void { broadcastFn = fn; }

function inst(id: string): Instance {
  let i = instances.get(id);
  if (!i) {
    i = { proc: null, status: 'offline', startedAt: null, console: [], players: [] };
    instances.set(id, i);
  }
  return i;
}

export function runtimeOf(id: string): { status: RunStatus; players: OnlinePlayer[]; uptimeSec: number } {
  const i = inst(id);
  return {
    status: i.status,
    players: i.players,
    uptimeSec: i.startedAt ? Math.floor((Date.now() - i.startedAt) / 1000) : 0,
  };
}

export function consoleOf(id: string): string[] {
  return inst(id).console;
}

function pushLine(id: string, i: Instance, line: string): void {
  i.console.push(line);
  if (i.console.length > 400) i.console.shift();
  broadcastFn('console', { id, line });

  if (i.status === 'starting' && /Done \([\d.,]+\s*s(econds)?\)!/.test(line)) {
    i.status = 'online';
    broadcastFn('status', { id, status: 'online' });
  }
  let m = line.match(/\]:?\s(\S{1,16}) joined the game/);
  if (m) {
    if (!i.players.some((p) => p.name === m![1])) i.players.push({ name: m[1]!, joinedAt: Date.now() });
    broadcastFn('players', { id, players: i.players });
  }
  m = line.match(/\]:?\s(\S{1,16}) left the game/);
  if (m) {
    i.players = i.players.filter((p) => p.name !== m![1]);
    broadcastFn('players', { id, players: i.players });
  }
}

function launchArgs(meta: ServerMeta): string[] {
  const mem = `${meta.memoryMb}M`;
  if (meta.launch!.type === 'jar') {
    return [`-Xmx${mem}`, '-jar', meta.launch!.jar, 'nogui'];
  }
  const argsFile = path.join(
    ...meta.launch!.argsDir.split('/'),
    process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt',
  );
  return [`-Xmx${mem}`, `@${argsFile}`, 'nogui'];
}

export async function startServer(id: string): Promise<void> {
  const meta = await getServer(id);
  if (!meta) throw new Error('Servidor no encontrado');
  if (meta.provision.status !== 'ready' || !meta.launch) throw new Error('El servidor aún no está aprovisionado');
  const i = inst(id);
  if (i.proc) throw new Error('El servidor ya está en marcha');

  const java = await ensureJre(meta.javaMajor, (m) => pushLine(id, i, `[CraftDeck] ${m}`));
  i.status = 'starting';
  i.startedAt = Date.now();
  i.players = [];
  broadcastFn('status', { id, status: 'starting' });
  pushLine(id, i, `[CraftDeck] Arrancando ${meta.name} (${meta.loader} ${meta.mcVersion}, ${meta.memoryMb} MB)…`);

  const proc = spawn(java, launchArgs(meta), { cwd: serverDir(id), stdio: ['pipe', 'pipe', 'pipe'] });
  i.proc = proc;

  let buf = '';
  const onData = (chunk: Buffer) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.trim()) pushLine(id, i, line);
    }
  };
  proc.stdout!.on('data', onData);
  proc.stderr!.on('data', onData);

  proc.on('close', (code) => {
    const wasStopping = i.status === 'stopping';
    const crashed = !wasStopping && code !== 0;
    i.proc = null;
    i.status = 'offline';
    i.startedAt = null;
    i.players = [];
    pushLine(id, i, crashed
      ? `[CraftDeck] El servidor terminó inesperadamente (código ${code})`
      : '[CraftDeck] Servidor detenido.');
    broadcastFn('status', { id, status: 'offline', crashed: crashed || undefined });
    if (crashed) void audit('alert', `${meta.name} se cerró inesperadamente (código ${code})`, 'err');
  });
  proc.on('error', (err) => {
    pushLine(id, i, `[CraftDeck] Error lanzando Java: ${err.message}`);
  });

  await audit('play', `Inició el servidor ${meta.name}`, 'ok');
}

export function stopServer(id: string): Promise<void> {
  const i = inst(id);
  const proc = i.proc;
  if (!proc) return Promise.resolve();
  i.status = 'stopping';
  broadcastFn('status', { id, status: 'stopping' });
  proc.stdin!.write('stop\n');
  return new Promise((resolve) => {
    const killer = setTimeout(() => proc.kill(), 30_000);
    proc.once('close', () => { clearTimeout(killer); resolve(); });
  });
}

export function sendCommand(id: string, cmd: string): void {
  const i = inst(id);
  if (!i.proc || i.status === 'offline') throw new Error('El servidor no está en marcha');
  i.proc.stdin!.write(cmd + '\n');
  pushLine(id, i, `> ${cmd}`);
}

export function anyRunning(): boolean {
  return [...instances.values()].some((i) => i.proc);
}

export async function stopAll(): Promise<void> {
  await Promise.all([...instances.keys()].map((id) => stopServer(id)));
}

// métricas de proceso cada 3 s para los servidores en marcha
setInterval(() => {
  for (const [id, i] of instances) {
    if (!i.proc?.pid) continue;
    pidusage(i.proc.pid)
      .then((s) => broadcastFn('metrics', {
        id,
        cpu: Math.round(s.cpu * 10) / 10,
        memMb: Math.round(s.memory / 1048576),
        uptimeSec: i.startedAt ? Math.floor((Date.now() - i.startedAt) / 1000) : 0,
        players: i.players.length,
      }))
      .catch(() => { /* el proceso acaba de morir */ });
  }
}, 3000);
