/* El programa elegido (guia-detalles.html §1): canal, título entero,
   horario, «Empieza en X min», «Ver ahora» o «Te aviso» y «Ver ficha» si el
   partido está en la Agenda. Desde 768 va en un popover anclado a la casilla
   (rediseño de escritorio, 01-escritorio.html §2); en el móvil, en una hoja
   que sube desde abajo, que además trae lo que diga la guía del programa:
   sobre todo la sinopsis, que es lo que da el proveedor de Isma (Paso 0:
   100 % con sinopsis, sin imágenes, géneros ni episodios). */

import type { IptvGuideProgrammeDetail } from '@ace/shared';
import { useMemo } from 'react';
import { useNavigate } from '../../app/router.tsx';
import { avisosNote } from '../avisos/Bell.tsx';
import {
  askNoticePermission,
  addAviso,
  noticePermission,
  removeAviso,
  useHasAviso,
} from '../avisos/store.ts';
import '../agenda/demo.ts';
import { useSchedule } from '../agenda/data.ts';
import { useLocalPrefs } from '../settings/local-prefs.ts';
import { Button, Capsule, Popover, Sheet, Skeleton } from '../../ui/index.ts';
import { matchForProgramme } from './agenda-link.ts';
import { ChannelBadge, type Picked } from './Board.tsx';
import { useGuideProgramme } from './data.ts';
import { airingOf, formatSpan, isOnAir, remainingText, startsText, type Airing } from './model.ts';

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

// ---- La hoja del móvil ---------------------------------------------------------------------

/** Móvil (guia-detalles.html §1): tocar un programa sube esta hoja; la casilla queda resaltada. */
export function ProgrammeSheet({
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
  return (
    <Sheet
      open={open && picked !== null}
      onClose={onClose}
      // El título se ve dentro, debajo del canal (como la maqueta); aquí solo nombra la hoja.
      title={picked ? shownOf(picked, now).title : 'Programa'}
      hideTitle
      size="md"
      className="guia-msheet"
    >
      {picked ? (
        <ProgrammeCard
          picked={picked}
          version={version}
          now={now}
          onClose={onClose}
          onPlay={onPlay}
          sheet
        />
      ) : null}
    </Sheet>
  );
}

/** Lo que la guía cuenta del programa (la hoja del móvil): sinopsis, episodio, edad, reparto. */
function ProgrammeInfo({
  programme,
  pending,
  detail,
}: {
  programme: boolean;
  pending: boolean;
  detail: IptvGuideProgrammeDetail | undefined;
}) {
  if (!programme)
    return (
      <p className="guia-pop__text">
        La guía de tu proveedor no dice qué echan en este canal a esta hora. Puedes verlo
        igualmente.
      </p>
    );
  if (pending)
    return (
      <div className="guia-pop__loading" aria-busy="true">
        <Skeleton height={14} width="92%" />
        <Skeleton height={14} width="60%" />
      </div>
    );
  if (!detail)
    return <p className="guia-pop__text">No se pudo cargar la ficha de este programa.</p>;
  const meta = detailMeta(detail);
  return (
    <>
      {detail.subTitle ? <p className="guia-pop__sub">{detail.subTitle}</p> : null}
      {meta.length || detail.rating ? (
        <p className="guia-pop__meta">
          {meta.join(' · ')}
          {detail.rating ? (
            <Capsule size="sm" tone="neutral" title={ratingTitle(detail.rating)}>
              {ratingText(detail.rating)}
            </Capsule>
          ) : null}
        </p>
      ) : null}
      <p className="guia-pop__text">
        {detail.description ?? 'La guía no trae sinopsis de este programa.'}
      </p>
      {detail.directors.length ? (
        <p className="guia-pop__credits">
          <strong>Dirección:</strong> {detail.directors.join(', ')}
        </p>
      ) : null}
      {detail.actors.length ? (
        <p className="guia-pop__credits">
          <strong>Reparto:</strong> {detail.actors.join(', ')}
        </p>
      ) : null}
    </>
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
        <ProgrammeCard
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

/** El contenido del popover (escritorio) y de la hoja (móvil, `sheet`: con la sinopsis y la nota de los avisos). */
function ProgrammeCard({
  picked,
  version,
  now,
  onClose,
  onPlay,
  sheet = false,
}: {
  picked: Picked;
  version: string;
  now: number;
  onClose(): void;
  onPlay(): void;
  sheet?: boolean;
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
  const { alertLead } = useLocalPrefs();
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
      {sheet ? (
        // En la hoja, el título ya nombra el diálogo (oculto en su cabecera): aquí solo se ve.
        <p className="guia-pop__title" aria-hidden="true">
          {shown.title}
        </p>
      ) : (
        <h2 className="guia-pop__title">{shown.title}</h2>
      )}
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
      {sheet ? (
        <ProgrammeInfo programme={programme !== null} pending={query.isPending} detail={detail} />
      ) : null}
      <div className={sheet ? 'guia-pop__actions guia-pop__actions--sheet' : 'guia-pop__actions'}>
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
        ) : sheet && shown.airing === 'future' && programme ? (
          // En el móvil, sin ficha, el canal se puede poner igual (como la hoja de antes).
          <Button icon="play" onClick={onPlay}>
            Ver el canal
          </Button>
        ) : null}
      </div>
      {sheet && shown.airing === 'future' && programme ? (
        <p className="guia-pop__note">{avisosNote(alertLead, noticePermission())}</p>
      ) : null}
    </div>
  );
}
