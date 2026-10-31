/* El programa elegido: el popover de escritorio (rediseño, 01-escritorio.html
   §2 y guia-detalles.html §1: canal, título entero, horario, «Empieza en X
   min», «Te aviso» y «Ver ficha» si el partido está en la Agenda) y la hoja
   «Más info» (en el móvil, la que se abre al tocar), con todo lo que diga la
   guía: sobre todo la sinopsis, que es lo que trae el proveedor de Isma
   (Paso 0: 100 % con sinopsis, sin imágenes, géneros ni episodios). */

import type { IptvGuideProgrammeDetail } from '@ace/shared';
import { useMemo } from 'react';
import { useNavigate } from '../../app/router.tsx';
import { askNoticePermission, addAviso, removeAviso, useHasAviso } from '../avisos/store.ts';
import '../agenda/demo.ts';
import { useSchedule } from '../agenda/data.ts';
import { Button, Capsule, Num, Popover, ProgressBar, Sheet, Skeleton } from '../../ui/index.ts';
import { matchForProgramme } from './agenda-link.ts';
import { ChannelBadge, ChannelLogo, type Picked } from './Board.tsx';
import { useGuideProgramme } from './data.ts';
import {
  airingOf,
  formatLongDay,
  formatSpan,
  formatTime,
  isOnAir,
  progressOf,
  remainingText,
  startsText,
  type Airing,
} from './model.ts';

interface Shown {
  title: string;
  start: number;
  end: number;
  airing: Airing;
  /** Hay programa de verdad (no «Sin información» ni cargando). */
  real: boolean;
}

function shownOf(picked: Picked, now: number): Shown {
  const { segment } = picked;
  if (segment.kind === 'prog') {
    const { programme } = segment;
    return {
      title: programme.title,
      start: programme.start,
      end: programme.end,
      airing: airingOf(programme.start, programme.end, now),
      real: true,
    };
  }
  return {
    title: segment.kind === 'loading' ? 'Cargando…' : 'Sin información',
    start: segment.start,
    end: segment.end,
    airing: airingOf(segment.start, segment.end, now),
    real: false,
  };
}

/** «La 1» y el canal 1: el número ya está en el nombre, no se repite debajo. */
export function nameHasNumber(name: string, number: number): boolean {
  return new RegExp(`(^|\\D)${number}(\\D|$)`).test(name);
}

/** La edad de la guía, dicha: «TP» es «Todos los públicos»; «12» o «+12», «+12». */
export function ratingText(rating: string): string {
  const text = rating.trim();
  if (/^tp$/i.test(text)) return 'Todos los públicos';
  const age = /^\+?(\d{1,2})$/.exec(text);
  return age ? `+${age[1]}` : text;
}

/** El aviso al pasar por encima de la edad. */
export function ratingTitle(rating: string): string {
  const age = /^\+?(\d{1,2})$/.exec(rating.trim());
  return age ? `No recomendado para menores de ${age[1]} años` : 'Edad recomendada';
}

function whenLine(shown: Shown, now: number): string {
  if (!shown.real) return '';
  if (shown.airing === 'live') return remainingText(shown.end, now);
  if (shown.airing === 'future') return `Empieza a las ${formatTime(shown.start)}`;
  return 'Ya emitido';
}

function PlayButton({
  shown,
  onPlay,
  size = 'md',
}: {
  shown: Shown;
  onPlay(): void;
  size?: 'md' | 'sm';
}) {
  const live = !shown.real || shown.airing === 'live';
  return (
    <Button variant={live ? 'primary' : 'quiet'} icon="play" size={size} onClick={onPlay}>
      {live ? 'Ver' : 'Ver el canal'}
    </Button>
  );
}

function detailMeta(detail: IptvGuideProgrammeDetail): string[] {
  const out: string[] = [];
  if (detail.season !== null && detail.episode !== null)
    out.push(`T${detail.season} · Ep. ${detail.episode}`);
  else if (detail.episode !== null) out.push(`Ep. ${detail.episode}`);
  else if (detail.episodeText) out.push(detail.episodeText);
  if (detail.categories.length) out.push(detail.categories.slice(0, 3).join(', '));
  if (detail.year !== null) out.push(String(detail.year));
  if (detail.stars) out.push(`★ ${detail.stars}`);
  return out;
}

export function InfoSheet({
  picked,
  open,
  version,
  now,
  onClose,
  onPlay,
}: {
  picked: Picked | null;
  open: boolean;
  version: string;
  now: number;
  onClose(): void;
  onPlay(): void;
}) {
  const programme = picked?.segment.kind === 'prog' ? picked.segment.programme : null;
  const query = useGuideProgramme(programme?.id ?? null, version, open && programme !== null);
  const shown = picked ? shownOf(picked, now) : null;
  const detail = query.data;
  const when = shown ? whenLine(shown, now) : '';
  return (
    <Sheet
      open={open && picked !== null}
      onClose={onClose}
      title={shown?.title ?? 'Programa'}
      size="md"
      className="guia-sheet"
      footer={
        shown ? (
          <div className="guia-sheet__foot">
            <PlayButton shown={shown} onPlay={onPlay} />
            <Button variant="quiet" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        ) : null
      }
    >
      {picked && shown ? (
        <div className="guia-sheet__body">
          <div className="guia-sheet__channel">
            <ChannelLogo channel={picked.channel} version={version} size={40} />
            <div>
              <p className="guia-sheet__chname">
                {picked.channel.name}
                {picked.channel.number !== null ? (
                  <span className="guia-sheet__num">
                    {' · '}
                    <Num value={picked.channel.number} label={`canal ${picked.channel.number}`} />
                  </span>
                ) : null}
              </p>
              <p className="guia-sheet__when">
                {formatLongDay(shown.start)} · {formatTime(shown.start)}-{formatTime(shown.end)}
              </p>
            </div>
          </div>
          {shown.real ? (
            <div className="guia-sheet__bar">
              <ProgressBar
                value={progressOf(shown.start, shown.end, now)}
                tone={shown.airing === 'live' ? 'live' : 'neutral'}
                size="thin"
                label={`De ${formatTime(shown.start)} a ${formatTime(shown.end)}`}
              />
              <span>{when}</span>
            </div>
          ) : null}
          {!programme ? (
            <p className="guia-sheet__text">
              La guía de tu proveedor no dice qué echan en este canal a esta hora. Puedes verlo
              igualmente.
            </p>
          ) : query.isPending ? (
            <div className="guia-sheet__loading" aria-busy="true">
              <Skeleton height={14} width="92%" />
              <Skeleton height={14} width="84%" />
              <Skeleton height={14} width="60%" />
            </div>
          ) : detail ? (
            <>
              {detail.subTitle ? <p className="guia-sheet__sub">{detail.subTitle}</p> : null}
              {detailMeta(detail).length ? (
                <p className="guia-sheet__meta">
                  {detailMeta(detail).join(' · ')}
                  {detail.rating ? (
                    <Capsule
                      size="sm"
                      tone="neutral"
                      className="guia-sheet__rating"
                      title={ratingTitle(detail.rating)}
                    >
                      {ratingText(detail.rating)}
                    </Capsule>
                  ) : null}
                </p>
              ) : detail.rating ? (
                <p className="guia-sheet__meta">
                  <Capsule size="sm" tone="neutral" title={ratingTitle(detail.rating)}>
                    {ratingText(detail.rating)}
                  </Capsule>
                </p>
              ) : null}
              <p className="guia-sheet__text">
                {detail.description ?? 'La guía no trae sinopsis de este programa.'}
              </p>
              {detail.directors.length ? (
                <p className="guia-sheet__credits">
                  <strong>Dirección:</strong> {detail.directors.join(', ')}
                </p>
              ) : null}
              {detail.actors.length ? (
                <p className="guia-sheet__credits">
                  <strong>Reparto:</strong> {detail.actors.join(', ')}
                </p>
              ) : null}
            </>
          ) : (
            <p className="guia-sheet__text">No se pudo cargar la ficha de este programa.</p>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

// ---- El popover de escritorio ------------------------------------------------------------

export interface PopoverTarget {
  picked: Picked;
  anchor: HTMLElement;
}

/** El id del aviso de un programa: el mismo programa no se apunta dos veces. */
export const avisoIdOf = (programmeId: string): string => `guia:${programmeId}`;

export function ProgrammePopover({
  target,
  version,
  now,
  onClose,
  onPlay,
}: {
  target: PopoverTarget | null;
  version: string;
  now: number;
  onClose(): void;
  onPlay(): void;
}) {
  return (
    <Popover
      open={target !== null}
      anchor={target?.anchor ?? null}
      onClose={onClose}
      label={target ? shownOf(target.picked, now).title : 'Programa'}
      inset={target ? insetFor(target.anchor) : 0}
      className="guia-pop"
    >
      {target ? (
        <PopoverBody
          picked={target.picked}
          version={version}
          now={now}
          onClose={onClose}
          onPlay={onPlay}
        />
      ) : null}
    </Popover>
  );
}

/** Un programa ancho: el popover sale un poco metido, sin tapar su título (como la maqueta). */
function insetFor(anchor: HTMLElement): number {
  const width = anchor.getBoundingClientRect().width;
  return width > 360 ? Math.min(160, width / 4) : 0;
}

function PopoverBody({
  picked,
  version,
  now,
  onClose,
  onPlay,
}: {
  picked: Picked;
  version: string;
  now: number;
  onClose(): void;
  onPlay(): void;
}) {
  const navigate = useNavigate();
  const programme = picked.segment.kind === 'prog' ? picked.segment.programme : null;
  const shown = shownOf(picked, now);
  const query = useGuideProgramme(programme?.id ?? null, version, programme !== null);
  const detail = query.data;
  const schedule = useSchedule().data;
  const match = useMemo(() => {
    if (!programme || !schedule) return null;
    return matchForProgramme(
      programme,
      schedule.days.flatMap((day) => day.matches),
    );
  }, [programme, schedule]);
  const avisoId = programme ? avisoIdOf(programme.id) : '';
  const avisado = useHasAviso(avisoId);
  const onAir = programme !== null && isOnAir(programme, now);
  const category = detail?.categories[0];
  const toggleAviso = () => {
    if (!programme) return;
    if (avisado) {
      removeAviso(avisoId);
      return;
    }
    addAviso({
      id: avisoId,
      title: programme.title,
      channel: picked.channel.name,
      start: programme.start,
      end: programme.end,
      ...(match ? { match: match.id } : {}),
    });
    void askNoticePermission();
  };
  const openMatch = () => {
    if (!match) return;
    onClose();
    navigate({ vista: 'partido', id: match.id, canal: null });
  };
  return (
    <div className="guia-pop__body">
      <div className="guia-pop__channel">
        <ChannelBadge channel={picked.channel} version={version} small />
        <span className="guia-pop__chname">
          {picked.channel.name}
          {category ? ` · ${category}` : ''}
        </span>
      </div>
      <h2 className="guia-pop__title">{shown.title}</h2>
      <p className="guia-pop__time">
        <span>{formatSpan(shown.start, shown.end)}</span>
        {shown.real ? (
          <span
            className={
              shown.airing === 'live'
                ? onAir
                  ? 'guia-pop__when guia-pop__when--live'
                  : 'guia-pop__when guia-pop__when--now'
                : shown.airing === 'past'
                  ? 'guia-pop__when guia-pop__when--past'
                  : 'guia-pop__when'
            }
          >
            {shown.airing === 'live'
              ? onAir
                ? `En directo · ${remainingText(shown.end, now).toLowerCase()}`
                : remainingText(shown.end, now)
              : shown.airing === 'future'
                ? startsText(shown.start, now)
                : 'Ya emitido'}
          </span>
        ) : null}
      </p>
      <div className="guia-pop__actions">
        {shown.airing === 'future' && programme ? (
          <Button
            className="guia-pop__aviso"
            icon={avisado ? 'check' : 'campana'}
            pressed={avisado}
            onClick={toggleAviso}
          >
            {avisado ? 'Te avisaré' : 'Te aviso'}
          </Button>
        ) : (
          <Button
            variant={shown.airing === 'live' || !shown.real ? 'primary' : 'quiet'}
            icon="play"
            onClick={onPlay}
          >
            {shown.airing === 'live' || !shown.real ? 'Ver ahora' : 'Ver el canal'}
          </Button>
        )}
        {match ? (
          <Button
            variant={shown.airing === 'future' ? 'primary' : 'quiet'}
            icon="agenda"
            onClick={openMatch}
          >
            Ver ficha
          </Button>
        ) : null}
      </div>
    </div>
  );
}
