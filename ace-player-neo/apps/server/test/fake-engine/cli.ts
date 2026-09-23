/* Punto de entrada del motor falso como proceso aparte:

     tsx apps/server/test/fake-engine/cli.ts --port 6878 --host 0.0.0.0 [--catalog canales.json]

   Es lo que usan el perfil "falso" de docker compose (empaquetado con
   esbuild por deploy/local/prepare.mjs) y las pruebas E2E. Toda la lógica
   está en cli-options.ts para poder probarla sin lanzar procesos; aquí solo
   se arranca y se engancha el cierre limpio a SIGINT/SIGTERM (docker stop
   manda SIGTERM y el contenedor tiene que salir sin esperar al SIGKILL). */

import { runCli } from './cli-options.js';

const print = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

try {
  const { engine } = await runCli(process.argv.slice(2), process.env, print);
  if (engine) {
    let stopping = false;
    const stop = (signal: string): void => {
      if (stopping) return;
      stopping = true;
      print(`motor falso: ${signal}, cerrando`);
      engine.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
  }
} catch (error) {
  process.stderr.write(`motor falso: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
