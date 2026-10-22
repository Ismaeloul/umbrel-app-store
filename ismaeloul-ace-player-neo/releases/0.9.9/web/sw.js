/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-0.9.9";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/BackupSection-CQUgNgLX.css",
  "/assets/BackupSection-_pWTGdsf.js",
  "/assets/IptvSection-C6iTuGOG.js",
  "/assets/IptvSection-DgAczCin.css",
  "/assets/LogsSection-BXjm1CUk.js",
  "/assets/LogsSection-BmRL9Fur.css",
  "/assets/Room-By6zLxTB.js",
  "/assets/Room-Cg5cDWBL.css",
  "/assets/SistemaPage-BB31YRIA.js",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/agenda-BccsLZr_.js",
  "/assets/agenda-DxLimm0-.css",
  "/assets/ajustes-BqEoHBNL.css",
  "/assets/ajustes-DM5xkTrS.js",
  "/assets/base-BS1W6OHN.js",
  "/assets/base-Ch8LmrvN.css",
  "/assets/base-Du2tPIF6.css",
  "/assets/base-ogxgEfuR.js",
  "/assets/canales-CgV5z9k1.css",
  "/assets/canales-DISZ86Zc.js",
  "/assets/cine-CwSjVM3V.js",
  "/assets/cine-DNoUQdr6.css",
  "/assets/comun-BrLToOZf.js",
  "/assets/demo-data-BYIMxOCx.js",
  "/assets/demo-data-D_Bo69jb.js",
  "/assets/demo-mc3Hamqw.js",
  "/assets/demo-zip-X9dpWBpk.js",
  "/assets/engines-CWGBnA0I.js",
  "/assets/fuentes-VTd7IE_V.css",
  "/assets/fuentes-bSxSmjGL.js",
  "/assets/guia-BCDURxQf.css",
  "/assets/guia-CTN9_5Ld.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/hls-a8oA7TCs.js",
  "/assets/install-B2Xp-CJY.js",
  "/assets/invitado-BT9i6nv4.js",
  "/assets/invitado-Bps99Ext.css",
  "/assets/juntos-Ubzl5yrk.js",
  "/assets/listas-BxY59h4Y.js",
  "/assets/listas-CQGgYdA1.css",
  "/assets/main-7bqoJuS2.js",
  "/assets/mando-Cg5midCy.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/mpegts-Cw1q2Z6S.js",
  "/assets/panel-BH9MONiN.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/partidos-CRqVGPIq.css",
  "/assets/partidos-DVGs6A1c.js",
  "/assets/player-BMWTPxcV.css",
  "/assets/player-CmmU_ScJ.js",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/sala-D2bThJSM.js",
  "/assets/sala-Dx9xFwoi.css",
  "/assets/timeline-DflQR6v7.js",
  "/assets/vendor-fOMIcxws.js",
  "/assets/virtual-C-JNb2iK.js"
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
