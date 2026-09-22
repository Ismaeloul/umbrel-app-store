# Decisiones tomadas en modo autónomo

Cada entrada: qué decidí, qué alternativas había y por qué. Todas se pueden
revertir; si alguna no te convence, dímelo y la cambio.

## D1. Dónde trabajar: clon del repo de la tienda, rama `rewrite-v2`

- **Decisión**: clonar `Ismaeloul/umbrel-app-store` dentro de
  `Desktop\Actualización aceplayer\umbrel-app-store` y trabajar en la rama
  `rewrite-v2`, que sale de `origin/main` (0.6.59).
- **Alternativas**: (a) convertir en repo la copia sin git del escritorio;
  (b) trabajar en `C:\Users\Isma\umbrel-app-store`, que se quedó en la 0.6.7;
  (c) crear un repo nuevo en GitHub.
- **Por qué**: el hook `pre-start` descarga las releases de las etiquetas de
  ese repo y la tienda de Umbrel lee de él, así que la v2 tiene que vivir ahí
  para que el mecanismo de actualización siga funcionando. Crear un repo nuevo
  es publicar algo que no pediste. El otro checkout lo dejo como estaba.

## D2. El monorepo va en `ace-player-neo/`, no dentro de la carpeta de la app

- **Decisión**: `ace-player-neo/{apps,packages,docs}` en la raíz del repo.
  `ismaeloul-ace-player-neo/` sigue siendo solo el paquete de Umbrel, con la
  release ya compilada en `releases/0.7.0/`.
- **Alternativa**: meter `apps/` y `packages/` dentro de
  `ismaeloul-ace-player-neo/`, como sugiere el esquema del prompt.
- **Por qué**: al instalar, umbreld hace
  `rsync --archive <carpeta de la app>/. <APP_DATA_DIR>` (visto en
  `legacy-compat/app-script`). Con el monorepo dentro, el NAS recibiría el
  código fuente, la app de iOS y cientos de capturas. `saldo/` ya sigue este
  patrón en el mismo repo.
