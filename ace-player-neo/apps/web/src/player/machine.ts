/* Máquina de estados explícita de UNA reproducción (P15: en la 0.6.59 había
   dos capas de variables sueltas y contadores globales que se pisaban).

   Hay dos capas, pero cada una con su responsabilidad y sin solaparse:

   1. La CONEXIÓN (esta tabla): pedir la URL al backend, enganchar el motor,
      precargar el colchón, esperar el primer fotograma, reconectar o fallar.
      Es lo que en reproductor.md §2.2 se llama REPOSO, CONECTANDO,
      CARGA_INICIAL, RECONECTANDO, FALLIDO y TRASPASADO.
   2. El MEDIO (controller.ts): una vez hay imagen, la intención de quien mira
      (reproduciendo, en pausa, bloqueado, buscando, rellenando).

   `derivePhase` junta las dos en la fase pública que ve la interfaz:

     idle → cargando → reproduciendo ⇄ pausado / buffer / buscando / bloqueado
                          ↓ fallo
                     reconectando → cargando … o → error

   Una transición que no está en la tabla se ignora (y se avisa en
   desarrollo): así una respuesta tardía de una conexión vieja nunca puede
   devolver la máquina a un estado anterior. */

import type { ControllerPhase } from './controller.ts';

export type ConnState =
  /** Nada: sin canal, detenido o traspasado a otro dispositivo. */
  | 'idle'
  /** Pidiendo la URL a /api/v1/channels/:id/stream (el backend abre la sesión). */
  | 'pidiendo'
  /** URL concedida; el motor de vídeo se engancha y espera la primera información. */
  | 'conectando'
  /** Señal encontrada: llenando el colchón inicial del perfil. */
  | 'precarga'
  /** Colchón listo; play() pedido; esperando el PRIMER FOTOGRAMA real (P14). */
  | 'arrancando'
  /** Ya hubo imagen: manda el controlador del medio. */
  | 'activa'
  /** Esperando (con espera exponencial) para volver a conectar. */
  | 'reconectando'
  /** Reconexiones agotadas o un fallo que no se arregla reintentando. */
  | 'error';

export type ConnEvent =
  | 'solicitar'
  | 'concedida'
  | 'motor-listo'
  | 'colchon-listo'
  | 'primer-fotograma'
  /** Cambio de motor sin cortar la reproducción (D5: progresivo → HLS; motor reiniciado). */
  | 'reenganche'
  | 'fallo'
  | 'reintentar'
  | 'agotado'
  | 'detener'
  | 'traspaso';

const ALWAYS: Partial<Record<ConnEvent, ConnState>> = {
  solicitar: 'pidiendo',
  detener: 'idle',
  traspaso: 'idle',
};

const ATTEMPTING: Partial<Record<ConnEvent, ConnState>> = {
  ...ALWAYS,
  fallo: 'reconectando',
  agotado: 'error',
  reenganche: 'conectando',
};

export const TRANSITIONS: Readonly<Record<ConnState, Partial<Record<ConnEvent, ConnState>>>> = {
  idle: { solicitar: 'pidiendo', detener: 'idle' },
  // Sin URL concedida aún no hay motor que cambiar: `reenganche` no aplica.
  pidiendo: { ...ALWAYS, concedida: 'conectando', fallo: 'reconectando', agotado: 'error' },
  conectando: {
    ...ATTEMPTING,
    'motor-listo': 'precarga',
    // HLS nativo (Safari/iOS) no tiene colchón propio: el remux ya lo esperó.
    'colchon-listo': 'arrancando',
  },
  precarga: { ...ATTEMPTING, 'colchon-listo': 'arrancando' },
  arrancando: { ...ATTEMPTING, 'primer-fotograma': 'activa' },
  activa: { ...ATTEMPTING },
  reconectando: { ...ALWAYS, reintentar: 'pidiendo', agotado: 'error' },
  error: { ...ALWAYS },
};

export function nextState(state: ConnState, event: ConnEvent): ConnState | null {
  return TRANSITIONS[state][event] ?? null;
}

/** Fase pública de la reproducción: la que pinta la interfaz y ve el centro de partido. */
export type PlayerPhase =
  | 'idle'
  | 'cargando'
  | 'buffer'
  | 'reproduciendo'
  | 'pausado'
  | 'bloqueado'
  | 'buscando'
  | 'reconectando'
  | 'error';

export function derivePhase(conn: ConnState, media: ControllerPhase): PlayerPhase {
  switch (conn) {
    case 'idle':
      return 'idle';
    case 'pidiendo':
    case 'conectando':
    case 'precarga':
      return 'cargando';
    case 'arrancando':
      // El autoplay bloqueado se ve antes del primer fotograma: hay que enseñar el «toca».
      return media === 'blocked' ? 'bloqueado' : 'cargando';
    case 'reconectando':
      return 'reconectando';
    case 'error':
      return 'error';
    case 'activa':
      switch (media) {
        case 'blocked':
          return 'bloqueado';
        case 'seeking':
          return 'buscando';
        case 'buffering':
          return 'buffer';
        case 'playing':
          return 'reproduciendo';
        case 'starting':
          return 'cargando';
        case 'idle':
          return 'idle';
        default:
          return 'pausado';
      }
  }
}

/** Hay algo sonando o intentando sonar (para el mini-reproductor y el armazón). */
export function isEngaged(conn: ConnState): boolean {
  return conn !== 'idle' && conn !== 'error';
}
