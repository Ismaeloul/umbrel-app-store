// Prettier para deploy/: la configuración de la raíz y una excepción para YAML.
//
// Los Compose tienen que seguir con comillas dobles, como el de la 0.6.59 que
// hoy corre en el Umbrel: se comparan línea a línea al cortar la release y el
// test del Compose busca `ACE_SEED: "${APP_SEED}"` tal cual. Con singleQuote
// (el estilo del resto del monorepo) Prettier los reescribiría con comillas
// simples. Prettier no mezcla configuraciones: la más cercana gana, así que se
// parte de la de la raíz para no divergir en lo demás.
import { readFileSync } from 'node:fs';

const root = JSON.parse(readFileSync(new URL('../.prettierrc.json', import.meta.url), 'utf8'));

export default {
  ...root,
  overrides: [{ files: ['*.yml', '*.yaml'], options: { singleQuote: false } }],
};
