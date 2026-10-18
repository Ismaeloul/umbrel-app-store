/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-0.9.5";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/BackupSection-CQUgNgLX.css",
  "/assets/BackupSection-Q058B4qE.js",
  "/assets/IptvSection-BovaKSJp.js",
  "/assets/IptvSection-DgAczCin.css",
  "/assets/LogsSection-BmRL9Fur.css",
  "/assets/LogsSection-CWwhlt0S.js",
  "/assets/Room-B1mUcWJQ.js",
  "/assets/Room-Cg5cDWBL.css",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/SistemaPage-lTNa5u0x.js",
  "/assets/agenda-Bmq6fYf9.js",
  "/assets/agenda-DxLimm0-.css",
  "/assets/ajustes-BqEoHBNL.css",
  "/assets/ajustes-ttjZiUtb.js",
  "/assets/base-BESaKXkf.js",
  "/assets/base-BbQURuKk.js",
  "/assets/base-C6iAWLwX.css",
  "/assets/base-Du2tPIF6.css",
  "/assets/canales-BCAji7nO.js",
  "/assets/canales-CgV5z9k1.css",
  "/assets/cine-Ba8Y_1nV.js",
  "/assets/cine-DNoUQdr6.css",
  "/assets/comun-C7RkecZY.js",
  "/assets/demo-ChHxlGEp.js",
  "/assets/demo-data-CIX4cOiS.js",
  "/assets/demo-data-SSKN3sdp.js",
  "/assets/demo-zip-DSCzRHAU.js",
  "/assets/engines-CC4OsgFI.js",
  "/assets/fuentes-CSd8epO3.js",
  "/assets/fuentes-VTd7IE_V.css",
  "/assets/guia-BCDURxQf.css",
  "/assets/guia-DpKh9ZFw.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/hls-ymMD8tYe.js",
  "/assets/install-CpHl6d0S.js",
  "/assets/invitado-Bps99Ext.css",
  "/assets/invitado-C7W9L71h.js",
  "/assets/juntos-Cy_rJJfa.js",
  "/assets/listas-Bl-SXLD4.js",
  "/assets/listas-Ces1X2SB.css",
  "/assets/main-CY4kYUvx.js",
  "/assets/mando-BKPWOlTk.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-B5KcSi0E.js",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/panel-D73MQlDS.js",
  "/assets/partidos-C3Ote-vy.js",
  "/assets/partidos-CRqVGPIq.css",
  "/assets/player-BMWTPxcV.css",
  "/assets/player-BrPe9gMw.js",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/sala-DeBGOhDH.js",
  "/assets/sala-Dx9xFwoi.css",
  "/assets/timeline-DflQR6v7.js",
  "/assets/vendor-fOMIcxws.js",
  "/assets/virtual-D1g4wWTN.js"
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
