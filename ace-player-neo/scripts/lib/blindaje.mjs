// Cargas para intentar romper el blindaje de la ruta nativa (arquitectura §8).
//
// Las usan dos pruebas con la misma lista, para que no se separen:
// - deploy/test/nginx.test.ts: simula en JavaScript los map de nginx.conf y la
//   pasarela falsa (rápido, sin Docker);
// - scripts/test-nginx-docker.mjs: las manda de verdad al nginx real, con y sin
//   la pasarela falsa delante.
//
// Regla que tienen que cumplir TODAS: o nginx la corta (400/403), o la pasarela
// pide login (401), o llega al backend con X-Ace-Origin: native. Nunca puede
// llegar al backend como web sin haber pasado el login, ni al motor.

/**
 * @typedef {object} Payload
 * @property {string} path     petición cruda, tal cual sale por el socket
 * @property {boolean} native  la URI cruda es "nativa": ni siquiera sin
 *                             pasarela (nginx directo) puede tratarse como web
 * @property {string} why      qué intenta
 */

/** @type {Payload[]} */
export const ASSAULT_PAYLOADS = [
  { path: '/native/..%2Fapi/state', native: true, why: '%2F en mayúsculas' },
  { path: '/native/%2F..%2Fapi/state', native: true, why: 'barra codificada antes de ..' },
  { path: '/native/api%2F..%2F..%2Fapi/state', native: true, why: 'subir dos niveles con %2F' },
  { path: '/native/%2e%2e%2fapi/state', native: true, why: 'todo codificado' },
  { path: '/native/.%2e/api/state', native: true, why: 'medio punto codificado' },
  { path: '/native/..%5Capi/state', native: true, why: '%5C en mayúsculas' },
  { path: '/native/%5c..%5capi/state', native: true, why: 'barras invertidas codificadas' },
  { path: '/native/..%252fapi/state', native: true, why: 'doble codificación con ..' },
  { path: '/native/%252e%252e%252fapi/state', native: true, why: 'doble codificación completa' },
  { path: '/native/%252e%252e/api/state', native: true, why: 'puntos doblemente codificados' },
  { path: '/native/./../api/state', native: true, why: '. y .. seguidos' },
  { path: '/native/./api/v1/ping', native: true, why: '. dentro de la ruta nativa' },
  { path: '/native/..', native: true, why: '.. al final' },
  { path: '/native/..;/api/state', native: true, why: '..; como en Tomcat' },
  { path: '/native;/../api/state', native: true, why: ';/.. tras el prefijo' },
  { path: '/native;/api/state', native: true, why: '; pegado al prefijo' },
  { path: '/native/;/api/state', native: true, why: 'segmento ;' },
  { path: '/NATIVE/api/state', native: true, why: 'prefijo en mayúsculas' },
  { path: '/NATIVE/..%2fapi/state', native: true, why: 'mayúsculas y %2f' },
  { path: '/Native/../api/state', native: true, why: 'mayúsculas y ..' },
  { path: '/nativeX/api/state', native: true, why: 'prefijo alargado' },
  { path: '//native/..%2fapi/state', native: false, why: 'doble barra y %2f' },
  { path: '//native/api/v1/ping', native: false, why: 'doble barra: otro host para la pasarela' },
  { path: '/./native/api/v1/ping', native: false, why: '. antes del prefijo' },
  { path: '//api/state', native: false, why: 'doble barra a la API web' },
  { path: '/api/../native/api/v1/ping', native: false, why: 'la pasarela la resuelve a /native/' },
  { path: '/api/%2e%2e/native/api/v1/ping', native: false, why: 'ídem con %2e%2e' },
  { path: '/api/state?x=/../native/', native: false, why: '.. en la query de una ruta web' },
  { path: '/native/api/v1/ping?next=/../../api/state', native: true, why: '.. en la query' },
  { path: '/native/api/v1/ping?q=%2f..%2f', native: true, why: '%2f y .. en la query' },
  /* Revisión de seguridad (docs/seguridad.md, S-01): con "//" delante, la
     pasarela toma lo primero como HOST y decide con lo que va detrás
     (/native/…, lista blanca), pero nginx junta las barras y lo primero pasa a
     ser una location web. Sin la regla "^//" de $ace_bad_uri estas llegaban
     sin login al backend como web, al motor o a la web estática. */
  { path: '//api/native/state', native: false, why: 'S-01: host "api" para la pasarela' },
  { path: '///api/native/state', native: false, why: 'S-01: tres barras' },
  { path: '//api/native/v1/ping', native: false, why: 'S-01: hacia /api/ con aspecto v1' },
  { path: '//ace/native/getstream?id=x', native: false, why: 'S-01: al motor sin login' },
  { path: '//content/native/x', native: false, why: 'S-01: contenido del motor' },
  { path: '//remux/native/x/index.m3u8', native: false, why: 'S-01: /remux/ sin login' },
  { path: '//assets/native/x.js', native: false, why: 'S-01: estáticos sin login' },
  { path: '//API/native/state', native: false, why: 'S-01: host en mayúsculas' },
  { path: '//x@api/native/state', native: false, why: 'S-01: usuario@host' },
  /* Forma absoluta ("GET http://host/ruta"): la pasarela y nginx deciden con
     la ruta que va detrás del host; la de /native/ acaba como native. */
  { path: 'http://api/native/state', native: false, why: 'forma absoluta' },
  { path: 'http://api//api/native/state', native: false, why: 'forma absoluta con //' },
  { path: 'http://x/native/api/v1/ping', native: false, why: 'forma absoluta a /native/' },
  { path: '/native/api/v1/ping%00', native: true, why: '%00 al final' },
  { path: '/native/api/v1/ping/%2e', native: true, why: '%2e como último segmento' },
];

/**
 * Cargas que `http.request` de Node no deja ni mandar (caracteres de control,
 * tabuladores, "#" y formas de URL que solo caben en la línea de petición).
 * Importan porque el parser WHATWG de la pasarela QUITA los tabuladores y
 * saltos de línea de cualquier sitio y los controles del principio, corta en
 * "#" y entiende "http:api/…" como host "api": si nginx recibiera alguna tal
 * cual, la pasarela vería /native/* donde nginx ve otra cosa. Solo las manda
 * scripts/test-nginx-docker.mjs, por un socket, a la pasarela y a los dos
 * nginx (revisión de seguridad, docs/seguridad.md §3.4). La regla es la misma
 * que la de ASSAULT_PAYLOADS (judgeOutcome).
 * @type {{ target: string, why: string }[]}
 */
export const RAW_SOCKET_PAYLOADS = [
  { target: '/api/.\t./native/api/v1/ping', why: 'tabulador dentro de ".."' },
  { target: '/api/\t../native/api/v1/ping', why: 'tabulador antes de ".."' },
  { target: '/\t/api/native/state', why: 'tabulador entre las dos barras (host "api")' },
  { target: '\x01//api/native/state', why: 'control al principio' },
  { target: '/api/..\x0b/native/state', why: 'tabulador vertical' },
  { target: '/native/api/v1/ping\x00', why: 'NUL al final' },
  { target: '/native/x#/../../api/state', why: '"#" y ".." detrás' },
  { target: '/native/api/v1/ping#/../../../ace/getstream', why: '"#" hacia el motor' },
  { target: 'HTTP://api/native/state', why: 'forma absoluta en mayúsculas' },
  { target: 'http:api/native/state', why: 'esquema sin barras (host "api")' },
  { target: 'http:native/api/v1/ping', why: 'esquema sin barras ni host' },
  { target: 'https:api/native/state', why: 'https sin barras' },
  { target: 'ws://api/native/x', why: 'otro esquema en forma absoluta' },
  { target: 'http://api:80/native/x', why: 'forma absoluta con puerto' },
  { target: 'api/native/state', why: 'sin barra inicial' },
];

/**
 * Aproximación de lo que hace nginx con la ruta antes de elegir location:
 * decodifica %XX una vez, junta barras y resuelve "." y "..". Solo sirve para
 * la simulación rápida; la prueba de verdad es la de Docker.
 * @param {string} rawPath
 */
export function nginxNormalizedPath(rawPath) {
  // Forma absoluta ("GET http://host/ruta"): nginx elige location con la ruta
  // que va detrás del host, así que el esquema y el host no cuentan.
  const target = rawPath.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');
  const pathPart = target.split('?')[0] ?? '';
  let decoded;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    decoded = pathPart;
  }
  /** @type {string[]} */
  const out = [];
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return `/${out.join('/')}${decoded.endsWith('/') && out.length > 0 ? '/' : ''}`;
}

/**
 * @typedef {object} Outcome
 * @property {number} status
 * @property {boolean} gatewayLogin  la respuesta es el "login" de la pasarela
 * @property {string | undefined} service  "storage" | "motor" si llegó a un eco
 * @property {string | undefined} origin   X-Ace-Origin que vio el backend
 */

/**
 * true si el resultado cumple la regla; si no, el motivo.
 * @param {Outcome} outcome
 * @returns {true | string}
 */
export function judgeOutcome(outcome) {
  if (outcome.status === 400 || outcome.status === 403) return true;
  if (outcome.status === 401 && outcome.gatewayLogin) return true;
  if (outcome.service === 'storage' && outcome.origin === 'native') return true;
  if (outcome.service === 'storage')
    return `llegó al backend con origen ${outcome.origin ?? '(ninguno)'}`;
  if (outcome.service === 'motor') return 'llegó al motor';
  return `HTTP ${outcome.status} sin pasar por el backend (contenido web servido)`;
}
