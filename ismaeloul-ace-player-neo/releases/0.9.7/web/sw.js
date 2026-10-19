/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-0.9.7";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/BackupSection-CQUgNgLX.css",
  "/assets/BackupSection-DZmGhurc.js",
  "/assets/IptvSection-DgAczCin.css",
  "/assets/IptvSection-yku2KxJ0.js",
  "/assets/LogsSection-BmRL9Fur.css",
  "/assets/LogsSection-DorA5pxr.js",
  "/assets/Room-Cg5cDWBL.css",
  "/assets/Room-D8RNMVGP.js",
  "/assets/SistemaPage-C56i4ure.js",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/agenda-D6JA92I0.js",
  "/assets/agenda-DxLimm0-.css",
  "/assets/ajustes-BqEoHBNL.css",
  "/assets/ajustes-DeHuwpZD.js",
  "/assets/base-6C5lLLLr.js",
  "/assets/base-BESaKXkf.js",
  "/assets/base-C6iAWLwX.css",
  "/assets/base-Du2tPIF6.css",
  "/assets/canales-CgV5z9k1.css",
  "/assets/canales-mbehKjca.js",
  "/assets/cine-DNoUQdr6.css",
  "/assets/cine-JIxTrjTo.js",
  "/assets/comun-_rphhkWV.js",
  "/assets/demo-CXlt-QZh.js",
  "/assets/demo-data-BPUX9gge.js",
  "/assets/demo-data-DFXwXDMf.js",
  "/assets/demo-zip-Bj0sA6BT.js",
  "/assets/engines-BGXOyJFi.js",
  "/assets/fuentes-VTd7IE_V.css",
  "/assets/fuentes-lVo1oJVu.js",
  "/assets/guia-BCDURxQf.css",
  "/assets/guia-BvO80RKi.js",
  "/assets/hls-DJ0T3qfD.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/install-DGsTNvLZ.js",
  "/assets/invitado-Bps99Ext.css",
  "/assets/invitado-D1xOxmh4.js",
  "/assets/juntos-DYag222y.js",
  "/assets/listas-BHyH4JK3.js",
  "/assets/listas-CQGgYdA1.css",
  "/assets/main-BdAQ9UBq.js",
  "/assets/mando-BNpPBzP7.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/mpegts-CZblDD4q.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/panel-Ci5XACuP.js",
  "/assets/partidos-CRqVGPIq.css",
  "/assets/partidos-Cn5HmVjm.js",
  "/assets/player-BMWTPxcV.css",
  "/assets/player-YREeSTvZ.js",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/sala-DNz4D43s.js",
  "/assets/sala-Dx9xFwoi.css",
  "/assets/timeline-DflQR6v7.js",
  "/assets/vendor-fOMIcxws.js",
  "/assets/virtual--bB6UYMf.js"
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
