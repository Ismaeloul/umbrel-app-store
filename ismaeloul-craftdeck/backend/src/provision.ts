import { mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { CACHE_DIR } from './paths.js';
import { download, run } from './util.js';
import { getVanillaVersionInfo } from './catalog/vanilla.js';
import { getFabricServer } from './catalog/fabric.js';
import { getForgeInstaller } from './catalog/forge.js';
import { getNeoForgeInstaller } from './catalog/neoforge.js';
import { ensureJre, pickJavaMajor } from './java.js';
import { ServerMeta, LaunchSpec, updateServer, serverDir, audit } from './store.js';

type Broadcast = (type: string, payload: unknown) => void;

/**
 * Aprovisiona un servidor recién creado: JRE, jar/installer, eula y server.properties.
 * Corre en segundo plano; el estado va quedando en meta.provision y se emite por WS.
 */
export async function provisionServer(meta: ServerMeta, broadcast: Broadcast): Promise<void> {
  const dir = serverDir(meta.id);
  const log = async (msg: string) => {
    meta.provision.log.push(msg);
    await updateServer(meta.id, { provision: meta.provision });
    broadcast('provision', { id: meta.id, status: meta.provision.status, msg });
  };

  try {
    await mkdir(dir, { recursive: true });

    // Java lo dicta la versión base de MC (también para loaders modded)
    const vanillaInfo = await getVanillaVersionInfo(meta.mcVersion);
    const javaMajor = pickJavaMajor(vanillaInfo.javaMajor);
    meta.javaMajor = javaMajor;
    await updateServer(meta.id, { javaMajor });
    await ensureJre(javaMajor, (m) => void log(m));

    let launch: LaunchSpec;
    if (meta.loader === 'vanilla') {
      await log(`Descargando servidor vanilla ${meta.mcVersion}…`);
      await download(vanillaInfo.serverUrl, path.join(dir, 'server.jar'));
      launch = { type: 'jar', jar: 'server.jar' };
    } else if (meta.loader === 'fabric') {
      const fab = await getFabricServer(meta.mcVersion);
      meta.loaderVersion = fab.loaderVersion;
      await log(`Descargando servidor Fabric ${meta.mcVersion} (loader ${fab.loaderVersion})…`);
      await download(fab.url, path.join(dir, 'fabric-server.jar'));
      launch = { type: 'jar', jar: 'fabric-server.jar' };
    } else {
      const inst = meta.loader === 'forge'
        ? await getForgeInstaller(meta.mcVersion)
        : await getNeoForgeInstaller(meta.mcVersion);
      meta.loaderVersion = inst.loaderVersion;
      const installerJar = path.join(CACHE_DIR, `${meta.loader}-${meta.mcVersion}-${inst.loaderVersion}-installer.jar`);
      await log(`Descargando installer de ${meta.loader} ${inst.loaderVersion}…`);
      await download(inst.url, installerJar);
      await log('Ejecutando installer (esto tarda un par de minutos)…');
      const java = await ensureJre(javaMajor, (m) => void log(m));
      const code = await run(java, ['-jar', installerJar, '--installServer', dir], {
        cwd: dir,
        onLine: (l) => broadcast('provision', { id: meta.id, status: 'creating', msg: l }),
      });
      if (code !== 0) throw new Error(`El installer de ${meta.loader} terminó con código ${code}`);
      launch = await detectModdedLaunch(dir, meta.loader);
    }

    await writeFile(path.join(dir, 'eula.txt'), 'eula=true\n');
    await writeFile(
      path.join(dir, 'server.properties'),
      `server-port=${meta.port}\nmotd=${meta.name} \\u2014 powered by CraftDeck\n`,
    );

    meta.provision.status = 'ready';
    await updateServer(meta.id, { provision: meta.provision, launch, loaderVersion: meta.loaderVersion });
    await log(`Servidor «${meta.name}» listo.`);
    await audit('create', `Creó el servidor ${meta.name} (${meta.loader} ${meta.mcVersion})`, 'ok');
  } catch (err) {
    meta.provision.status = 'error';
    meta.provision.error = err instanceof Error ? err.message : String(err);
    await updateServer(meta.id, { provision: meta.provision });
    broadcast('provision', { id: meta.id, status: 'error', msg: meta.provision.error });
    await audit('create', `Falló la creación de ${meta.name}: ${meta.provision.error}`, 'err');
  }
}

/** Forge/NeoForge moderno deja args en libraries/…; el clásico deja un jar en la raíz. */
async function detectModdedLaunch(dir: string, loader: 'forge' | 'neoforge'): Promise<LaunchSpec> {
  const vendor = loader === 'forge' ? 'net/minecraftforge/forge' : 'net/neoforged/neoforge';
  const libDir = path.join(dir, 'libraries', ...vendor.split('/'));
  try {
    const versions = await readdir(libDir);
    if (versions.length) {
      const argsDir = ['libraries', vendor, versions[0]!].join('/');
      return { type: 'args', argsDir };
    }
  } catch { /* instalación clásica */ }
  const jar = (await readdir(dir)).find(
    (f) => f.startsWith(loader === 'forge' ? 'forge-' : 'neoforge-') && f.endsWith('.jar') && !f.includes('installer'),
  );
  if (!jar) throw new Error(`No se encontró cómo lanzar el servidor ${loader} instalado`);
  return { type: 'jar', jar };
}
