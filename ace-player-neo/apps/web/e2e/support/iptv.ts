/* El proveedor IPTV falso de la pila E2E (apps/server/test/fake-iptv), en su
   propio proceso como los motores. Escucha en [::1]:<iptv> (por ::1: en el PC
   de Isma 127.0.0.1 corta conexiones) y se anuncia como
   `iptv.ace-e2e.example:8080`, el nombre que escribe la prueba en Ajustes:
   backend.ts lo resuelve a una IP pública (el filtro SSRF de la IPTV es el de
   producción) y su transporte lo trae aquí.

   Una plaza (max_connections 1) como los paneles baratos: así se ve que el
   relé comparte una sola conexión. El control (/__iptv/modo, /conexiones,
   /peticiones y /reset) va por el mismo puerto. No escribe nada en su log:
   las credenciales de prueba no tienen por qué salir de aquí. */

import { createFakeIptv } from '../../../server/test/fake-iptv/provider.js';
import { readPorts } from './puertos.ts';

const IPTV_PUBLIC_HOST = 'iptv.ace-e2e.example:8080';

const ports = readPorts();
const fake = await createFakeIptv({
  host: '::1',
  port: ports.iptv,
  publicHost: IPTV_PUBLIC_HOST,
  maxConnections: 1,
  /* Colchón de 8 s al abrir, como un panel de verdad: sin él el remux tarda
     15-20 s en tener lista y a veces pasa del plazo de arranque (20 s). */
  burstSeconds: 8,
});
process.stdout.write(`proveedor IPTV falso en [::1]:${fake.port}\n`);

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  fake.close().finally(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.on('message', (message: unknown) => {
  if (message === 'shutdown') stop();
});
