/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-0.9.15";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/BackupSection-BPpvcTT7.js",
  "/assets/BackupSection-CQUgNgLX.css",
  "/assets/IptvSection-CVvU8MO8.js",
  "/assets/IptvSection-DgAczCin.css",
  "/assets/LogsSection-BmRL9Fur.css",
  "/assets/LogsSection-D5yg6iMs.js",
  "/assets/Room-D5gjcXAO.js",
  "/assets/SistemaPage-CmvkDmT0.js",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/agenda-CZ3KY3lj.js",
  "/assets/agenda-DxLimm0-.css",
  "/assets/ajustes-BqEoHBNL.css",
  "/assets/ajustes-HUfLvWt9.js",
  "/assets/base-B889aJ2D.js",
  "/assets/base-BESaKXkf.js",
  "/assets/base-C6iAWLwX.css",
  "/assets/base-DuBuKzaj.css",
  "/assets/canales-BXEepcFY.js",
  "/assets/canales-CgV5z9k1.css",
  "/assets/cine-BBo3WVic.css",
  "/assets/cine-C2hUPhgA.js",
  "/assets/comun-_i81XypF.js",
  "/assets/demo-DzBr1nQd.js",
  "/assets/demo-data-BlhF5VUM.js",
  "/assets/demo-data-DudbPCcA.js",
  "/assets/demo-zip-bRdcdz_-.js",
  "/assets/fuentes-DFS6xZuK.js",
  "/assets/fuentes-VTd7IE_V.css",
  "/assets/guia-BCDURxQf.css",
  "/assets/guia-CxcyuEao.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/hls-x8oQYkuS.js",
  "/assets/install-Bqghq_fY.js",
  "/assets/invitado-B_kgMUqa.js",
  "/assets/invitado-Bps99Ext.css",
  "/assets/juntos-hRRKdTIr.js",
  "/assets/listas-BQYDgmyV.js",
  "/assets/listas-CQGgYdA1.css",
  "/assets/main-DHXZ3w_K.js",
  "/assets/mando-BZFoXqTT.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-Bggh3LJM.js",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/panel-DnYHjXKt.js",
  "/assets/partidos-Buap1Ewq.js",
  "/assets/partidos-CRqVGPIq.css",
  "/assets/player-DBBqIy2j.css",
  "/assets/player-Nne17dxB.js",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/sala-B3XdG2X4.js",
  "/assets/sala-Dx9xFwoi.css",
  "/assets/timeline-DflQR6v7.js",
  "/assets/vendor-fOMIcxws.js",
  "/assets/virtual-C_03M8GJ.js",
  "/assets/vod-B1Y-Azny.css",
  "/assets/vod-Bmk6pC29.js"
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
