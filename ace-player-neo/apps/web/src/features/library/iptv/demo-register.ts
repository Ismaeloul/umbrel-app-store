/* Registra `iptvBrowse` del modo demo (demo.ts). Diminuto: el catálogo de
   ejemplo solo se descarga la primera vez que la demo pide la pestaña. */

import { registerDemoHandler } from '../../../api/index.ts';

let registered = false;

export function registerIptvBrowseDemo(): void {
  if (registered) return;
  registered = true;
  registerDemoHandler('iptvBrowse', async ({ query }) => {
    const { demoIptvBrowse } = await import('./demo.ts');
    // Un poco de espera, como el servidor de verdad: así se ven los esqueletos.
    await new Promise((resolve) => setTimeout(resolve, 90));
    const { limit, ...rest } = query ?? {};
    return demoIptvBrowse({ ...rest, ...(limit === undefined ? {} : { limit: Number(limit) }) });
  });
}
