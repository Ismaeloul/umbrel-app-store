/* Desalojo de sesiones del remux con el tope de 3 (server.js:196-209; T-112,
   B-223): se desaloja primero la que ya no tiene espectadores (sin clientes o
   con ffmpeg terminado), la de acceso más antiguo entre ellas. Si todas
   tienen espectadores, null: el que llega recibe 503 `remux_busy` y nadie se
   queda a oscuras. */

export interface EvictionCandidate {
  readonly lastAccess: number;
  readonly clients?: { readonly size: number } | null;
  readonly exited: boolean;
}

/** `elegirSesionRemuxADesalojar` (server.js:201-209), tal cual. */
export function elegirSesionRemuxADesalojar<K>(
  sessions: ReadonlyMap<K, EvictionCandidate>,
): K | null {
  let elegida: { key: K; lastAccess: number } | null = null;
  for (const [key, session] of sessions) {
    const libre = session.exited || !session.clients || session.clients.size === 0;
    if (!libre) continue;
    if (!elegida || session.lastAccess < elegida.lastAccess) {
      elegida = { key, lastAccess: session.lastAccess };
    }
  }
  return elegida ? elegida.key : null;
}
