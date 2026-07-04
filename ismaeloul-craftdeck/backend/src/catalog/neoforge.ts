import { fetchJson, cmpVersion } from '../util.js';

const VERSIONS_URL = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';
const MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

/** NeoForge "21.1.77" corre en MC "1.21.1"; "21.0.x" en "1.21". */
function neoToMc(v: string): string | null {
  const m = v.match(/^(\d+)\.(\d+)\.\d+/);
  if (!m) return null;
  return m[2] === '0' ? `1.${m[1]}` : `1.${m[1]}.${m[2]}`;
}

export async function listNeoForgeVersions(): Promise<{ mc: string; neoforge: string }[]> {
  const data = await fetchJson<{ versions: string[] }>(VERSIONS_URL);
  const byMc = new Map<string, string>();
  for (const v of data.versions) {
    if (v.includes('beta')) continue;
    const mc = neoToMc(v);
    if (!mc) continue;
    const prev = byMc.get(mc);
    // las versiones llegan ordenadas ascendentemente; la última gana
    if (!prev || cmpVersion(v, prev) > 0) byMc.set(mc, v);
  }
  return [...byMc.entries()]
    .map(([mc, neoforge]) => ({ mc, neoforge }))
    .sort((a, b) => cmpVersion(b.mc, a.mc));
}

export async function getNeoForgeInstaller(mc: string): Promise<{ url: string; loaderVersion: string }> {
  const versions = await listNeoForgeVersions();
  const hit = versions.find((v) => v.mc === mc);
  if (!hit) throw new Error(`NeoForge no soporta Minecraft ${mc}`);
  return {
    url: `${MAVEN}/${hit.neoforge}/neoforge-${hit.neoforge}-installer.jar`,
    loaderVersion: hit.neoforge,
  };
}
