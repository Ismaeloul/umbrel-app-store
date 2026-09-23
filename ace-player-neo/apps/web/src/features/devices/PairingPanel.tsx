/* El bloque de emparejar: el botón y, al pulsarlo, el código de 6 dígitos con
   su QR y la cuenta atrás de 5 min (arquitectura §7.3).

   - El QR es el SVG que dibuja el backend, pintado como <img> con una URL
     data: (la CSP de nginx permite `img-src data:`). Como imagen, nada de lo
     que traiga el SVG se ejecuta. Siempre sobre blanco, también en oscuro: un
     QR necesita módulos oscuros sobre claro para leerse bien.
   - El código va en dos grupos de 3 y con `Num` (cifras en celdas fijas y cero
     sin barra); los lectores de pantalla lo oyen cifra a cifra.
   - La cuenta atrás es un `role="timer"` (no se anuncia cada segundo); lo que
     sí se anuncia (listo, caducado, emparejado) va en una región polite. */

import { useEffect, useRef } from 'react';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { Num } from '../../ui/Num.tsx';
import { ProgressBar } from '../../ui/ProgressBar.tsx';
import { countdown, groupCode, qrImageSrc, spellCode } from './model.ts';
import type { Pairing } from './usePairing.ts';

export interface PairingPanelProps {
  pairing: Pairing;
  /** Nombre del que se acaba de emparejar, cuando la lista ya lo trae. */
  pairedName: string | null;
  /** En la demo el QR es de adorno: se rotula. */
  demo: boolean;
}

function announcement(phase: Pairing['state']['phase'], pairedName: string | null): string {
  switch (phase) {
    case 'code':
      return 'Código listo. Caduca en 5 minutos.';
    case 'expired':
      return 'El código ha caducado.';
    case 'paired':
      return pairedName ? `«${pairedName}» ya está emparejado.` : 'Dispositivo emparejado.';
    default:
      return '';
  }
}

export function PairingPanel({ pairing, pairedName, demo }: PairingPanelProps) {
  const { state } = pairing;
  const pairedId = state.phase === 'paired' ? state.deviceId : null;
  const toasted = useRef<string | null>(null);

  // Un aviso al emparejar (una vez por dispositivo): si la sección no está a la
  // vista, el toast es lo que se entera.
  useEffect(() => {
    if (!pairedId || toasted.current === pairedId || !pairedName) return;
    toasted.current = pairedId;
    notify(`«${pairedName}» se ha emparejado`, { tone: 'ok', icon: 'check' });
  }, [pairedId, pairedName]);

  // La región que se anuncia va SIEMPRE en el mismo sitio (segundo hijo del
  // fragmento): si se montara con cada estado, el lector no la anunciaría.
  return (
    <>
      <PanelBody pairing={pairing} pairedName={pairedName} demo={demo} />
      <p className="sr-only" aria-live="polite">
        {announcement(state.phase, pairedName)}
      </p>
    </>
  );
}

function PanelBody({ pairing, pairedName, demo }: PairingPanelProps) {
  const { state, remainingMs, create, cancel } = pairing;
  if (state.phase === 'idle' || state.phase === 'creating') {
    return (
      <div className="disp-pair-start">
        <Button variant="primary" icon="qr" busy={state.phase === 'creating'} onClick={() => void create()}>
          {state.phase === 'creating' ? 'Creando el código…' : 'Emparejar un dispositivo'}
        </Button>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="disp-inline disp-inline--err" role="alert">
        <Icon name="aviso" size={18} />
        <span>No se pudo crear el código. {state.message}</span>
        <Button size="sm" variant="quiet" icon="refresh" onClick={() => void create()}>
          Volver a intentarlo
        </Button>
      </div>
    );
  }

  if (state.phase === 'paired') {
    return (
      <div className="disp-pair disp-pair--done" role="group" aria-label="Emparejamiento">
        <span className="disp-pair__done-icon" aria-hidden="true">
          <Icon name="check" size={24} />
        </span>
        <div className="disp-pair__done-text">
          <p className="disp-pair__title">
            {pairedName ? `«${pairedName}» ya está emparejado` : 'Dispositivo emparejado'}
          </p>
          <p className="disp-help">Ya puede ver la agenda y tus canales. Si lo pierdes, revócalo desde la lista.</p>
          <div className="disp-row">
            <Button variant="quiet" icon="qr" onClick={() => void create()}>
              Emparejar otro
            </Button>
            <Button variant="ghost" onClick={cancel}>
              Hecho
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (state.phase === 'expired') {
    return (
      <div className="disp-pair disp-pair--expired" role="group" aria-label="Emparejamiento">
        <div className="disp-pair__done-text">
          <p className="disp-pair__title">El código ha caducado</p>
          <p className="disp-help">Duran 5 minutos y solo sirven una vez. Crea otro cuando tengas el iPhone a mano.</p>
          <div className="disp-row">
            <Button variant="primary" icon="refresh" onClick={() => void create()}>
              Crear otro código
            </Button>
            <Button variant="ghost" onClick={cancel}>
              Cancelar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Código a la vista.
  const fraction = state.ttlMs > 0 ? remainingMs / state.ttlMs : 0;
  const left = countdown(remainingMs);
  return (
    <div className="disp-pair" role="group" aria-labelledby="disp-pair-t">
      <figure className="disp-pair__qr">
        <img
          src={qrImageSrc(state.qrSvg)}
          width={200}
          height={200}
          alt="Código QR para emparejar: lleva la dirección de esta página y el código"
          draggable={false}
        />
        {demo ? <figcaption className="disp-pair__demo">QR de muestra (demo)</figcaption> : null}
      </figure>
      <div className="disp-pair__side">
        <p id="disp-pair-t" className="disp-pair__label">
          Código para emparejar
        </p>
        <p className="disp-pair__code">
          <Num value={groupCode(state.code)} label={`Código ${spellCode(state.code)}`} />
        </p>
        <div className="disp-pair__timer" role="timer" aria-label={`Caduca en ${left}`}>
          <ProgressBar value={fraction} label="Tiempo que le queda al código" size="thin" />
          <span className="disp-pair__left" aria-hidden="true">
            Caduca en <Num value={left} condensed={false} />
          </span>
        </div>
        <ol className="disp-steps">
          <li>Abre Ace Player Neo en el iPhone o el iPad.</li>
          <li>Toca «Emparejar» y escanea el QR, o escribe la dirección y el código.</li>
          <li>Saldrá aquí abajo, en «Emparejados».</li>
        </ol>
        <div className="disp-row">
          <Button variant="quiet" icon="refresh" onClick={() => void create()}>
            Crear otro código
          </Button>
          <Button variant="ghost" onClick={cancel}>
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}
