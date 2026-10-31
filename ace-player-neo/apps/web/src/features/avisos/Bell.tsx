/* La campana de avisos de la barra de cada sección (rediseño de escritorio,
   solo desde 768: en el móvil no se pinta). Con avisos pendientes lleva su
   número; al pulsarla, un popover con la lista («Te aviso» de la Guía), cada
   uno con «Ver ficha» si es un partido de la Agenda y «Quitar».

   También mantiene el reloj de los avisos (useAvisosClock): la campana está en
   la barra de todas las secciones, así que mientras la app está abierta hay
   quien lo arme. */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '../../app/router.tsx';
import { Icon, IconButton, Popover } from '../../ui/index.ts';
import {
  AVISO_LEAD_MS,
  noticePermission,
  removeAviso,
  setAvisoOpener,
  useAvisos,
  useAvisosClock,
  type Aviso,
} from './store.ts';
import './avisos.css';

const TIME = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric' });

/** «Hoy 20:00», «Mañana 21:30», «lun 3 · 18:00». */
export function avisoDay(start: number, now: number): string {
  const day = new Date(start);
  day.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  const time = TIME.format(start);
  if (diff === 0) return `Hoy ${time}`;
  if (diff === 1) return `Mañana ${time}`;
  return `${DAY.format(start).replace(/\./g, '')} · ${time}`;
}

export function AvisosBell() {
  useAvisosClock();
  const navigate = useNavigate();
  // Pulsar la notificación: la ficha del partido o, si no lo es, la Guía.
  useEffect(() => {
    setAvisoOpener((aviso) =>
      navigate(
        aviso.match ? { vista: 'partido', id: aviso.match, canal: null } : { vista: 'guia' },
      ),
    );
    return () => setAvisoOpener(null);
  }, [navigate]);
  const list = useAvisos();
  const pending = list.filter((aviso) => !aviso.fired);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const label = pending.length
    ? `Avisos: ${pending.length} ${pending.length === 1 ? 'pendiente' : 'pendientes'}`
    : 'Avisos';
  return (
    <>
      <span className="avisos-bell-wrap">
        <IconButton
          ref={button}
          icon="campana"
          label={label}
          className="avisos-bell"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((value) => !value)}
        />
        {pending.length ? (
          <span className="avisos-bell__count" aria-hidden="true">
            {pending.length > 9 ? '9+' : pending.length}
          </span>
        ) : null}
      </span>
      <Popover
        open={open}
        anchor={button.current}
        onClose={() => setOpen(false)}
        label="Avisos"
        align="end"
        className="avisos-pop"
      >
        <AvisosList list={list} onDone={() => setOpen(false)} />
      </Popover>
    </>
  );
}

function AvisosList({ list, onDone }: { list: readonly Aviso[]; onDone(): void }) {
  const navigate = useNavigate();
  const now = Date.now();
  const permission = noticePermission();
  return (
    <div className="avisos">
      <h2 className="avisos__title">Avisos</h2>
      {list.length === 0 ? (
        <p className="avisos__empty">
          No tienes avisos. En la Guía, pulsa un programa que aún no ha empezado y «Te aviso».
        </p>
      ) : (
        <ul className="avisos__list">
          {list.map((aviso) => (
            <li key={aviso.id} className="avisos__item">
              <span className="avisos__icon" aria-hidden="true">
                <Icon name={aviso.fired ? 'clock' : 'campana'} size={18} />
              </span>
              <span className="avisos__text">
                <span className="avisos__name">{aviso.title}</span>
                <span className="avisos__meta">
                  <span className="avisos__time">{avisoDay(aviso.start, now)}</span>
                  {' · '}
                  {aviso.channel}
                  {aviso.fired ? ' · ya avisado' : ''}
                </span>
              </span>
              {aviso.match ? (
                <IconButton
                  icon="agenda"
                  label={`Ver la ficha de ${aviso.title}`}
                  className="avisos__btn"
                  onClick={() => {
                    onDone();
                    navigate({ vista: 'partido', id: aviso.match as string, canal: null });
                  }}
                />
              ) : null}
              <IconButton
                icon="x"
                label={`Quitar el aviso de ${aviso.title}`}
                className="avisos__btn"
                onClick={() => removeAviso(aviso.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="avisos__note">
        {permission === 'granted'
          ? `Te avisamos ${AVISO_LEAD_MS / 60_000} minutos antes con una notificación.`
          : permission === 'denied'
            ? 'Las notificaciones están bloqueadas: te aviso aquí, con la app abierta.'
            : `Te avisamos ${AVISO_LEAD_MS / 60_000} minutos antes, con la app abierta.`}
      </p>
    </div>
  );
}
