/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';

// Para que la app instalada abra y enseñe algo aunque el NAS no conteste: en
// el metro, con el movil sin cobertura, o con el Umbrel apagado. Lo que ves
// entonces es la ultima lectura buena, no datos en vivo.

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `saldo-${version}`;
const ESTATICOS = [...build, ...files];

sw.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ESTATICOS)).then(() => sw.skipWaiting())
  );
});

sw.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => sw.clients.claim())
  );
});

sw.addEventListener('fetch', (evento) => {
  const peticion = evento.request;

  // Solo se cachea lo que se pide para leer. Un POST (recargar, cuadrar,
  // añadir) tiene que llegar al servidor o fallar de verdad: guardarlo seria
  // mentir sobre algo que toca dinero.
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);
  if (url.origin !== location.origin) return;
  if (url.pathname === '/health') return;

  // Lo de la build no cambia nunca dentro de una version: de cache y listo.
  if (ESTATICOS.includes(url.pathname)) {
    evento.respondWith(
      caches.match(peticion).then((guardado) => guardado ?? fetch(peticion))
    );
    return;
  }

  // Las paginas: primero la red, y si no hay, lo ultimo que se vio.
  evento.respondWith(
    fetch(peticion)
      .then((respuesta) => {
        if (respuesta.ok) {
          const copia = respuesta.clone();
          caches.open(CACHE).then((cache) => cache.put(peticion, copia));
        }
        return respuesta;
      })
      .catch(async () => {
        const guardado = await caches.match(peticion);
        if (guardado) return guardado;
        throw new Error('sin red y sin copia guardada');
      })
  );
});
