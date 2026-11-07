/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-1.1.5";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/BackupSection-CQUgNgLX.css",
  "/assets/BackupSection-DPbzTdJW.js",
  "/assets/IptvSection-Cx_-EfVe.js",
  "/assets/IptvSection-DgAczCin.css",
  "/assets/LiveMatches-B4XDFaF6.js",
  "/assets/LivePanels-vuz6y_6y.js",
  "/assets/LogsSection-BmRL9Fur.css",
  "/assets/LogsSection-I0mJHI7k.js",
  "/assets/Room-B2k0Jjc9.css",
  "/assets/Room-DfHc_cOp.js",
  "/assets/SistemaPage-CsGJi9jd.js",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/agenda-BFFBIcvB.css",
  "/assets/agenda-QGfTH82C.js",
  "/assets/ajustes-7Ln8jx_K.js",
  "/assets/ajustes-BakL_2D-.css",
  "/assets/base-B3ocrQ2B.css",
  "/assets/base-C4QzTstp.js",
  "/assets/base-C9JGR-Xk.js",
  "/assets/base-C_qvAQgz.css",
  "/assets/canales-COL0Ovx0.js",
  "/assets/canales-D9bFaMWN.css",
  "/assets/carteles-Fp_h5vuC.js",
  "/assets/cine-m6RKXlxF.css",
  "/assets/cine-oPF5GxBz.js",
  "/assets/comun-CqkKbdBU.js",
  "/assets/controles-BP-u10UT.css",
  "/assets/controles-BZLacJY6.js",
  "/assets/demo-Be3-ryzs.js",
  "/assets/demo-data-D4JrQMtB.js",
  "/assets/demo-data-FqD-5gCU.js",
  "/assets/demo-zip-D7GLxJeW.js",
  "/assets/fuentes-BTzl7kc1.css",
  "/assets/fuentes-D049sGUe.js",
  "/assets/guia-CzjlNk2l.js",
  "/assets/guia-DK_84qKI.css",
  "/assets/hls-BpvIRn2F.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/install-GjXlvtqj.js",
  "/assets/invitado-DZGl_u_w.css",
  "/assets/invitado-DpB3CKlT.js",
  "/assets/juntos-B6RJ2K5V.css",
  "/assets/juntos-BFskkdlG.css",
  "/assets/juntos-Cz-Ib982.js",
  "/assets/juntos-OCqmHVqd.js",
  "/assets/listas-BryLYk49.js",
  "/assets/listas-CQGgYdA1.css",
  "/assets/main-BofwbWf5.js",
  "/assets/mando-Bx_2jDiB.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/mpegts-epp8yF2_.js",
  "/assets/panel-B68EppPH.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/partidos-CRqVGPIq.css",
  "/assets/partidos-CbKHsJVJ.js",
  "/assets/player-DvhmV5sd.css",
  "/assets/player-ytCNU9Gd.js",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/sala-Dx9xFwoi.css",
  "/assets/sala-k0HAZLO4.js",
  "/assets/toque-hicvAZoX.js",
  "/assets/vendor-fOMIcxws.js",
  "/assets/virtual-CsdsZYQg.js",
  "/assets/vod-B1Y-Azny.css",
  "/assets/vod-C-Aptr3J.js"
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
