/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-0.9.0";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/BackupSection-CQUgNgLX.css",
  "/assets/BackupSection-PyWjtR6K.js",
  "/assets/IptvSection-BxqwYk2T.js",
  "/assets/IptvSection-DgAczCin.css",
  "/assets/LogsSection-BmRL9Fur.css",
  "/assets/LogsSection-nPaKlC-H.js",
  "/assets/SistemaPage-B5fjk0Nc.js",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/agenda-DihdJd6n.js",
  "/assets/agenda-DxLimm0-.css",
  "/assets/ajustes-BqEoHBNL.css",
  "/assets/ajustes-C4F3pu5O.js",
  "/assets/base-DixItxHL.js",
  "/assets/base-Du2tPIF6.css",
  "/assets/canales-BCMirgua.js",
  "/assets/canales-CgV5z9k1.css",
  "/assets/cine-BhKoLKdu.css",
  "/assets/cine-Co4JKMld.js",
  "/assets/comun-CKtNExnc.js",
  "/assets/demo-CW_nbJr8.js",
  "/assets/demo-data-Be4FvoEd.js",
  "/assets/demo-data-DKhYifx-.js",
  "/assets/demo-zip-DFmzhJTx.js",
  "/assets/fuentes-DyB8PzMw.js",
  "/assets/fuentes-VTd7IE_V.css",
  "/assets/guia-BCDURxQf.css",
  "/assets/guia-DMo0b22p.js",
  "/assets/hls-CnncFJTh.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/index-C6iAWLwX.css",
  "/assets/index-CEeNuoXj.js",
  "/assets/install-BAIevpaj.js",
  "/assets/listas-Ces1X2SB.css",
  "/assets/listas-DynkZQkh.js",
  "/assets/mando-HoJPWNnB.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/mpegts-CIVTFH1h.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/panel-Ct5pvJmp.js",
  "/assets/partidos-CFjYtwx4.js",
  "/assets/partidos-CRqVGPIq.css",
  "/assets/player-BMWTPxcV.css",
  "/assets/player-DYCV1FDm.js",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/sala-D2gpVIIE.js",
  "/assets/sala-Dx9xFwoi.css",
  "/assets/timeline-DflQR6v7.js",
  "/assets/vendor-fOMIcxws.js",
  "/assets/virtual-B47nks72.js"
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
