/* Registra `iptvChannels` del modo demo (demo.ts) desde Canales, para que «En tu IPTV» del filtro salga también
   sin haber pasado antes por Buscar (que registra el suyo al cargar). Diminuto: la demo del buscador solo se
   descarga la primera vez que se pide. */

import { registerDemoHandler } from '../../api/index.ts';
import { registeredDemoHandler } from '../../api/demo-registry.ts';

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

/* «Ahora: …» de la ventana rápida de buscar en la demo: lo que echa cada canal
   de la IPTV de ejemplo según una guía inventada (de hace 20 min a dentro de
   40). Si otra vista ya registró su propia guía de la demo, se queda la suya. */
const DEMO_NOW: Readonly<Record<string, string>> = {
  'DAZN LaLiga': 'LaLiga: previa de la jornada',
  'DAZN 1': 'Fórmula 1: entrenamientos libres',
  'DAZN 2': 'Baloncesto: Liga Endesa',
  'M+ LaLiga TV': 'El día después',
  'M+ LaLiga TV 2': 'Fútbol: LaLiga Hypermotion',
  'M+ Liga de Campeones': 'Noche de Champions',
  'M+ Liga de Campeones 2': 'Champions: los goles',
  Telecinco: 'Informativos',
  laSexta: 'laSexta Noticias',
  'La 1': 'Telediario',
  'La 1 Catalunya': 'Informativo territorial',
  'La 10': 'Cine de tarde',
  'LaLiga TV Hypermotion': 'Hypermotion: resumen',
};

let guideRegistered = false;

export function registerGuideNowDemo(): void {
  if (guideRegistered || registeredDemoHandler('iptvGuideNow')) return;
  guideRegistered = true;
  registerDemoHandler('iptvGuideNow', async ({ query }) => {
    const { DEMO_IPTV_SEARCH, demoIptvId } = await import('./demo-ids.ts');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const start = Math.floor((Date.now() - 20 * 60_000) / 60_000) * 60_000;
    const ids = [
      ...new Set(
        String(query?.ids ?? '')
          .split(',')
          .filter(Boolean),
      ),
    ];
    const items = ids.map((id) => {
      const index = DEMO_IPTV_SEARCH.findIndex(([title]) => demoIptvId(title) === id);
      const title = index >= 0 ? DEMO_NOW[DEMO_IPTV_SEARCH[index]![0]] : undefined;
      if (index < 0 || !title) return { id, guide: null, now: null, next: null };
      const guide = index + 1;
      return {
        id,
        guide,
        now: { id: `${guide}.${start / 60_000}`, start, end: start + 60 * 60_000, title, flags: 0 },
        next: null,
      };
    });
    return { available: true, version: 'demo', items };
  });
}
