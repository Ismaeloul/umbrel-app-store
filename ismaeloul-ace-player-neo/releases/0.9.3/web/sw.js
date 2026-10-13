/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-0.9.3";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/BackupSection-CQUgNgLX.css",
  "/assets/BackupSection-CaMBkpu4.js",
  "/assets/IptvSection-DgAczCin.css",
  "/assets/IptvSection-DxOz27fK.js",
  "/assets/LogsSection-B9Y-0RDp.js",
  "/assets/LogsSection-BmRL9Fur.css",
  "/assets/SistemaPage-DF2LYuyM.js",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/agenda-BHMvp_WA.js",
  "/assets/agenda-DxLimm0-.css",
  "/assets/ajustes-BqEoHBNL.css",
  "/assets/ajustes-DGDo3A6w.js",
  "/assets/base-BeZjpQO2.js",
  "/assets/base-Du2tPIF6.css",
  "/assets/canales-BsZrmZOW.js",
  "/assets/canales-CgV5z9k1.css",
  "/assets/cine-DNoUQdr6.css",
  "/assets/cine-Dx3HNN8R.js",
  "/assets/comun-Ck6r7Jsy.js",
  "/assets/demo-DMpls_6P.js",
  "/assets/demo-data-B5x-yvGe.js",
  "/assets/demo-data-C9bSt7Id.js",
  "/assets/demo-zip-oyGz0_D9.js",
  "/assets/fuentes-CoyzyRsn.js",
  "/assets/fuentes-VTd7IE_V.css",
  "/assets/guia-BCDURxQf.css",
  "/assets/guia-CK0wIV8D.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/hls-UaGwsmjS.js",
  "/assets/index-C6iAWLwX.css",
  "/assets/index-T9o2Zk7b.js",
  "/assets/install-CmyPkLQJ.js",
  "/assets/listas-CPzhoFBl.js",
  "/assets/listas-Ces1X2SB.css",
  "/assets/mando-DLgxgBPU.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/mpegts-CVd_nz2b.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/panel-CS9FfjDo.js",
  "/assets/partidos-CRqVGPIq.css",
  "/assets/partidos-D1jBctPf.js",
  "/assets/player-BMWTPxcV.css",
  "/assets/player-DdydrETj.js",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/sala-Dx9xFwoi.css",
  "/assets/sala-tGoP6tMH.js",
  "/assets/timeline-DflQR6v7.js",
  "/assets/vendor-fOMIcxws.js",
  "/assets/virtual-DbC6b_PE.js"
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
