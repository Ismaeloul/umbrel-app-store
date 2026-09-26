/* Ensayo de la IPTV con los datos guardados (docs/iptv.md §9.2): dice qué
   IPTV saldría para cada partido de hoy y mañana, sin tocar ningún stream.

     DATA_DIR=./copia-de-data ACE_SEED=… tsx apps/server/scripts/iptv-ensayo.ts [--agenda agenda.json] [--api http://[::1]:3100]

   Sin `--agenda` pide la agenda al backend (`--api`, por defecto el de
   `PORT` en 127.0.0.1). Dentro del contenedor de la app es lo mismo con
   `node server.js --iptv-ensayo`. La lógica está en src/modules/iptv/ensayo.ts. */

import { runIptvEnsayo } from '../src/modules/iptv/ensayo.js';

function option(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const agendaFile = option('agenda');
const api = option('api');
const code = await runIptvEnsayo({
  env: process.env,
  ...(agendaFile ? { agendaFile } : {}),
  ...(api ? { api } : {}),
  print: (line) => process.stdout.write(`${line}\n`),
});
process.exitCode = code;
