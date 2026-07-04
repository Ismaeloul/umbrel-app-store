import { fetchJson, cmpVersion } from '../util.js';

const PROMOS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';

/**
 * MC → versión de Forge (recommended si existe, si no latest).
 * Se limita a MC >= 1.12.2: antes el nombrado de artefactos en maven cambia y no compensa soportarlo.
 */
export async function listForgeVersions(): Promise<{ mc: string; forge: string }[]> {
  const data = await fetchJson<{ promos: Record<string, string> }>(PROMOS_URL);
  const byMc = new Map<string, { recommended?: string; latest?: string }>();
  for (const [key, ver] of Object.entries(data.promos)) {
    const m = key.match(/^(.+)-(recommended|latest)$/);
    if (!m) continue;
    const [, mc, channel] = m;
    if (cmpVersion(mc!, '1.12.2') < 0) continue;
    const entry = byMc.get(mc!) ?? {};
    entry[channel as 'recommended' | 'latest'] = ver;
    byMc.set(mc!, entry);
  }
  return [...byMc.entries()]
    .map(([mc, v]) => ({ mc, forge: v.recommended ?? v.latest! }))
    .sort((a, b) => cmpVersion(b.mc, a.mc));
}

export async function getForgeInstaller(mc: string): Promise<{ url: string; loaderVersion: string }> {
  const versions = await listForgeVersions();
  const hit = versions.find((v) => v.mc === mc);
  if (!hit) throw new Error(`Forge no soporta Minecraft ${mc}`);
  const full = `${mc}-${hit.forge}`;
  return { url: `${MAVEN}/${full}/forge-${full}-installer.jar`, loaderVersion: hit.forge };
}
