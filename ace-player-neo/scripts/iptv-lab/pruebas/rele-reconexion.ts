/* Prueba aislada del relé IPTV al RECONECTAR (apps/server/src/modules/iptv/relay.ts, TsSession).

     node node_modules/tsx/dist/cli.mjs scripts/iptv-lab/pruebas/rele-reconexion.ts [sin-pcr|con-pcr] [clip.ts]

   Un origen local manda TS de verdad (el clip del laboratorio) 5 s y corta; a la reconexión:
   - `sin-pcr` (por defecto): el primer trozo son 10 paquetes nulos (sin PCR) y luego el TS normal;
   - `con-pcr`: el TS normal desde el principio (su primer trozo de socket puede no traer PCR igualmente:
     con el muxer de ffmpeg hay un PCR cada 80 ms, 65 KB a 6,6 Mbit/s, y un trozo de socket es de 16-64 KB).
   Un «ffmpeg» falso lee in.ts y cada segundo se dice cuánto le llega.

   Lo esperado si el relé está bien: tras la reconexión vuelven a llegar ~800 KB/s (o sale onRestart /
   onDropped). Con el relé de la 0.8.2 se queda en 0 KB/s para siempre con `reconnecting=true`: adopt()
   espera el segundo trozo con firstChunk() sobre un cuerpo que la llamada anterior dejó en pause(), y
   on('data') no reanuda un flujo pausado a mano (readableFlowing === false). */

import { readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../../apps/server/src/config/index.js';
import { createDomainBus } from '../../../apps/server/src/core/bus.js';
import { createSystemClock } from '../../../apps/server/src/core/clock.js';
import { createSilentLogger } from '../../../apps/server/src/core/logger.js';
import { PcrTracker } from '../../../apps/server/src/modules/iptv/hls.js';
import { createIptvRelay } from '../../../apps/server/src/modules/iptv/relay.js';
import { createNetClient } from '../../../apps/server/src/modules/net/index.js';
import { fakeIptvResolver, fakeIptvTransport } from '../../../apps/server/test/fake-iptv/net.js';

const mode = process.argv[2] === 'con-pcr' ? 'con-pcr' : 'sin-pcr';
const cache = process.env.IPTV_LAB_CACHE ?? path.join(os.tmpdir(), 'iptv-lab-cache');
const clipPath =
  process.argv[3] ??
  path.join(cache, readdirSync(cache).find((f) => /^clip-1920x1080-25-g2-.*\.ts$/.test(f)) ?? '');
const clip = readFileSync(clipPath);
const bps = Math.round(clip.length / 300);
const T0 = Date.now();
const log = (line: string): void => {
  process.stdout.write(`${((Date.now() - T0) / 1000).toFixed(2).padStart(6)} ${line}\n`);
};

let conns = 0;
const nullPacket = Buffer.alloc(188, 0xff);
nullPacket[0] = 0x47;
nullPacket[1] = 0x1f;
nullPacket[2] = 0xff;
nullPacket[3] = 0x10;
const origin = http.createServer((_req, res) => {
  const n = ++conns;
  log(`origen: conexión ${n}`);
  res.writeHead(200, { 'content-type': 'video/mp2t' });
  let pos = n === 1 ? 0 : 5 * bps;
  pos -= pos % 188;
  const send = (): void => {
    let end = Math.min(clip.length, pos + Math.round(bps / 25));
    end -= (end - pos) % 188;
    res.write(clip.subarray(pos, end));
    pos = end;
  };
  if (n >= 2 && mode === 'sin-pcr') {
    res.write(Buffer.concat(Array.from({ length: 10 }, () => nullPacket)));
    log('origen: primer trozo = 10 paquetes nulos (sin PCR)');
  }
  const timer = setInterval(send, 40);
  if (n === 1)
    setTimeout(() => {
      clearInterval(timer);
      res.destroy();
      log('origen: corta la conexión 1');
    }, 5000);
  res.on('close', () => clearInterval(timer));
});
await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve));
const port = (origin.address() as { port: number }).port;

process.env.DATA_DIR ??= path.join(os.tmpdir(), 'iptv-lab-rele');
const clock = createSystemClock();
const logger = createSilentLogger();
const core = { config: loadConfig(process.env).config, clock, logger, bus: createDomainBus({ logger }) };
const net = createNetClient({
  ...core,
  resolver: fakeIptvResolver(),
  transport: fakeIptvTransport({ host: '127.0.0.1', port }),
});
const relay = createIptvRelay({ clock, logger, net, policy: () => ({ lan: false }) });
await relay.start();
const session = await relay.open({
  variants: [{ entryId: 'x', url: 'http://iptv.ace-e2e.example:8080/live/u/p/1.ts', headers: {} }],
});
session.onRestart(() => log('relé: onRestart'));
session.onDropped((code) => log(`relé: onDropped ${code}`));
const internals = session as unknown as {
  reconnecting: boolean;
  upstream: unknown;
  adopt: (opened: { body: NodeJS.ReadableStream & { readableFlowing: boolean | null; readableLength: number } }, force: boolean) => Promise<void>;
};
let adoptBody: { readableFlowing: boolean | null; readableLength: number } | null = null;
const originalAdopt = internals.adopt.bind(session);
internals.adopt = (opened, force) => {
  adoptBody = opened.body;
  log('relé: adopt() empieza');
  const result = originalAdopt(opened, force);
  result.then(
    () => log('relé: adopt() termina'),
    (error: unknown) => log(`relé: adopt() falla ${String(error)}`),
  );
  return result;
};

let bytes = 0;
const pcr = new PcrTracker();
http.get(session.inputUrl, (res) => {
  res.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    pcr.push(chunk);
  });
});
let last = 0;
let zeroSeconds = 0;
const tick = setInterval(() => {
  const kbs = (bytes - last) / 1000;
  last = bytes;
  if (conns >= 2 && kbs === 0) zeroSeconds += 1;
  log(
    `«ffmpeg» recibe ${kbs.toFixed(0)} KB/s · reconnecting=${internals.reconnecting} upstream=${internals.upstream !== null}` +
      (adoptBody ? ` · cuerpo nuevo flowing=${adoptBody.readableFlowing} en espera=${adoptBody.readableLength} B` : ''),
  );
}, 1000);
setTimeout(async () => {
  clearInterval(tick);
  const hung = zeroSeconds >= 10 && internals.reconnecting;
  log(
    hung
      ? `RESULTADO: el relé se ha COLGADO al reconectar (${zeroSeconds} s sin mandar nada a ffmpeg, reconnecting=true)`
      : `RESULTADO: el relé siguió (${zeroSeconds} s a 0)`,
  );
  await session.close();
  await relay.stop();
  origin.closeAllConnections();
  origin.close();
  process.exit(hung ? 1 : 0);
}, 22_000);
