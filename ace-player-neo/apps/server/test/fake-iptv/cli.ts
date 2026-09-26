/* Proveedor IPTV falso como proceso aparte, para probar a mano en el PC
   (docs/iptv.md §9.2):

     tsx apps/server/test/fake-iptv/cli.ts --host 192.168.1.50 --port 7300

   Escucha en la IP de RED LOCAL del PC y no en 127.0.0.1: la IPTV bloquea
   siempre loopback (docs/iptv.md §3.1). El backend tiene que arrancar con
   ALLOW_PRIVATE_SYNC_URLS=true para aceptar una IP de casa.

   Opciones: --host, --port (7300), --max-conexiones (1), --retener-ms (0) y
   --grande N (catálogo grande de la pestaña IPTV, docs/iptv.md §16.9: N
   canales más, con nombres como los de una lista real).
   Control por HTTP: /__iptv/modo?id=104&modo=down, /__iptv/conexiones,
   /__iptv/peticiones y /__iptv/fallar-primera?veces=1&como=502 (§16.8). */

import os from 'node:os';
import { FAKE_IPTV_PASSWORD, FAKE_IPTV_USER, createFakeIptv } from './provider.js';

function option(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? (args[index + 1] as string) : fallback;
}

/* Por defecto, la primera IPv4 de red local del PC (no loopback). */
function lanIp(): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
}

const host = option('host', lanIp());
const port = Number(option('port', '7300'));
const maxConnections = Number(option('max-conexiones', '1'));
const retenerPlazaMs = Number(option('retener-ms', '0'));
const grande = Number(option('grande', '0'));

const print = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

try {
  const fake = await createFakeIptv({
    host,
    port,
    maxConnections,
    retenerPlazaMs,
    ...(grande > 0 ? { grande } : {}),
  });
  print(`proveedor IPTV falso en ${fake.baseUrl}`);
  if (grande > 0) print(`  Catálogo grande: ${fake.grandes.length} canales más`);
  print(`  Lista M3U:     ${fake.m3uUrl}`);
  print(`  M3U get.php:   ${fake.getPhpUrl}`);
  print(
    `  Xtream:        servidor ${fake.server} · usuario ${FAKE_IPTV_USER} · contraseña ${FAKE_IPTV_PASSWORD}`,
  );
  print('  (datos de prueba; el backend necesita ALLOW_PRIVATE_SYNC_URLS=true con una IP de casa)');
  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    print(`proveedor IPTV falso: ${signal}, cerrando`);
    fake.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
} catch (error) {
  process.stderr.write(
    `proveedor IPTV falso: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
