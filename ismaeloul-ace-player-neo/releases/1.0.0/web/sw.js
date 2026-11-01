/* Service worker de ACE·NEO. Lo genera scripts/release.mjs a partir de
   scripts/templates/sw.js: en la release llevan valor VERSION y la lista de
   precarga, que sale de los assets del build.
   Cachea SOLO el armazón: el documento, los assets de Vite (con hash en el
   nombre), los iconos y el manifiesto. Nunca toca /api, /ace, /content, /remux
   ni /native, que son datos vivos y vídeo: servirlos desde caché daría agendas
   viejas o cortaría la reproducción.
   VERSION cambia en cada release: al activarse, el worker nuevo borra las cachés
   de las demás versiones y el móvil deja de usar los ficheros viejos. */
const VERSION = "aceneo-1.0.0";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/assets/BackupSection-CQUgNgLX.css",
  "/assets/BackupSection-CqFp-aDS.js",
  "/assets/IptvSection-DgAczCin.css",
  "/assets/IptvSection-x77WB9BH.js",
  "/assets/LogsSection-BmRL9Fur.css",
  "/assets/LogsSection-CCRk4Unw.js",
  "/assets/Room-Bv5Y-L8x.js",
  "/assets/SistemaPage-DNnKm6mx.css",
  "/assets/SistemaPage-DpyI2JXL.js",
  "/assets/agenda-DPMfvR_a.css",
  "/assets/agenda-DsHDQvHI.js",
  "/assets/ajustes-CYrZva0z.css",
  "/assets/ajustes-Dnz2k03h.js",
  "/assets/base-D-MpoSwR.css",
  "/assets/base-DDWBGmp6.css",
  "/assets/base-DnDkXlKQ.js",
  "/assets/base-phubZrtK.js",
  "/assets/canales-5r8DtxpG.js",
  "/assets/canales-BmmXldzh.css",
  "/assets/cine-7hiuXd05.js",
  "/assets/cine-DARlmNdd.css",
  "/assets/comun-D8OtKF4H.js",
  "/assets/demo-_LiBjogj.js",
  "/assets/demo-data-Bxax88TY.js",
  "/assets/demo-data-D6aq01Eg.js",
  "/assets/demo-zip-C-ZWYqYV.js",
  "/assets/fuentes-CoT5V53Y.js",
  "/assets/fuentes-DNmg2DU7.css",
  "/assets/guia-CKZL7or1.js",
  "/assets/guia-Crnb5WIs.css",
  "/assets/hls-D9EIH-fv.js",
  "/assets/hls-Ok7uQZH_.js",
  "/assets/install-C1A96wPX.js",
  "/assets/invitado-Bps99Ext.css",
  "/assets/invitado-DM4A4u0j.js",
  "/assets/juntos-DxEl5JKz.js",
  "/assets/listas-CQGgYdA1.css",
  "/assets/listas-Ca8aLCyi.js",
  "/assets/main-7lpdAwdn.js",
  "/assets/mando-2eWB-uNB.js",
  "/assets/martian-mono-latin-wdth-normal-1TqSgyfh.woff2",
  "/assets/mona-sans-latin-wdth-normal-BMVx8nn_.woff2",
  "/assets/mpegts-BoNmE14t.js",
  "/assets/mpegts-Dvy6C5-x.js",
  "/assets/panel-B_dsqLvg.css",
  "/assets/panel-BrtCO8NA.js",
  "/assets/partidos-CRqVGPIq.css",
  "/assets/partidos-Cwjv7r0y.js",
  "/assets/player-BOLvict0.css",
  "/assets/player-u9X8n9rD.js",
  "/assets/rolldown-runtime-hePW80VL.js",
  "/assets/sala-BIMXnJG3.js",
  "/assets/sala-Dx9xFwoi.css",
  "/assets/vendor-fOMIcxws.js",
  "/assets/virtual-DNSMsrgj.js",
  "/assets/vod-B1Y-Azny.css",
  "/assets/vod-DlP7D3hs.js"
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
