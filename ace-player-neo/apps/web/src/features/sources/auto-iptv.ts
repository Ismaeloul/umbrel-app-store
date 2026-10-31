/* El partido que la Agenda de escritorio abre sola al entrar (sin que lo
   pidas): lo automático de ese partido arranca solo por AceStream y no toca tu
   IPTV, que tiene una conexión por cuenta y se la quitaría a otro aparato.
   Aparte de session.ts para que la Agenda no cargue todo el módulo de fuentes. */

let aceOnlyMatch: string | null = null;

/** Lo marca la Agenda antes de abrir el destacado; null al abrir uno a mano. */
export function autoStartWithoutIptv(matchId: string | null): void {
  aceOnlyMatch = matchId;
}

/** ¿Lo automático de esta sesión (`m:<id>`) puede usar tu IPTV? */
export function autoMayUseIptv(sessionKey: string | null): boolean {
  return aceOnlyMatch === null || sessionKey !== `m:${aceOnlyMatch}`;
}
