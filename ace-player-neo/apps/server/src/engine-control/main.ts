/* Punto de entrada de engine-control.js (build.mjs lo empaqueta aparte, a
   CommonJS). Es un programa distinto del backend: su configuración son SUS
   variables de entorno (ACESTREAM_CONTAINER y ENGINE_CONTROL_TOKEN, que el
   Compose pone a `${APP_SEED}`), por eso lee `process.env` aquí y no pasa
   por apps/server/src/config. Toda la lógica está en server.ts. */

import { startEngineControl } from './server.js';

startEngineControl(process.env).listening.catch((error: unknown) => {
  console.error('engine-control: no se pudo escuchar en el puerto 3001', error);
  process.exit(1);
});
