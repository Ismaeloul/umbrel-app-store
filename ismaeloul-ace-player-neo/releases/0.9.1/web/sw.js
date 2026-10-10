/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-0.9.1";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/BackupSection-CQUgNgLX.css",
  "/assets/BackupSection-DtOCEIFZ.js",
  "/assets/IptvSection-BqJUXJYl.js",
  "/assets/IptvSection-DgAczCin.css",
  "/assets/LogsSection-BTcX9P3T.js",
  "/assets/LogsSection-BmRL9Fur.css",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/SistemaPage-DlOU2CE9.js",
  "/assets/agenda-CEXtFeZj.js",
  "/assets/agenda-DxLimm0-.css",
  "/assets/ajustes-16E-RU74.js",
  "/assets/ajustes-BqEoHBNL.css",
  "/assets/base-8qk_mfB5.js",
  "/assets/base-Du2tPIF6.css",
  "/assets/canales-CgV5z9k1.css",
  "/assets/canales-CruLQdve.js",
  "/assets/cine-DNoUQdr6.css",
  "/assets/cine-DoavTGyo.js",
  "/assets/comun-DaLgk9yK.js",
  "/assets/demo-CnmMpcUT.js",
  "/assets/demo-data-B3OxYPgQ.js",
  "/assets/demo-data-D0KneUuo.js",
  "/assets/demo-zip-D8ruCuaS.js",
  "/assets/fuentes-DxNfVBX-.js",
  "/assets/fuentes-VTd7IE_V.css",
  "/assets/guia-BCDURxQf.css",
  "/assets/guia-C5ufsVey.js",
  "/assets/hls-BtBuOmCO.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/index-C6iAWLwX.css",
  "/assets/index-vbZotrLm.js",
  "/assets/install-BH_ZbHz6.js",
  "/assets/listas-BrDQI8vp.js",
  "/assets/listas-Ces1X2SB.css",
  "/assets/mando-B_-kaHIO.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/mpegts-eRMmqYbC.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/panel-Ch4rdGJz.js",
  "/assets/partidos-CRqVGPIq.css",
  "/assets/partidos-DCA-yrE2.js",
  "/assets/player-BMWTPxcV.css",
  "/assets/player-S_-R7cMA.js",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/sala-CRq_stwk.js",
  "/assets/sala-Dx9xFwoi.css",
  "/assets/timeline-DflQR6v7.js",
  "/assets/vendor-fOMIcxws.js",
  "/assets/virtual-Du-L9Q_d.js"
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
