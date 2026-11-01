/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-1.1.2";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/BackupSection-CQUgNgLX.css",
  "/assets/BackupSection-DCi1mWvk.js",
  "/assets/IptvSection-DDYHnVZH.js",
  "/assets/IptvSection-DgAczCin.css",
  "/assets/LiveMatches-BJyFoEOJ.js",
  "/assets/LivePanels-Bq_G_3p9.js",
  "/assets/LivePanels-C81xPbua.css",
  "/assets/LogsSection-BbDxU9yf.js",
  "/assets/LogsSection-BmRL9Fur.css",
  "/assets/Room-CIhLa-wR.js",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/SistemaPage-fYAWWBVf.js",
  "/assets/agenda-C517nSJO.js",
  "/assets/agenda-RGKzuYgp.css",
  "/assets/ajustes-6hLAMaoa.js",
  "/assets/ajustes-BckPU1PM.css",
  "/assets/base-B3ocrQ2B.css",
  "/assets/base-C9JGR-Xk.js",
  "/assets/base-C9Q7D2-y.js",
  "/assets/base-C_1yhotU.css",
  "/assets/canales-D9bFaMWN.css",
  "/assets/canales-XHHmSo5v.js",
  "/assets/carteles-CAfP3BSC.js",
  "/assets/cine-BKalTQ1s.css",
  "/assets/cine-oTYHfpMC.js",
  "/assets/comun-B9DOZBvZ.js",
  "/assets/controles-BP-u10UT.css",
  "/assets/controles-WuWAABJN.js",
  "/assets/demo-DKw8z9ds.js",
  "/assets/demo-data-B8qVIXar.js",
  "/assets/demo-data-Br2KfT_Z.js",
  "/assets/demo-zip-BKx-aWmY.js",
  "/assets/fuentes-BTzl7kc1.css",
  "/assets/fuentes-CorTKxwC.js",
  "/assets/guia-DK_84qKI.css",
  "/assets/guia-GhTiFPxA.js",
  "/assets/hls-4pmjJAqD.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/install-Csj1zLvy.js",
  "/assets/invitado-lZIq02vN.js",
  "/assets/invitado-mYqSHo9W.css",
  "/assets/juntos-9NFlHl6F.css",
  "/assets/juntos-B1nZ_BXq.js",
  "/assets/juntos-DAB4hgro.js",
  "/assets/listas-CQGgYdA1.css",
  "/assets/listas-CXcweoDP.js",
  "/assets/main-BxAfIcQX.js",
  "/assets/mando-BoQ6vKp3.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/mpegts-ChtxgN7B.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/panel-YvdRZzzz.js",
  "/assets/partidos-CRqVGPIq.css",
  "/assets/partidos-DwMJ41Wq.js",
  "/assets/player-Bo4MVl8t.js",
  "/assets/player-BrGORlDG.css",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/sala-Dx9xFwoi.css",
  "/assets/sala-fyvCtTY8.js",
  "/assets/toque-hicvAZoX.js",
  "/assets/vendor-fOMIcxws.js",
  "/assets/virtual-g8D_rxW1.js",
  "/assets/vod-B1Y-Azny.css",
  "/assets/vod-TDUjiAH8.js"
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
