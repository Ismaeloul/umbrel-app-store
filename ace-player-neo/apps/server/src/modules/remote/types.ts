/* Módulo `remote`: el dominio de la app de iPhone fuera de casa, `https://tv.ismaeloul.es`
   (docs/acceso-remoto.md, «Por el dominio»).

   - Permiso por aparato «Acceso desde fuera de casa (tv.ismaeloul.es)», apagado por defecto, con
     caducidad (24 h, 7 días, 30 días o sin caducidad), y un interruptor general («Cerrar el dominio
     ya»). Solo se cambia desde la web. v2/remote-access.json (0600), aparte de devices.json.
   - Registro de sucesos (v2/remote-events.json): IP nueva de un aparato, aparato sin permiso,
     bloqueos, caducidades… Un anillo de 500 y 30 días. Las IPs solo salen aquí y en la web.
   - Bloqueo por fuerza bruta por IP (v2/remote-blocks.json): 8 respuestas 401/403/404 en 10 min →
     15 min; ×4 en cada reincidencia hasta 24 h; el nivel se olvida a los 7 días. Una IP bloqueada
     sigue pudiendo entrar con un token bueno CON permiso: el bloqueo es para quien no tiene llave
     (la IP de un móvil se comparte con mucha gente por CGNAT).
   - Límites de peticiones por IP y por aparato (cubos de fichas en memoria), API y vídeo aparte.
   - La IP de Caddy (`ACE_EDGE_PEER`): solo él puede hablar con el puerto del dominio.

   Lo que hace cada petición por el dominio, en orden, está en core/remote-gate.ts. */

import type {
  BootstrapRemote,
  DeviceRemoteBody,
  RemoteUnblockResponse,
  RemoteView,
} from '@ace/shared';
import type { EdgeLookup, EdgePeer } from '../../core/edge.js';
import type { CoreDeps, Lifecycle } from '../../core/module.js';
import type { AuthService } from '../auth/types.js';
import type { EventsHub } from '../events/types.js';

export interface RemoteDeps extends CoreDeps {
  readonly auth: AuthService;
  readonly events: EventsHub;
  /** Resolución de `ACE_EDGE_PEER` (los tests la cambian por una fija). */
  readonly lookup?: EdgeLookup;
}

/** Lo que el dominio sabe de quien llama (sale de `X-Ace-Client-Ip`, core/edge.ts). */
export interface RemoteClient {
  readonly ip: string | null;
  readonly key: string | null;
  /** IP de internet: cuenta para bloqueos y límites por IP. */
  readonly trusted: boolean;
}

export type RemoteBucket = 'api' | 'video';

/** Lo mínimo de una respuesta en curso que se puede cortar (el `ServerResponse` de Node). */
export interface RemoteInflight {
  destroy(error?: Error): unknown;
  once(event: 'close', listener: () => void): unknown;
  readonly destroyed?: boolean;
}

export type RemoteStat = 'ok' | 'denied' | 'blocked' | 'ipUntrusted';

export interface RemoteService extends Lifecycle {
  /** La IP del contenedor de Caddy. */
  readonly peer: EdgePeer;
  /** ¿Está escuchando el puerto del dominio? (lo pone main.ts). */
  setListening(listening: boolean): void;
  edgeStatus(): { readonly listening: boolean; readonly peerResolved: boolean };

  /** El interruptor general. */
  enabled(): boolean;
  /** ¿Puede entrar este aparato por el dominio ahora? (encendido y sin caducar). */
  isAllowed(deviceId: string): boolean;
  /** Milisegundos que le quedan al bloqueo de esa clave, o 0. */
  blockedForMs(key: string): number;
  /** Una ficha del cubo de esa IP (`null` = pasa; si no, segundos para `Retry-After`). */
  takeIp(bucket: RemoteBucket | 'session', key: string): number | null;
  /** Una ficha del cubo de ese aparato. */
  takeDevice(bucket: RemoteBucket, deviceId: string): number | null;
  /** Un fallo (401/403/404) de una IP de internet: puede acabar en bloqueo. */
  recordFailure(key: string, ip: string | null): void;
  /** Un acceso bueno: último acceso (como mucho uno por minuto) y aviso si la IP es nueva. */
  recordAccess(deviceId: string, client: RemoteClient, routeId: string): void;
  /** Un aparato emparejado sin permiso (o caducado) intentó entrar. */
  recordDenied(deviceId: string, client: RemoteClient, routeId: string): void;
  /** Alguien que no es Caddy llamó al puerto del dominio. */
  recordPeerMismatch(address: string | null): void;
  /**
   * Una respuesta que el dominio está sirviendo a un aparato con permiso (una descarga, un tramo
   * largo): se corta al quitarle el permiso, al caducar o al cerrar el dominio.
   */
  trackResponse(deviceId: string, response: RemoteInflight): void;
  /** Corta ya las respuestas en curso de ese aparato (o de todos con `null`); cuántas. */
  cutResponses(deviceId: string | null): number;
  /** Contadores de las últimas 24 h (en memoria). */
  count(stat: RemoteStat): void;

  // --- Web (Ajustes → Dispositivos) ---
  view(): RemoteView;
  setEnabled(enabled: boolean): Promise<RemoteView>;
  /** Lanza `device_not_found` si el aparato no existe o está revocado. */
  setDevice(deviceId: string, body: DeviceRemoteBody): Promise<RemoteView>;
  unblock(key: string): Promise<RemoteUnblockResponse>;
  unblockAll(): Promise<RemoteUnblockResponse>;

  /** Lo que lleva `bootstrap` para la app. */
  bootstrapInfo(deviceId: string, viaDomain: boolean): BootstrapRemote;
  /** Espera a las escrituras pendientes (tests y apagado). */
  flush(): Promise<void>;
}
