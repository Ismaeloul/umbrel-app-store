/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-0.7.1";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/SistemaPage-B2m_zg6S.css",
  "/assets/SistemaPage-CCVSJYh7.js",
  "/assets/agenda-Chc04Jyh.css",
  "/assets/agenda-ZR93bajU.js",
  "/assets/ajustes-BLSbhP0X.js",
  "/assets/ajustes-C2VHT8BG.css",
  "/assets/base-CBb27VJ7.js",
  "/assets/base-fooAFw8C.css",
  "/assets/canales-C1cvx-Ip.css",
  "/assets/canales-CLPm-Pn6.js",
  "/assets/comun-0gFjmwW9.js",
  "/assets/demo-BsxNv-MN.js",
  "/assets/demo-data-BXkNWbF4.js",
  "/assets/fuentes-bAXIaLfA.js",
  "/assets/fuentes-fxd1X7jz.css",
  "/assets/hls-8nf8Qi2a.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/index-BD0lAgj7.css",
  "/assets/index-GiCj06vg.js",
  "/assets/install-BPzkzqng.js",
  "/assets/listas-Be3Yr9f0.js",
  "/assets/listas-DaqsUPVh.css",
  "/assets/mando-B8n-7l-C.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/mpegts-C0mDDYOg.js",
  "/assets/panel-CoL5IhAk.css",
  "/assets/panel-h99OY3ol.js",
  "/assets/partidos-dZet9ziw.js",
  "/assets/player-CiuoL0TA.js",
  "/assets/player-GiBLwhN8.css",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/vendor-Dx4dgo8m.js",
  "/assets/virtual-YZyZH5nB.js"
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
