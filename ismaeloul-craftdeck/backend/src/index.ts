import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { rm } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { FRONTEND_DIR, BACKUPS_DIR, APP_VERSION } from './paths.js';
import { listVanillaVersions } from './catalog/vanilla.js';
import { listFabricGameVersions } from './catalog/fabric.js';
import { listForgeVersions } from './catalog/forge.js';
import { listNeoForgeVersions } from './catalog/neoforge.js';
import { provisionServer } from './provision.js';
import {
  setBroadcast, runtimeOf, consoleOf, startServer, stopServer, sendCommand, stopAll,
} from './instance.js';
import { playerLists, playerAction } from './players.js';
import {
  listBackups, makeBackup, restoreBackup, deleteBackup, backupFilePath,
  scheduleAutoBackups, setBackupBroadcast,
} from './backups.js';
import {
  readProperties, writeProperties, listEditableFiles, readEditableFile, writeEditableFile,
} from './properties.js';
import {
  Loader, ServerMeta, listServers, getServer, addServer, removeServer, updateServer,
  serverDir, nextFreePort, audit, readAudit,
} from './store.js';

const PORT = Number(process.env.PORT ?? 8449);
const LOADERS: Loader[] = ['vanilla', 'fabric', 'forge', 'neoforge'];

const app = express();
app.use(express.json());

// ---- eventos en vivo ----
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
export function broadcast(type: string, payload: unknown): void {
  const msg = JSON.stringify({ type, ...(payload as object) });
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(msg);
}

const asyncRoute = (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response) => {
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    });
  };

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'craftdeck', version: APP_VERSION });
});

// ---- catálogo de versiones ----
app.get('/api/catalog/:loader', asyncRoute(async (req, res) => {
  const loader = req.params.loader as Loader;
  switch (loader) {
    case 'vanilla':
      res.json({ loader, versions: (await listVanillaVersions()).map((v) => v.id) });
      return;
    case 'fabric':
      res.json({ loader, versions: await listFabricGameVersions() });
      return;
    case 'forge':
      res.json({ loader, versions: (await listForgeVersions()).map((v) => v.mc) });
      return;
    case 'neoforge':
      res.json({ loader, versions: (await listNeoForgeVersions()).map((v) => v.mc) });
      return;
    default:
      res.status(400).json({ error: `Loader desconocido: ${String(loader)}` });
  }
}));

// ---- servidores ----
app.get('/api/servers', asyncRoute(async (_req, res) => {
  const all = await listServers();
  res.json(all.map((s) => ({ ...s, runtime: runtimeOf(s.id) })));
}));

app.get('/api/servers/:id', asyncRoute(async (req, res) => {
  const meta = await getServer(req.params.id!);
  if (!meta) { res.status(404).json({ error: 'Servidor no encontrado' }); return; }
  res.json({ ...meta, runtime: runtimeOf(meta.id) });
}));

// ---- ciclo de vida ----
app.post('/api/servers/:id/start', asyncRoute(async (req, res) => {
  await startServer(req.params.id!);
  res.json({ ok: true });
}));

app.post('/api/servers/:id/stop', asyncRoute(async (req, res) => {
  await stopServer(req.params.id!);
  await audit('stop', 'Detuvo el servidor', 'warn');
  res.json({ ok: true });
}));

app.post('/api/servers/:id/restart', asyncRoute(async (req, res) => {
  await stopServer(req.params.id!);
  await startServer(req.params.id!);
  res.json({ ok: true });
}));

app.post('/api/servers/:id/command', asyncRoute(async (req, res) => {
  const { command } = req.body as { command?: string };
  if (!command?.trim()) { res.status(400).json({ error: 'Comando vacío' }); return; }
  sendCommand(req.params.id!, command.trim());
  await audit('terminal', `Ejecutó /${command.trim()}`, 'info');
  res.json({ ok: true });
}));

app.get('/api/servers/:id/console', asyncRoute(async (req, res) => {
  res.json({ lines: consoleOf(req.params.id!) });
}));

// ---- jugadores ----
app.get('/api/servers/:id/players', asyncRoute(async (req, res) => {
  const id = req.params.id!;
  res.json({ online: runtimeOf(id).players, ...(await playerLists(id)) });
}));

app.post('/api/servers/:id/players/:name/:action', asyncRoute(async (req, res) => {
  const { reason } = (req.body ?? {}) as { reason?: string };
  await playerAction(req.params.id!, req.params.action!, req.params.name!, reason);
  res.json({ ok: true });
}));

app.post('/api/servers', asyncRoute(async (req, res) => {
  const { name, loader, version, memoryMb, acceptEula } = req.body as {
    name?: string; loader?: Loader; version?: string; memoryMb?: number; acceptEula?: boolean;
  };
  if (!name?.trim()) { res.status(400).json({ error: 'Falta el nombre del servidor' }); return; }
  if (!loader || !LOADERS.includes(loader)) { res.status(400).json({ error: 'Loader inválido' }); return; }
  if (!version) { res.status(400).json({ error: 'Falta la versión de Minecraft' }); return; }
  if (!acceptEula) { res.status(400).json({ error: 'Debes aceptar la EULA de Mojang' }); return; }

  const meta: ServerMeta = {
    id: crypto.randomUUID().slice(0, 8),
    name: name.trim(),
    loader,
    mcVersion: version,
    javaMajor: 21,
    port: await nextFreePort(),
    memoryMb: Math.min(Math.max(memoryMb ?? 2048, 1024), 16384),
    createdAt: new Date().toISOString(),
    provision: { status: 'creating', log: [] },
  };
  await addServer(meta);
  void provisionServer(meta, broadcast); // continúa en segundo plano
  res.status(201).json(meta);
}));

app.delete('/api/servers/:id', asyncRoute(async (req, res) => {
  const meta = await getServer(req.params.id!);
  if (!meta) { res.status(404).json({ error: 'Servidor no encontrado' }); return; }
  await stopServer(meta.id);
  await removeServer(meta.id);
  await rm(serverDir(meta.id), { recursive: true, force: true });
  await rm(path.join(BACKUPS_DIR, meta.id), { recursive: true, force: true });
  await audit('trash', `Eliminó el servidor ${meta.name}`, 'warn');
  broadcast('servers', {});
  res.json({ ok: true });
}));

app.delete('/api/servers/:id/world', asyncRoute(async (req, res) => {
  const id = req.params.id!;
  const meta = await getServer(id);
  if (!meta) { res.status(404).json({ error: 'Servidor no encontrado' }); return; }
  if (runtimeOf(id).status !== 'offline') { res.status(400).json({ error: 'Detén el servidor antes de borrar el mundo' }); return; }
  for (const d of ['world', 'world_nether', 'world_the_end']) {
    await rm(path.join(serverDir(id), d), { recursive: true, force: true });
  }
  await audit('trash', `Borró el mundo de ${meta.name}`, 'warn');
  res.json({ ok: true });
}));

// ---- server.properties ----
app.get('/api/servers/:id/properties', asyncRoute(async (req, res) => {
  res.json(await readProperties(req.params.id!));
}));

app.put('/api/servers/:id/properties', asyncRoute(async (req, res) => {
  const patch = req.body as Record<string, unknown>;
  if (!patch || typeof patch !== 'object') { res.status(400).json({ error: 'Body inválido' }); return; }
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!/^[a-z0-9.-]+$/i.test(k) || /[\r\n]/.test(String(v))) { res.status(400).json({ error: `Clave o valor inválido: ${k}` }); return; }
    clean[k] = String(v);
  }
  await writeProperties(req.params.id!, clean);
  await audit('save', 'Modificó server.properties', 'info');
  res.json({ ok: true });
}));

// ---- editor de archivos ----
app.get('/api/servers/:id/files', asyncRoute(async (req, res) => {
  res.json({ files: await listEditableFiles(req.params.id!) });
}));

app.get('/api/servers/:id/file', asyncRoute(async (req, res) => {
  const rel = String(req.query.path ?? '');
  res.json({ path: rel, content: await readEditableFile(req.params.id!, rel) });
}));

app.put('/api/servers/:id/file', asyncRoute(async (req, res) => {
  const { path: rel, content } = req.body as { path?: string; content?: string };
  if (!rel || typeof content !== 'string') { res.status(400).json({ error: 'Faltan path o content' }); return; }
  await writeEditableFile(req.params.id!, rel, content);
  await audit('save', `Editó ${rel}`, 'info');
  res.json({ ok: true });
}));

// ---- backups ----
app.get('/api/servers/:id/backups', asyncRoute(async (req, res) => {
  res.json(await listBackups(req.params.id!));
}));

app.post('/api/servers/:id/backups', asyncRoute(async (req, res) => {
  res.status(201).json(await makeBackup(req.params.id!));
}));

app.post('/api/servers/:id/backups/:name/restore', asyncRoute(async (req, res) => {
  await restoreBackup(req.params.id!, req.params.name!);
  res.json({ ok: true });
}));

app.delete('/api/servers/:id/backups/:name', asyncRoute(async (req, res) => {
  await deleteBackup(req.params.id!, req.params.name!);
  res.json({ ok: true });
}));

app.get('/api/servers/:id/backups/:name/download', asyncRoute(async (req, res) => {
  res.download(backupFilePath(req.params.id!, req.params.name!));
}));

app.put('/api/servers/:id/backup-settings', asyncRoute(async (req, res) => {
  const { auto, keep } = req.body as { auto?: boolean; keep?: number };
  const meta = await getServer(req.params.id!);
  if (!meta) { res.status(404).json({ error: 'Servidor no encontrado' }); return; }
  await updateServer(meta.id, {
    backupAuto: auto ?? meta.backupAuto,
    backupKeep: keep !== undefined ? Math.min(Math.max(keep, 1), 30) : meta.backupKeep,
  });
  res.json({ ok: true });
}));

// ---- auditoría ----
app.get('/api/audit', asyncRoute(async (_req, res) => {
  res.json(await readAudit());
}));

app.use(express.static(FRONTEND_DIR));

setBroadcast(broadcast);
setBackupBroadcast(broadcast);
scheduleAutoBackups();

httpServer.listen(PORT, () => {
  console.log(`[craftdeck] panel en http://localhost:${PORT}`);
});

// parada limpia: detener los servidores antes de salir
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void stopAll().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 35_000).unref();
  });
}
