import { fetchJson } from '../util.js';

const META = 'https://meta.fabricmc.net/v2';

export async function listFabricGameVersions(): Promise<string[]> {
  const versions = await fetchJson<{ version: string; stable: boolean }[]>(`${META}/versions/game`);
  return versions.filter((v) => v.stable).map((v) => v.version);
}

/** URL del jar de servidor autocontenido que genera Fabric para una versión de MC. */
export async function getFabricServer(game: string): Promise<{ url: string; loaderVersion: string }> {
  const loaders = await fetchJson<{ loader: { version: string; stable: boolean } }[]>(
    `${META}/versions/loader/${game}`,
  );
  const loader = loaders.find((l) => l.loader.stable)?.loader.version ?? loaders[0]?.loader.version;
  if (!loader) throw new Error(`Fabric no soporta Minecraft ${game}`);
  const installers = await fetchJson<{ version: string; stable: boolean }[]>(`${META}/versions/installer`);
  const installer = installers.find((i) => i.stable)?.version ?? installers[0]?.version;
  if (!installer) throw new Error('No se pudo obtener el installer de Fabric');
  return { url: `${META}/versions/loader/${game}/${loader}/${installer}/server/jar`, loaderVersion: loader };
}
