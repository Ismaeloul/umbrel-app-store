/* Llamada del backend a engine_control para reiniciar el motor.

   Porta `restartAceStream` (server.js:4673-4711) sin el enfriamiento, que
   ahora lleva el vigilante (lo comparten el reinicio manual y el automático):

   - `POST http://<ENGINE_CONTROL_HOST>:3001/restart`, con `x-engine-token`
     si hay token (server.js:4690; T-118, B-229), 8 s de plazo;
   - 2xx → reiniciado; cualquier otra respuesta, un error de red o el plazo
     vencido → `restart_failed` (502), como hoy: en la 0.6.59 el plazo
     destruía la petición y el manejador de error la convertía en
     `restart_failed` (server.js:4702-4708). */

import { TIMEOUTS } from '@ace/shared';
import type { AppConfig } from '../../config/index.js';
import type { Clock } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import { EngineHttpError, engineHttp } from './http.js';
import { hostForUrl } from './paths.js';

/** Lo que engine_control puede contestar no se lee: basta con un tope pequeño. */
const CONTROL_MAX_BODY_BYTES = 64 * 1024;

export function engineControlUrl(config: AppConfig): string {
  return `http://${hostForUrl(config.engine.controlHost)}:${config.engine.controlPort}/restart`;
}

export async function requestEngineRestart(config: AppConfig, clock: Clock): Promise<void> {
  const token = config.engine.controlToken;
  let status: number;
  try {
    const response = await engineHttp(clock, {
      url: engineControlUrl(config),
      method: 'POST',
      timeoutMs: TIMEOUTS.engineControlMs,
      maxBytes: CONTROL_MAX_BODY_BYTES,
      headers: token ? { 'x-engine-token': token } : {},
    });
    status = response.status;
  } catch (error) {
    const kind = error instanceof EngineHttpError ? error.kind : 'network';
    throw new AppError('restart_failed', { detail: `engine_control: ${kind}`, cause: error });
  }
  if (status < 200 || status >= 300) {
    throw new AppError('restart_failed', { detail: `engine_control respondió ${status}` });
  }
}
