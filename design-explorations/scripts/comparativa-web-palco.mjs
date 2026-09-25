/* Comparativa de la fase 2: la web REAL (apps/web con ?demo=1, capturada con
   scripts/revision-visual.mjs) al lado del prototipo Palco, pantalla a pantalla,
   en oscuro y en claro.

   Uso (desde design-explorations):
     node scripts/comparativa-web-palco.mjs [carpeta-de-capturas-reales]
   Por defecto lee capturas/_revision/web-palco/final/ (una carpeta por vista,
   ficheros <vista>-<ancho>x<alto>-<oscuro|claro>[-…].png) y el prototipo de
   capturas/03-palco/. Escribe capturas/_revision/web-palco/comparativa.html con
   rutas relativas (los PNG no entran en el repositorio). */

import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'capturas/_revision/web-palco');
const REAL = path.resolve(process.argv[2] ?? path.join(SALIDA, 'final'));
const PROTO = path.join(RAIZ, 'capturas/03-palco');

/** [título, prototipo (fichero de capturas/03-palco), real (vista, tamaño, tema[, sufijo])] */
const PARES = [
  ['Portada · agenda', 'web-agenda-oscuro.png', ['agenda', '1440x900', 'oscuro']],
  ['Portada · agenda', 'web-agenda-claro.png', ['agenda', '1440x900', 'claro']],
  ['Portada · móvil', 'web-390-agenda.png', ['agenda', '390x844', 'oscuro']],
  ['Portada · móvil (claro)', null, ['agenda', '390x844', 'claro']],
  ['Partido · teatro', 'web-partido-oscuro.png', ['partido', '1440x900', 'oscuro']],
  ['Partido · teatro', 'web-partido-claro.png', ['partido', '1440x900', 'claro']],
  ['Partido · móvil', 'web-390-partido.png', ['partido', '390x844', 'oscuro']],
  ['Partido · móvil (claro)', null, ['partido', '390x844', 'claro']],
  ['Reproductor', 'web-reproductor-grande.png', ['reproductor', '1440x900', 'oscuro']],
  ['Reproductor en horizontal', null, ['reproductor', '844x390', 'oscuro']],
  ['Mini sobre otra pantalla', 'web-mini-biblioteca.png', ['mini-reproductor', '1440x900', 'oscuro']],
  ['Mini sobre otra pantalla', 'web-mini-biblioteca-claro.png', ['mini-reproductor', '1440x900', 'claro']],
  ['Mini · móvil', 'web-mini-oscuro.png', ['mini-reproductor', '390x844', 'oscuro']],
  ['Canales', 'web-biblioteca-oscuro.png', ['biblioteca-sonando', '1440x900', 'oscuro']],
  ['Canales', 'web-biblioteca-claro.png', ['biblioteca-favoritos', '1440x900', 'claro']],
  ['Canales · listas', null, ['biblioteca-listas', '390x844', 'oscuro']],
  ['Buscar', 'web-buscar-oscuro.png', ['buscar', '1440x900', 'oscuro']],
  ['Buscar', 'web-buscar-claro.png', ['buscar', '1440x900', 'claro']],
  ['Buscar · enlace detectado', 'web-buscar-enlace.png', ['buscar-enlace', '1440x900', 'oscuro']],
  ['Ajustes', 'web-ajustes-oscuro.png', ['ajustes', '1440x900', 'oscuro']],
  ['Ajustes', 'web-ajustes-claro.png', ['ajustes', '1440x900', 'claro']],
  ['Ajustes · dispositivos', 'web-ajustes-dispositivos-oscuro.png', ['dispositivos', '1440x900', 'oscuro']],
  ['Ajustes · dispositivos', 'web-ajustes-dispositivos-claro.png', ['dispositivos', '1440x900', 'claro']],
  ['Ajustes · dispositivos · móvil', null, ['dispositivos', '390x844', 'claro']],
  ['Ajustes · dónde se está reproduciendo', 'web-ajustes-donde.png', ['ajustes-donde', '1440x900', 'oscuro']],
  ['Ajustes · salud', 'web-ajustes-salud.png', ['salud', '1440x900', 'oscuro']],
  ['Ajustes · reproducción', 'web-ajustes-reproduccion.png', ['ajustes-reproduccion', '1440x900', 'claro']],
  ['Ajustes · apariencia', null, ['ajustes-apariencia', '1440x900', 'claro']],
  ['Gustos', 'web-gustos.png', ['preferencias', '1440x900', 'oscuro']],
  ['Gustos · móvil', null, ['preferencias', '390x844', 'claro']],
  ['Ayuda', 'web-ayuda.png', ['ayuda', '1440x900', 'oscuro']],
  ['Transparencia reducida', 'web-transparencia-reducida.png', ['partido', '1440x900', 'claro', '-transparencia-reducida']],
  ['Movimiento reducido', null, ['partido', '390x844', 'oscuro', '-movimiento-reducido']],
];

const rel = (file) => path.relative(SALIDA, file).split(path.sep).join('/');
const escapar = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function figura(etiqueta, file) {
  if (!file || !existsSync(file)) {
    return `<figure class="vacia"><figcaption>${escapar(etiqueta)}</figcaption><p>${file ? 'Sin captura' : 'No hay equivalente'}</p></figure>`;
  }
  const src = encodeURI(rel(file));
  return `<figure><figcaption>${escapar(etiqueta)}</figcaption><a href="${src}"><img src="${src}" alt="${escapar(etiqueta)}" loading="lazy"></a></figure>`;
}

let faltan = 0;
const filas = PARES.map(([titulo, proto, [vista, tamano, tema, sufijo = '']]) => {
  const real = path.join(REAL, vista, `${vista}-${tamano}-${tema}${sufijo}.png`);
  if (!existsSync(real)) faltan += 1;
  return `<section><h2>${escapar(titulo)} <small>${tamano} · ${tema}${escapar(sufijo.replace(/-/g, ' '))}</small></h2>
  <div class="par">${figura('Prototipo Palco', proto ? path.join(PROTO, proto) : null)}${figura('Web real (?demo=1)', real)}</div></section>`;
});

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Palco · web real y prototipo</title>
<style>
:root { color-scheme: dark; --bg: #05070a; --s: #0f1218; --t: #fff; --t2: #b9baba; --oro: #ffd60a; }
body { margin: 0; background: var(--bg); color: var(--t); font: 15px/1.45 system-ui, sans-serif; }
header { padding: 24px 16px 8px; max-width: 1600px; margin: 0 auto; }
h1 { margin: 0 0 4px; font-size: 28px; } header p { margin: 0; color: var(--t2); }
section { max-width: 1600px; margin: 0 auto; padding: 16px; border-top: 1px solid #1f242e; }
h2 { font-size: 17px; margin: 0 0 10px; } h2 small { color: var(--t2); font-weight: 400; margin-left: 8px; }
.par { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 16px; align-items: start; }
figure { margin: 0; background: var(--s); border-radius: 14px; padding: 10px; }
figcaption { font-size: 13px; color: var(--oro); margin-bottom: 8px; font-weight: 600; }
img { display: block; width: 100%; height: auto; border-radius: 8px; }
.vacia p { color: var(--t2); margin: 24px 0; text-align: center; }
</style></head><body>
<header><h1>Palco: web real al lado del prototipo</h1>
<p>Fase 2 · rama rediseno/palco · capturas de ${escapar(path.basename(REAL))} con scripts/revision-visual.mjs (modo demo). Toca una imagen para verla a tamaño real.</p></header>
${filas.join('\n')}
</body></html>
`;

writeFileSync(path.join(SALIDA, 'comparativa.html'), html);
console.log(`comparativa.html: ${PARES.length} pares${faltan ? `, ${faltan} capturas reales que faltan` : ''}`);
