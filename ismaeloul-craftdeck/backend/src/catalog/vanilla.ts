import { fetchJson } from '../util.js';

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

interface Manifest {
  latest: { release: string; snapshot: string };
  versions: { id: string; type: string; url: string }[];
}

interface VersionJson {
  downloads?: { server?: { url: string } };
  javaVersion?: { majorVersion: number };
}

let manifestCache: { at: number; data: Manifest } | null = null;

async function manifest(): Promise<Manifest> {
  if (manifestCache && Date.now() - manifestCache.at < 10 * 60_000) return manifestCache.data;
  const data = await fetchJson<Manifest>(MANIFEST_URL);
  manifestCache = { at: Date.now(), data };
  return data;
}

export async function listVanillaVersions(): Promise<{ id: string; latest: boolean }[]> {
  const m = await manifest();
  return m.versions
    .filter((v) => v.type === 'release')
    .map((v) => ({ id: v.id, latest: v.id === m.latest.release }));
}

export async function getVanillaVersionInfo(id: string): Promise<{ serverUrl: string; javaMajor: number }> {
  const m = await manifest();
  const entry = m.versions.find((v) => v.id === id);
  if (!entry) throw new Error(`Versión de Minecraft desconocida: ${id}`);
  const vj = await fetchJson<VersionJson>(entry.url);
  const serverUrl = vj.downloads?.server?.url;
  if (!serverUrl) throw new Error(`La versión ${id} no tiene servidor descargable`);
  return { serverUrl, javaMajor: vj.javaVersion?.majorVersion ?? 8 };
}
