/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-0.8.4";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/BackupSection-CQUgNgLX.css",
  "/assets/BackupSection-DVvQb02h.js",
  "/assets/IptvSection-DgAczCin.css",
  "/assets/IptvSection-yD9CIhBY.js",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/SistemaPage-Doy0RJeI.js",
  "/assets/agenda-Cv6-6oyH.css",
  "/assets/agenda-DKH9uDR7.js",
  "/assets/ajustes-BQn1AEkc.js",
  "/assets/ajustes-CKZhzNs6.css",
  "/assets/base-CKTYiyNo.css",
  "/assets/base-rMSko6qL.js",
  "/assets/canales-CSVty1kI.js",
  "/assets/canales-YdKIP_VS.css",
  "/assets/comun-uPsk3XwN.js",
  "/assets/demo-0Ik7O82C.js",
  "/assets/demo-data-8kz86GU0.js",
  "/assets/fuentes-CyLr-STw.css",
  "/assets/fuentes-DPZncNQT.js",
  "/assets/hls-BHIpauAi.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/index-CLhhUjrF.js",
  "/assets/index-D4UuFi7C.css",
  "/assets/install-Bo40X2Yw.js",
  "/assets/listas-Ces1X2SB.css",
  "/assets/listas-mZ6TZJyV.js",
  "/assets/mando-gru1svCB.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/mpegts-D4x79Slt.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/panel-duD0p6Hl.js",
  "/assets/partidos-B-Kv3B9b.js",
  "/assets/player-B6bJZSHN.css",
  "/assets/player-COy-NLoz.js",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/vendor-Ldb2EqeX.js",
  "/assets/virtual-BGR6Xyta.js"
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
