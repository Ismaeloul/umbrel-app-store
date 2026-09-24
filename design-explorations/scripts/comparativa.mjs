#!/usr/bin/env node
/* Genera comparativa.html: las cinco propuestas lado a lado, por pantalla,
   en iPhone y escritorio, claro y oscuro. Lee las capturas de capturas/. */
import fs from 'node:fs';
import path from 'node:path';

const DIRS = [
  { id: 1, slug: '01-tribuna', name: 'Tribuna', tagline: 'Nativo Apple editorial' },
  { id: 2, slug: '02-pizarra', name: 'Pizarra', tagline: 'Centro de datos deportivo' },
  { id: 3, slug: '03-palco', name: 'Palco', tagline: 'Cinemático video-first' },
  { id: 4, slug: '04-consola', name: 'Consola', tagline: 'Herramienta pro minimalista' },
  { id: 5, slug: '05-transistor', name: 'Transistor', tagline: 'Carta libre' },
];
const SCREENS = [
  ['agenda', 'Agenda'],
  ['partido', 'Centro de partido (sin reproducir)'],
  ['reproduciendo', 'Reproduciendo (grande)'],
  ['mini', 'Mini-reproductor sobre la biblioteca'],
  ['biblioteca', 'Biblioteca'],
  ['buscar', 'Buscar'],
  ['ajustes', 'Ajustes'],
  ['dispositivos', 'Dispositivos y emparejamiento'],
  ['sin-senal', 'Sin señal'],
  ['reconectando', 'Reconectando'],
  ['gol', 'Gol entrando'],
  ['primer-uso', 'Primer uso'],
];
const MODES = [
  ['iphone', 'iPhone'],
  ['web', 'Web escritorio'],
];
const THEMES = [
  ['oscuro', 'Oscuro'],
  ['claro', 'Claro'],
];

const exists = (p) => fs.existsSync(path.resolve('capturas', p));
let html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ace Player Neo · comparativa de las 5 propuestas</title>
<style>
  :root{color-scheme:dark;--bg:#0d0f14;--ink:#e9edf3;--mut:#8f9bad;--line:rgba(255,255,255,.1)}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 Inter,system-ui,-apple-system,sans-serif}
  header{padding:28px 32px 12px;border-bottom:1px solid var(--line);position:sticky;top:0;background:rgba(13,15,20,.92);backdrop-filter:blur(12px);z-index:5}
  h1{margin:0 0 6px;font-size:22px;letter-spacing:-.02em}
  header p{margin:0;color:var(--mut)}
  nav{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
  nav a{color:var(--ink);text-decoration:none;font-size:12px;padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.07)}
  nav a:hover{background:rgba(255,255,255,.14)}
  section{padding:24px 32px;border-bottom:1px solid var(--line)}
  h2{margin:0 0 4px;font-size:18px;letter-spacing:-.01em}
  h3{margin:18px 0 10px;font-size:13px;color:var(--mut);text-transform:uppercase;letter-spacing:.08em}
  .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}
  .grid.web{grid-template-columns:repeat(2,1fr)}
  figure{margin:0;display:grid;gap:8px}
  figure img{width:100%;height:auto;border-radius:12px;background:#000;box-shadow:0 0 0 1px var(--line);display:block}
  figcaption{font-size:12px;color:var(--mut);display:flex;justify-content:space-between}
  figcaption b{color:var(--ink);font-weight:600}
  .missing{aspect-ratio:9/19.5;border:1px dashed var(--line);border-radius:12px;display:grid;place-items:center;color:var(--mut);font-size:12px}
  .web .missing{aspect-ratio:16/10}
  @media (max-width:1100px){.grid{grid-template-columns:repeat(2,1fr)}.grid.web{grid-template-columns:1fr}}
</style></head><body>
<header><h1>Ace Player Neo · cinco propuestas lado a lado</h1>
<p>Capturas automáticas (Playwright) de las pantallas clave de cada propuesta, en iPhone (402×874 pt con marco) y escritorio (1440×900), en oscuro y claro. Generado el ${new Date().toLocaleString('es-ES')}.</p>
<nav>${SCREENS.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('')}</nav></header>`;

for (const [sid, slabel] of SCREENS) {
  html += `<section id="${sid}"><h2>${slabel}</h2>`;
  for (const [mid, mlabel] of MODES) {
    for (const [tid, tlabel] of THEMES) {
      html += `<h3>${mlabel} · ${tlabel}</h3><div class="grid ${mid}">`;
      for (const d of DIRS) {
        const file = `${d.slug}/${mid}-${sid}-${tid}.png`;
        html += `<figure>${exists(file) ? `<img loading="lazy" src="capturas/${file}" alt="${d.name} · ${slabel} · ${mlabel} · ${tlabel}">` : `<div class="missing">Sin captura</div>`}<figcaption><b>${d.id} · ${d.name}</b><span>${d.tagline}</span></figcaption></figure>`;
      }
      html += `</div>`;
    }
  }
  html += `</section>`;
}
html += `</body></html>`;
fs.writeFileSync(path.resolve('comparativa.html'), html);
console.log('comparativa.html generada');
