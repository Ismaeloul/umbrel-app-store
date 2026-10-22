/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-0.9.10";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/BackupSection-Bvjt4zzv.js",
  "/assets/BackupSection-CQUgNgLX.css",
  "/assets/IptvSection-BK71czYL.js",
  "/assets/IptvSection-DgAczCin.css",
  "/assets/LogsSection-2w1-i_hy.js",
  "/assets/LogsSection-BmRL9Fur.css",
  "/assets/Room-Cg5cDWBL.css",
  "/assets/Room-CjpjIt_A.js",
  "/assets/SistemaPage-CAgzY5ik.js",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/agenda-DYRLgLCb.js",
  "/assets/agenda-DxLimm0-.css",
  "/assets/ajustes-BlzdQFc3.js",
  "/assets/ajustes-BqEoHBNL.css",
  "/assets/base-Ch8LmrvN.css",
  "/assets/base-Du2tPIF6.css",
  "/assets/base-ogxgEfuR.js",
  "/assets/base-wf2-DtR_.js",
  "/assets/canales-CgV5z9k1.css",
  "/assets/canales-ks7F57Q8.js",
  "/assets/cine-Bc0RHUIL.js",
  "/assets/cine-DNoUQdr6.css",
  "/assets/comun-Cxoq6GHm.js",
  "/assets/demo-DqHXOjHB.js",
  "/assets/demo-data-BsVmhqCt.js",
  "/assets/demo-data-E-PMh6h3.js",
  "/assets/demo-zip-Ba8dWCrk.js",
  "/assets/engines-Dkf-Hr-k.js",
  "/assets/fuentes-DkhU35vN.js",
  "/assets/fuentes-VTd7IE_V.css",
  "/assets/guia-B48vG2Mt.js",
  "/assets/guia-BCDURxQf.css",
  "/assets/hls-Mtj8u-cm.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/install-DQL8zoGH.js",
  "/assets/invitado-Bps99Ext.css",
  "/assets/invitado-DMaKuOkk.js",
  "/assets/juntos-C_uIpBuU.js",
  "/assets/listas-Bj389SkL.js",
  "/assets/listas-CQGgYdA1.css",
  "/assets/main-C4VT4NCt.js",
  "/assets/mando-aU1ggBAM.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/mpegts-Dhxednme.js",
  "/assets/panel-BQ7owv2m.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/partidos-CRqVGPIq.css",
  "/assets/partidos-ewLnyLzp.js",
  "/assets/player-BMWTPxcV.css",
  "/assets/player-D08EU_Lz.js",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/sala-Dx9xFwoi.css",
  "/assets/sala-xh3JoNxO.js",
  "/assets/timeline-DflQR6v7.js",
  "/assets/vendor-fOMIcxws.js",
  "/assets/virtual-Cv-xavhl.js"
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
