/* El programa elegido: la franja de abajo en PC (como la del deco de
   Movistar+: logo, número y nombre del canal; título; barra de progreso con
   inicio y fin; «Ver» y «Más info») y la hoja «Más info» (en el móvil, la que
   se abre al tocar), con todo lo que diga la guía: sobre todo la sinopsis,
   que es lo que trae el proveedor de Isma (Paso 0: 100 % con sinopsis, sin
   imágenes, géneros ni episodios). */

import type { IptvGuideProgrammeDetail } from '@ace/shared';
import { Button, Capsule, Num, ProgressBar, Sheet, Skeleton } from '../../ui/index.ts';
import { ChannelLogo, type Picked } from './Board.tsx';
import { useGuideProgramme } from './data.ts';
import {
  airingOf,
  formatLongDay,
  formatTime,
  progressOf,
  remainingText,
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

export function Strip({
  picked,
  version,
  now,
  onPlay,
  onInfo,
}: {
  picked: Picked | null;
  version: string;
  now: number;
  onPlay(): void;
  onInfo(): void;
}) {
  if (!picked)
    return (
      <section className="guia-strip guia-strip--empty" aria-label="Programa elegido">
        <Skeleton width={220} height={20} />
      </section>
    );
  const shown = shownOf(picked, now);
  const { channel } = picked;
  const when = whenLine(shown, now);
  return (
    <section className="guia-strip" aria-label="Programa elegido">
      <div className="guia-strip__channel">
        <ChannelLogo channel={channel} version={version} size={56} />
        <span className="guia-strip__chname">{channel.name}</span>
        {channel.number !== null ? (
          <Num
            className="guia-strip__num"
            value={channel.number}
            label={`Canal ${channel.number}`}
          />
        ) : null}
      </div>
      <div className="guia-strip__main">
        <div className="guia-strip__head">
          <h2 className="guia-strip__title">{shown.title}</h2>
          {shown.real && shown.airing === 'live' ? (
            <Capsule tone="live" size="sm">
              En emisión
            </Capsule>
          ) : null}
        </div>
        <div className="guia-strip__bar">
          <span className="guia-strip__time">{formatTime(shown.start)}</span>
          <ProgressBar
            value={progressOf(shown.start, shown.end, now)}
            tone={shown.airing === 'live' ? 'live' : 'neutral'}
            size="thin"
            label={`De ${formatTime(shown.start)} a ${formatTime(shown.end)}`}
          />
          <span className="guia-strip__time">{formatTime(shown.end)}</span>
        </div>
        <div className="guia-strip__foot">
          <span className="guia-strip__when">{when}</span>
          <div className="guia-strip__actions">
            <PlayButton shown={shown} onPlay={onPlay} size="sm" />
            {shown.real ? (
              <Button variant="quiet" size="sm" icon="info" onClick={onInfo}>
                Más info
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
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
                    <Capsule size="sm" tone="neutral" className="guia-sheet__rating">
                      {detail.rating}
                    </Capsule>
                  ) : null}
                </p>
              ) : detail.rating ? (
                <p className="guia-sheet__meta">
                  <Capsule size="sm" tone="neutral">
                    {detail.rating}
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
