/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-0.8.0";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/SistemaPage-DeMHX3mq.js",
  "/assets/agenda-C1grC4ut.css",
  "/assets/agenda-H-z-Tlxz.js",
  "/assets/ajustes-BFNlYShS.js",
  "/assets/ajustes-h9_pEDMr.css",
  "/assets/base-BHhoW4vg.js",
  "/assets/base-BPdiu4-6.css",
  "/assets/canales-D9ShmdYo.css",
  "/assets/canales-DEN00l6f.js",
  "/assets/comun-0gFjmwW9.js",
  "/assets/demo-BTj8QgZ6.js",
  "/assets/demo-data-Cqzym7ph.js",
  "/assets/fuentes-Cf6oyZCn.js",
  "/assets/fuentes-ChER30EF.css",
  "/assets/hls-DEH92zVl.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/index-Awb9zvtQ.css",
  "/assets/index-B-O0BYKk.js",
  "/assets/install-DIGCB_Xf.js",
  "/assets/listas-Ces1X2SB.css",
  "/assets/listas-z1Q4Q7_G.js",
  "/assets/mando-BeEtL-mo.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-B505GXcx.js",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/panel-B5ro1k5_.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/partidos-CmGfAjMt.js",
  "/assets/player-B1p6iW2l.css",
  "/assets/player-DSgesOvc.js",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/vendor-Dx4dgo8m.js",
  "/assets/virtual-TAHPCmNa.js"
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
