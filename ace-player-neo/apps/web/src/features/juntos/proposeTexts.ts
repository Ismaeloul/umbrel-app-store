/* Textos de «proponer desde la sala» (docs/ver-juntos.md §11 y §15): Pelis y
   series eligiendo para una sala, la cola de Siguiente y «Salas abiertas».
   Los de la sala en sí son de texts.ts (JUNTOS_TEXT). */

import type { PartyQueueMode } from '@ace/shared';

/** La pista bajo el botón, según la regla de la sala. */
const MODE_HINT: Record<PartyQueueMode, string> = {
  vote: 'Se vota en Siguiente',
  autoplay: 'Va a la cola, en orden',
  leader: 'El líder elige entre lo propuesto',
  once: 'Queda en Siguiente; al acabar, la sala se para',
};

/** Siguiente vacío, según la regla (para quien puede proponer desde casa). */
const EMPTY_HINT: Record<PartyQueueMode, string> = {
  vote: 'Propón algo y que voten los demás: al acabar, gana lo más votado.',
  autoplay: 'Propón algo: al acabar, empieza lo primero de la lista.',
  leader: 'Propón algo: al acabar, el líder elige qué va.',
  once: 'Propón algo; al acabar, la sala se para hasta que alguien lo ponga.',
};

/** La regla en una línea, para quien no la puede cambiar. */
const RULE_LINE: Record<PartyQueueMode, (leader: string) => string> = {
  vote: (leader) => `Cuando acabe: el más votado · lo decide ${leader}`,
  autoplay: (leader) => `Cuando acabe: el primero de la lista · lo decide ${leader}`,
  leader: (leader) => `Cuando acabe: lo elige ${leader} entre lo propuesto`,
  once: (leader) => `Cuando acabe: la sala se para · lo decide ${leader}`,
};

export const PROPOSE_TEXT = {
  /* Pelis y series eligiendo para una sala (la barra de arriba). */
  picking: (host: string) => `Eligiendo para la sala de ${host}`,
  /* La barra, en corto (cabe a 360 px): «Para la sala de Isma» y «Ahora: Dune». */
  pickingShort: (host: string) => `Para la sala de ${host}`,
  pickingNow: (title: string) => `Ahora: ${title}`,
  pickingUnread: (n: number) => (n === 1 ? '1 sin leer' : `${n} sin leer`),
  backToRoom: 'Volver a la sala',
  leavePicking: 'Dejar de elegir',
  connecting: 'Conectando con la sala…',
  roomGone: 'La sala ya no está abierta.',
  /* Las acciones de la ficha (y de un episodio). */
  putNow: 'Poner en la sala ahora',
  putConfirm: (current: string, next: string) => `Se corta ${current} para todos. ¿Poner ${next}?`,
  propose: 'Proponer a la sala',
  modeHint: (mode: PartyQueueMode) => MODE_HINT[mode],
  soloLink: 'Reproducir solo para mí',
  soloConfirm: 'Esto corta la sala para todos (una sola plaza de la IPTV). Pulsa otra vez',
  proposed: 'Propuesto en la sala.',
  put: 'Puesto en la sala para todos.',
  episodeSheet: 'Para la sala',
  /* Siguiente. */
  proposeSticky: 'Proponer una peli o serie',
  emptyHint: (mode: PartyQueueMode) => EMPTY_HINT[mode],
  emptyGuest: 'Cuando alguien proponga algo, lo verás aquí para votarlo.',
  ruleLine: (mode: PartyQueueMode, leader: string) => RULE_LINE[mode](leader),
  justProposed: 'Recién propuesto',
  /* «Ver juntos» en la ficha cuando la última sala es de directo. */
  liveRoomNoPropose: 'Tu última sala es un partido: allí no hay lista.',
  /* Salas abiertas (portada de Ver juntos). */
  openLive: 'En directo',
  openVod: 'Pelis y series',
  liveBadge: 'DIRECTO',
  openFailed: 'No se pueden cargar las salas',
  retry: 'Reintentar',
  /* Portada de Ver juntos: las dos maneras de empezar. */
  startTitle: 'Empezar una sala',
  startVod: 'Una peli o serie',
  startVodHint: 'Ir a Pelis y series y, en la ficha, «Ver juntos».',
  startLive: 'Un partido',
  startLiveHint: 'Ir a la Agenda y, en el partido, «Ver juntos».',
} as const;
