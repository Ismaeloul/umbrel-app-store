/* Registra `iptvChannels` del modo demo (demo.ts) desde Canales, para que «En tu IPTV» del filtro salga también
   sin haber pasado antes por Buscar (que registra el suyo al cargar). Diminuto: la demo del buscador solo se
   descarga la primera vez que se pide. */

import { registerDemoHandler } from '../../api/index.ts';

let registered = false;

export function registerIptvChannelsDemo(): void {
  if (registered) return;
  registered = true;
  registerDemoHandler('iptvChannels', async ({ query }) => {
    const { demoIptvChannels } = await import('./demo.ts');
    // Un poco de espera, como el servidor de verdad.
    await new Promise((resolve) => setTimeout(resolve, 60));
    return demoIptvChannels(String(query?.q ?? ''));
  });
}
