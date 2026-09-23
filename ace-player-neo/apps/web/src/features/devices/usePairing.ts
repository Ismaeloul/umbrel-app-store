/* El emparejamiento, como máquina de estados pequeña (arquitectura §7.3):

     idle ──crear──▶ creating ──▶ code ──(5 min)──▶ expired
                          │         │  └─(aparece un dispositivo nuevo)─▶ paired
                          └─▶ error  └─cancelar─▶ idle

   - POST /api/v1/pairing con `baseUrl` = la dirección de esta página: es la
     que va en el QR (así, si abres la web por Tailscale, el iPhone también
     llega por Tailscale). Un código nuevo anula el anterior (lo hace el
     backend): «Crear otro» es otra vez `create()`.
   - La cuenta atrás usa el `ttlMs` de la respuesta contado desde que llega, no
     `expiresAt`: si el reloj del PC y el del Umbrel no coinciden, la cuenta
     atrás sigue siendo la buena.
   - ¿Se ha emparejado? Llega `devices.changed` por SSE (que además invalida la
     lista, src/api/sse.ts); sin SSE (respaldo), la lista se vuelve a pedir
     cada 5 s SOLO mientras hay un código a la vista. En los dos casos se mira
     si hay un dispositivo que no estaba al crear el código.
   - Oculta la vista (Activity), no hay temporizadores vivos; al volver se
     recalcula con la hora de ahora. */

import type { PairingCreateResponse } from '@ace/shared';
import { useEffect, useRef, useState } from 'react';
import { api, describeFailure, isAbortError, useSseEvent } from '../../api/index.ts';

export const PAIRING_POLL_MS = 5000;

export type PairingState =
  | { phase: 'idle' }
  | { phase: 'creating' }
  | {
      phase: 'code';
      code: string;
      qrSvg: string;
      pairUri: string;
      ttlMs: number;
      deadline: number;
      /** Los que había al crear el código (null: la lista aún no había llegado). */
      knownIds: readonly string[] | null;
    }
  | { phase: 'expired' }
  | { phase: 'paired'; deviceId: string }
  | { phase: 'error'; message: string };

export interface Pairing {
  state: PairingState;
  /** ms que le quedan al código (0 si no hay código). */
  remainingMs: number;
  create(): Promise<void>;
  cancel(): void;
}

export function usePairing({
  deviceIds,
  origin = typeof location === 'undefined' ? undefined : location.origin,
}: {
  /** Ids de los dispositivos que hay ahora (activos y revocados). */
  deviceIds: readonly string[] | null;
  origin?: string;
}): Pairing {
  const [state, setState] = useState<PairingState>({ phase: 'idle' });
  const [now, setNow] = useState(() => Date.now());
  const request = useRef<AbortController | null>(null);

  // Cuenta atrás: un tic por segundo solo mientras hay código.
  const deadline = state.phase === 'code' ? state.deadline : null;
  useEffect(() => {
    if (deadline === null) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) setState({ phase: 'expired' });
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  // Un dispositivo que no estaba al crear el código: se acaba de emparejar.
  // Si la lista aún no había llegado al crearlo, la primera que llega es la
  // referencia (si no, todos los de siempre parecerían nuevos).
  const coding = state.phase === 'code';
  useEffect(() => {
    if (!coding || !deviceIds) return;
    setState((current) => {
      if (current.phase !== 'code') return current;
      if (current.knownIds === null) return { ...current, knownIds: deviceIds };
      const known = current.knownIds;
      const fresh = deviceIds.find((id) => !known.includes(id));
      return fresh ? { phase: 'paired', deviceId: fresh } : current;
    });
  }, [coding, deviceIds]);

  useSseEvent('devices.changed', (data) => {
    setState((current) =>
      current.phase === 'code' &&
      data.reason === 'paired' &&
      !(current.knownIds ?? []).includes(data.deviceId)
        ? { phase: 'paired', deviceId: data.deviceId }
        : current,
    );
  });

  // Al desmontarse, la petición en curso se cancela (no escribe en un componente muerto).
  useEffect(() => () => request.current?.abort(), []);

  const create = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ phase: 'creating' });
    try {
      const body = origin && /^https?:\/\/[^/?#]+$/i.test(origin) ? { baseUrl: origin } : {};
      const response: PairingCreateResponse = await api('pairingCreate', {
        body,
        signal: controller.signal,
      });
      const start = Date.now();
      setNow(start);
      setState({
        phase: 'code',
        code: response.code,
        qrSvg: response.qrSvg,
        pairUri: response.pairUri,
        ttlMs: response.ttlMs,
        deadline: start + response.ttlMs,
        knownIds: deviceIds,
      });
    } catch (error) {
      if (isAbortError(error)) return;
      setState({ phase: 'error', message: describeFailure(error) });
    } finally {
      if (request.current === controller) request.current = null;
    }
  };

  const cancel = () => {
    request.current?.abort();
    setState({ phase: 'idle' });
  };

  return {
    state,
    remainingMs: state.phase === 'code' ? Math.max(0, state.deadline - now) : 0,
    create,
    cancel,
  };
}
