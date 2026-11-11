/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-1.1.6";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/BackupSection-CQUgNgLX.css",
  "/assets/BackupSection-Ccgpv96b.js",
  "/assets/IptvSection-DSJByXVq.js",
  "/assets/IptvSection-DgAczCin.css",
  "/assets/LiveMatches-CRRsc01L.js",
  "/assets/LivePanels-FAvEpr6z.js",
  "/assets/LogsSection-BmRL9Fur.css",
  "/assets/LogsSection-BvmH1qh9.js",
  "/assets/Room-3wkZHpQZ.js",
  "/assets/Room-B2k0Jjc9.css",
  "/assets/SistemaPage-BFLtOJb4.js",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/agenda-BFFBIcvB.css",
  "/assets/agenda-Dfo4jYm2.js",
  "/assets/ajustes-BakL_2D-.css",
  "/assets/ajustes-ChWKkZps.js",
  "/assets/base-B3ocrQ2B.css",
  "/assets/base-B6xnNfTr.js",
  "/assets/base-C9JGR-Xk.js",
  "/assets/base-C_qvAQgz.css",
  "/assets/canales-D9bFaMWN.css",
  "/assets/canales-DTPue-Ia.js",
  "/assets/carteles-DqM-m31d.js",
  "/assets/cine-DYRCe4c4.js",
  "/assets/cine-m6RKXlxF.css",
  "/assets/comun-B5KIzYQ8.js",
  "/assets/controles-BP-u10UT.css",
  "/assets/controles-GFma-U6-.js",
  "/assets/demo-BN5CI63w.js",
  "/assets/demo-data-ZhXnb0S3.js",
  "/assets/demo-data-lAQs3RP-.js",
  "/assets/demo-zip-DI8lNBmB.js",
  "/assets/fuentes-BTzl7kc1.css",
  "/assets/fuentes-DZ5lFbGy.js",
  "/assets/guia-CESsZiwG.js",
  "/assets/guia-DK_84qKI.css",
  "/assets/hls-B0Tpx2jP.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/install-CdeJOfWG.js",
  "/assets/invitado-CUmbSjf5.js",
  "/assets/invitado-DZGl_u_w.css",
  "/assets/juntos-BAPSXk4u.js",
  "/assets/juntos-BFskkdlG.css",
  "/assets/juntos-BGaZHt_w.css",
  "/assets/juntos-cTbZ7sYu.js",
  "/assets/listas-CQGgYdA1.css",
  "/assets/listas-Dz3LPId-.js",
  "/assets/main-_whfQZns.js",
  "/assets/mando-B0-mDg-B.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/mpegts-Cl6tEfPN.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/panel-CymhmhzO.js",
  "/assets/partidos-CRqVGPIq.css",
  "/assets/partidos-Qbi9VbTc.js",
  "/assets/player-B_rXHIF8.js",
  "/assets/player-DvhmV5sd.css",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/sala-CAw2H6dN.js",
  "/assets/sala-Dx9xFwoi.css",
  "/assets/toque-hicvAZoX.js",
  "/assets/vendor-fOMIcxws.js",
  "/assets/virtual-DuadiBQe.js",
  "/assets/vod-B1Y-Azny.css",
  "/assets/vod-EBpZ34Po.js"
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
