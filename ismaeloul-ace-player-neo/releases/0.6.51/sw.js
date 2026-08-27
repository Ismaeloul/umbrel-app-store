/* Service worker de ACE·NEO.
   Cachea SOLO el armazon: html, fuentes, iconos y los reproductores. Nunca
   toca /api, /ace, /content ni /remux, que son datos vivos y video: servirlos
   desde cache daria agendas viejas o cortaria la reproduccion.
   El objetivo es que al abrir desde el icono del movil la app pinte al
   instante aunque la red vaya lenta. */
const VERSION = "aceneo-0.6.51";
const ARMAZON = [
  "/",
  "/vendor/hls.min.js",
  "/vendor/mpegts.js",
  "/player-controller.js",
  "/vendor/fonts/inter-var.woff2",
  "/vendor/fonts/outfit-var.woff2",
  "/vendor/fonts/jetbrains-mono-var.woff2",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(VERSION)
      // addAll falla entero si un recurso falla; asi cada uno va por su cuenta
      .then((cache) => Promise.allSettled(ARMAZON.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

const ES_DATO = (url) => /^\/(api|ace|content|remux)\//.test(url.pathname);

self.addEventListener("fetch", (evento) => {
  const peticion = evento.request;
  if (peticion.method !== "GET") return;
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;
  if (ES_DATO(url)) return;                      // datos y video: siempre a la red

  // El documento va primero a la red para no servir una version vieja, con la
  // cache como red de seguridad si no hay conexion.
  if (peticion.mode === "navigate") {
    evento.respondWith(
      fetch(peticion)
        .then((respuesta) => {
          const copia = respuesta.clone();
          caches.open(VERSION).then((cache) => cache.put("/", copia));
          return respuesta;
        })
        .catch(() => caches.match("/").then((r) => r || Response.error()))
    );
    return;
  }

  // Estaticos: cache primero, que no cambian dentro de una misma version.
  evento.respondWith(
    caches.match(peticion).then((enCache) => enCache || fetch(peticion).then((respuesta) => {
      if (respuesta.ok && respuesta.type === "basic") {
        const copia = respuesta.clone();
        caches.open(VERSION).then((cache) => cache.put(peticion, copia));
      }
      return respuesta;
    }))
  );
});
