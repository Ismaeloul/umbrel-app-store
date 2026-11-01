/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-1.1.1";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/BackupSection-CQUgNgLX.css",
  "/assets/BackupSection-SscZhZHs.js",
  "/assets/IptvSection-CMol_8eB.js",
  "/assets/IptvSection-DgAczCin.css",
  "/assets/LogsSection-BmRL9Fur.css",
  "/assets/LogsSection-D22xYM3g.js",
  "/assets/Room-DoNgHmKV.js",
  "/assets/SistemaPage-Bg5HPIE8.js",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/agenda-BIg_ErV1.js",
  "/assets/agenda-DruR3B9-.css",
  "/assets/ajustes-BckPU1PM.css",
  "/assets/ajustes-CQ7hjsuj.js",
  "/assets/base-B3ocrQ2B.css",
  "/assets/base-C9JGR-Xk.js",
  "/assets/base-C_1yhotU.css",
  "/assets/base-XJfahOwC.js",
  "/assets/canales-CUBZk5dk.js",
  "/assets/canales-D9bFaMWN.css",
  "/assets/cine-BKalTQ1s.css",
  "/assets/cine-CiY5jR4K.js",
  "/assets/comun-DmmkWc7t.js",
  "/assets/demo-CA2J6gsM.js",
  "/assets/demo-data-D69IFiAU.js",
  "/assets/demo-data-ob8NuyAl.js",
  "/assets/demo-zip-BK8l62Ob.js",
  "/assets/fuentes-BTzl7kc1.css",
  "/assets/fuentes-C4Jjwx97.js",
  "/assets/guia-BOWYD1dM.js",
  "/assets/guia-DK_84qKI.css",
  "/assets/hls-CRePvJ2S.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/install-Bws2oAM7.js",
  "/assets/invitado-BIknUZAz.js",
  "/assets/invitado-Bps99Ext.css",
  "/assets/juntos-DX6BOSkl.js",
  "/assets/listas-C6rhO-Xn.js",
  "/assets/listas-CQGgYdA1.css",
  "/assets/main-DU8KdIMK.js",
  "/assets/mando-ByivKR1I.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/mpegts-DdED3Syy.js",
  "/assets/panel-B8mr-JGq.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/partidos-21j_QLB7.js",
  "/assets/partidos-CRqVGPIq.css",
  "/assets/player-BrGORlDG.css",
  "/assets/player-DO6V5I3-.js",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/sala-BUYNVaM4.js",
  "/assets/sala-Dx9xFwoi.css",
  "/assets/vendor-fOMIcxws.js",
  "/assets/virtual-DSVMLDEH.js",
  "/assets/vod-B1Y-Azny.css",
  "/assets/vod-C6hUmiSg.js"
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(VERSION)
      // addAll falla entero si un recurso falla; así cada uno va por su cuenta
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(claves.filter((c) => c !== VERSION).map((c) => caches.delete(c))),
      )
      .then(() => self.clients.claim()),
  );
});

const ES_DATO = (url) => /^\/(api|ace|content|remux|native)(\/|$)/.test(url.pathname);

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;
  if (ES_DATO(url)) return; // datos y vídeo: siempre a la red

  // El documento va primero a la red para no servir una versión vieja, con la
  // caché como red de seguridad si no hay conexión. Solo se guarda si es un 200:
  // una página de error de la pasarela no debe quedarse como armazón.
  if (peticion.mode === 'navigate') {
    evento.respondWith(
      fetch(peticion)
        .then((respuesta) => {
          if (respuesta.ok) {
            const copia = respuesta.clone();
            caches.open(VERSION).then((cache) => cache.put('/', copia));
          }
          return respuesta;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }

  // Estáticos: caché primero, que no cambian dentro de una misma versión.
  evento.respondWith(
    caches.match(peticion).then(
      (enCache) =>
        enCache ||
        fetch(peticion).then((respuesta) => {
          if (respuesta.ok && respuesta.type === 'basic') {
            const copia = respuesta.clone();
            caches.open(VERSION).then((cache) => cache.put(peticion, copia));
          }
          return respuesta;
        }),
    ),
  );
});
