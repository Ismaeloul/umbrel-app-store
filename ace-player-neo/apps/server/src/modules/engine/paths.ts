/* Rutas del motor AceStream reducidas a ruta relativa (arquitectura §5.5).

   El motor devuelve URL absolutas con su propio host (`http://<motor>:6878/…`)
   y el backend nunca debe seguir un host que venga en una respuesta: se
   queda solo con la ruta y la consulta, y solo si empieza por `/ace/` o
   `/content/`. Es la regla de `scannerEnginePath` de la 0.6.59
   (server.js:2842-2852, T-072), que ahora vale también para el motor
   principal. */

/** Longitud máxima que se acepta (server.js:2844). */
const MAX_ENGINE_URL_LENGTH = 4096;

/**
 * `scannerEnginePath` (server.js:2842-2852): `/ace/…` o `/content/…` con su
 * consulta, sin host; `""` si no es una ruta del motor.
 */
export function engineRelativePath(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw || raw.length > MAX_ENGINE_URL_LENGTH) return '';
  try {
    /* La base solo sirve para resolver rutas relativas: el host que traiga
       la URL se descarta al quedarnos con pathname + search. */
    const parsed = new URL(raw, 'http://engine:6878');
    if (!parsed.pathname.startsWith('/ace/') && !parsed.pathname.startsWith('/content/')) return '';
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '';
  }
}

/**
 * `scannerStopPath` (server.js:2854-2860): la `command_url` con
 * `method=stop`; `""` si no es una ruta del motor.
 */
export function engineStopPath(value: unknown): string {
  const pathname = engineRelativePath(value);
  if (!pathname) return '';
  const parsed = new URL(pathname, 'http://engine');
  parsed.searchParams.set('method', 'stop');
  return `${parsed.pathname}${parsed.search}`;
}

/** Host listo para una URL: los IPv6 literales van entre corchetes (tests en `::1`). */
export function hostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}
