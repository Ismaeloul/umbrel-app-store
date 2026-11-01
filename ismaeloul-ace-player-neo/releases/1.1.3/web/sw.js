/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-1.1.3";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/BackupSection-CQUgNgLX.css",
  "/assets/BackupSection-kcLuTVWv.js",
  "/assets/IptvSection-DgAczCin.css",
  "/assets/IptvSection-Dom0V3GO.js",
  "/assets/LiveMatches-D2trs5gx.js",
  "/assets/LivePanels-C81xPbua.css",
  "/assets/LivePanels-nd9Y_ck1.js",
  "/assets/LogsSection-BmRL9Fur.css",
  "/assets/LogsSection-Dp3qXw6X.js",
  "/assets/Room-5YdMf78C.js",
  "/assets/SistemaPage-DAQGsK2D.js",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/agenda-CTU7fi9Z.js",
  "/assets/agenda-RGKzuYgp.css",
  "/assets/ajustes-BakL_2D-.css",
  "/assets/ajustes-DN8Xtpkq.js",
  "/assets/base-B3ocrQ2B.css",
  "/assets/base-C9JGR-Xk.js",
  "/assets/base-C_qvAQgz.css",
  "/assets/base-DUgwV_fb.js",
  "/assets/canales-D9bFaMWN.css",
  "/assets/canales-P5CzR_Lh.js",
  "/assets/carteles-Bbe-KNoR.js",
  "/assets/cine-BKalTQ1s.css",
  "/assets/cine-k2lglHXn.js",
  "/assets/comun-DbormWIi.js",
  "/assets/controles-BP-u10UT.css",
  "/assets/controles-CpE-6Ptt.js",
  "/assets/demo-data-CTDtJcnF.js",
  "/assets/demo-data-D6JqGi8I.js",
  "/assets/demo-tLynL21M.js",
  "/assets/demo-zip-SMV0Rtl9.js",
  "/assets/fuentes-BFERZK0d.js",
  "/assets/fuentes-BTzl7kc1.css",
  "/assets/guia-C_x0ksr3.js",
  "/assets/guia-DK_84qKI.css",
  "/assets/hls-03vVbb3o.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/install-B6DlmBSt.js",
  "/assets/invitado-NULtKq64.js",
  "/assets/invitado-mYqSHo9W.css",
  "/assets/juntos-9NFlHl6F.css",
  "/assets/juntos-C0xMiXl7.js",
  "/assets/juntos-Sx-Fm6JE.js",
  "/assets/listas-CQGgYdA1.css",
  "/assets/listas-wVRIBWWY.js",
  "/assets/main-CELal1ug.js",
  "/assets/mando-Bd__qG8T.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/mpegts-DG1JIhQq.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/panel-CE2vJxGr.js",
  "/assets/partidos-BDJlA0dt.js",
  "/assets/partidos-CRqVGPIq.css",
  "/assets/player-Bb1dm_iy.js",
  "/assets/player-BrGORlDG.css",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/sala-Dx9xFwoi.css",
  "/assets/sala-oyVs8eFV.js",
  "/assets/toque-hicvAZoX.js",
  "/assets/vendor-fOMIcxws.js",
  "/assets/virtual-Ds6i1aP5.js",
  "/assets/vod-B1Y-Azny.css",
  "/assets/vod-C7fzSO79.js"
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
