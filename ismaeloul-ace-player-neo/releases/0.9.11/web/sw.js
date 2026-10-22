/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-0.9.11";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/BackupSection-BrF0ujyQ.js",
  "/assets/BackupSection-CQUgNgLX.css",
  "/assets/IptvSection-CGn3Dd2i.js",
  "/assets/IptvSection-DgAczCin.css",
  "/assets/LogsSection-BmRL9Fur.css",
  "/assets/LogsSection-Cshl-JuA.js",
  "/assets/Room-CfXguG99.js",
  "/assets/Room-Cg5cDWBL.css",
  "/assets/SistemaPage-CMpfZ1xC.js",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/agenda-DxLimm0-.css",
  "/assets/agenda-jzsvF9Pg.js",
  "/assets/ajustes-BqEoHBNL.css",
  "/assets/ajustes-C5YGuV3h.js",
  "/assets/base-Ch8LmrvN.css",
  "/assets/base-DVZtodBq.js",
  "/assets/base-Du2tPIF6.css",
  "/assets/base-ogxgEfuR.js",
  "/assets/canales-CgV5z9k1.css",
  "/assets/canales-CsaSCBYi.js",
  "/assets/cine-DNoUQdr6.css",
  "/assets/cine-DQr9lmEb.js",
  "/assets/comun-CVXAMk0f.js",
  "/assets/demo-D31Vye7g.js",
  "/assets/demo-data-1vQN8yV7.js",
  "/assets/demo-data-DlcPnJur.js",
  "/assets/demo-zip-B4klVUie.js",
  "/assets/engines-BAwsHJW6.js",
  "/assets/fuentes-CHpvYJP5.js",
  "/assets/fuentes-VTd7IE_V.css",
  "/assets/guia-BCDURxQf.css",
  "/assets/guia-OmIzBo0a.js",
  "/assets/hls-BUiA-fej.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/install-B8XQRH2g.js",
  "/assets/invitado-Bps99Ext.css",
  "/assets/invitado-Crjd8h1b.js",
  "/assets/juntos-DwFDgAtR.js",
  "/assets/listas-C9NB7GaG.js",
  "/assets/listas-CQGgYdA1.css",
  "/assets/main-CM934eIi.js",
  "/assets/mando-DY1GCu49.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-BauneF0G.js",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/panel-BCX7Jt28.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/partidos-CRqVGPIq.css",
  "/assets/partidos-DdhHrwHi.js",
  "/assets/player-BMWTPxcV.css",
  "/assets/player-CuwmB88w.js",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/sala-BN1PQxxx.js",
  "/assets/sala-Dx9xFwoi.css",
  "/assets/timeline-DflQR6v7.js",
  "/assets/vendor-fOMIcxws.js",
  "/assets/virtual-B_T0YzY-.js"
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
