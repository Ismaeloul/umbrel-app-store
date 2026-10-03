/* La parrilla de la Guía TV (investigación §2-§3.3), estilo Movistar+:
   canales fijos a la izquierda, regla de horas pegada arriba, raya roja de
   «ahora» y, en PC, la franja del programa elegido debajo (en el móvil, una
   hoja al tocar).

   - UN contenedor con scroll en los dos ejes. Las filas se virtualizan con
     TanStack Virtual; el eje del tiempo no: cada fila pinta solo los tramos
     que caen en la franja visible (búsqueda binaria, ±1 h de margen), con la
     franja cuantizada a 15 min para no repintar en cada píxel.
   - El título se queda pegado a la izquierda aunque el programa empezara
     antes (sticky dentro de un bloque con `overflow: clip`): cero JS.
   - Lo que se pide sale de lo que se ve, ya quieto (120 ms): páginas de
     canales y teselas de 6 h × 30 filas (data.ts).
   - Teclado (patrón «grid» con foco anclado al tiempo): ←/→ programa,
     ↑/↓ canal a la misma hora, RePág/AvPág, Inicio = ahora, Intro = Ver (o
     Más info si no se está emitiendo), I = Más info, y números para saltar a
     un canal como con el mando. */

import type { IptvGuideChannel, IptvGuideResponse } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { cx } from '../../lib/cx.ts';
import { prefersReducedMotion } from '../../lib/media.ts';
import { Button, ChannelMark, Icon, Num, Skeleton } from '../../ui/index.ts';
import {
  logoSrc,
  retryFailedTiles,
  useGuideTiles,
  type GuidePages,
  type TileRequest,
} from './data.ts';
import {
  airingOf,
  blocksBetween,
  BLOCK_ROWS,
  floorTo,
  formatShortDay,
  formatTime,
  MINUTE,
  NUMBER_TYPING_MS,
  rowForNumber,
  rulerMarks,
  segmentAt,
  segmentLabel,
  stepSegment,
  TILE_MS,
  tilesBetween,
  timeAt,
  visibleSegments,
  xOf,
  buildSegments,
  dayLabel,
  dayStart,
  type Scale,
  type Segment,
  type Timeline,
} from './model.ts';

/** Lo que el resto de la vista puede pedirle a la parrilla (días, «Ahora»). */
export interface BoardControls {
  goNow(): void;
  goTo(t: number): void;
}

export interface Selection {
  row: number;
  /** Instante anclado: ↑/↓ caen en el programa que se emite a esta hora. */
  at: number;
}

export interface Picked {
  channel: IptvGuideChannel;
  segment: Segment;
}

export interface BoardProps {
  head: IptvGuideResponse;
  pages: GuidePages;
  /** La parrilla avisa de qué filas asoman: el padre pide sus páginas. */
  onRows(first: number, last: number): void;
  timeline: Timeline;
  scale: Scale;
  now: number;
  active: boolean;
  /** true en el móvil: tocar abre la hoja; si no, solo elige (la franja de abajo lo enseña). */
  touchSheet: boolean;
  selection: Selection;
  onSelection(next: Selection): void;
  /** Lo elegido ha cambiado (para la franja y la hoja). */
  onPicked(picked: Picked | null): void;
  onPlay(channel: IptvGuideChannel): void;
  onInfo(picked: Picked): void;
  /** El día que se ve a la izquierda (cuantizado), para los chips de día. */
  onViewTime(t: number): void;
  controls: RefObject<BoardControls | null>;
}

const QUANTUM = 15 * MINUTE;
const MARGIN = 60 * MINUTE;
const SETTLE_MS = 120;

export function Board({
  head,
  pages,
  onRows,
  timeline,
  scale,
  now,
  active,
  touchSheet,
  selection,
  onSelection,
  onPicked,
  onPlay,
  onInfo,
  onViewTime,
  controls,
}: BoardProps) {
  const client = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const total = head.total;
  const programmesWidth = Math.ceil(xOf(timeline.end, timeline, scale));
  const capW = timeline.endsEarly ? 168 : 0;
  const contentW = scale.colW + programmesWidth + capW;
  const contentH = scale.rulerH + total * scale.rowH;

  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => scale.rowH,
    overscan: 6,
    paddingStart: scale.rulerH,
    scrollPaddingStart: scale.rulerH,
    initialRect: { width: 1200, height: 640 },
  });
  useEffect(() => {
    virtualizer.measure();
  }, [scale.rowH, scale.rulerH, virtualizer]);

  // ---- La franja de tiempo que se ve ----
  const [view, setView] = useState({ left: 0, width: 1200 });
  const [settled, setSettled] = useState(view);
  const frame = useRef(0);
  const readView = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    /* El título de un programa que empezó antes se ve desde el borde de la
       columna (como en el deco): el CSS lo desplaza con --sl, sin repintar
       React en cada fotograma. React solo se entera cada 48 px. */
    node.style.setProperty('--sl', `${node.scrollLeft}px`);
    const next = { left: Math.round(node.scrollLeft / 48) * 48, width: node.clientWidth || 1200 };
    setView((old) => (old.left === next.left && old.width === next.width ? old : next));
  }, []);
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(readView);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(view), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [view]);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => readView());
    observer.observe(node);
    return () => observer.disconnect();
  }, [readView]);

  const areaW = Math.max(1, view.width - scale.colW);
  const leftTime = timeAt(view.left, timeline, scale);
  const rightTime = timeAt(view.left + areaW, timeline, scale);
  const qFrom = floorTo(leftTime, QUANTUM) - MARGIN;
  const qTo = floorTo(rightTime, QUANTUM) + QUANTUM + MARGIN;
  const leftQ = floorTo(leftTime, QUANTUM);
  useEffect(() => onViewTime(leftQ), [leftQ, onViewTime]);

  // ---- Filas que se ven y lo que hay que pedir ----
  const items = virtualizer.getVirtualItems();
  const firstRow = items[0]?.index ?? 0;
  const lastRow = items.at(-1)?.index ?? Math.min(total - 1, 20);
  useEffect(() => onRows(firstRow, lastRow), [firstRow, lastRow, onRows]);

  const settledLeft = timeAt(settled.left, timeline, scale);
  const settledRight = timeAt(
    settled.left + Math.max(1, settled.width - scale.colW),
    timeline,
    scale,
  );
  const requestFrom = Math.max(timeline.start, settledLeft - 30 * MINUTE);
  const requestTo = Math.min(timeline.end, settledRight + 60 * MINUTE);
  const blocks = blocksBetween(firstRow, lastRow, total);
  const tiles = tilesBetween(requestFrom, Math.max(requestFrom + 1, requestTo));
  const refsSignature = blocks
    .map((block) => {
      const refs: number[] = [];
      for (
        let index = block * BLOCK_ROWS;
        index < Math.min(total, (block + 1) * BLOCK_ROWS);
        index += 1
      ) {
        const guide = pages.row(index)?.guide;
        if (guide !== null && guide !== undefined) refs.push(guide);
      }
      return refs.join(',');
    })
    .join('|');
  const tilesSignature = tiles.join(',');
  // La tesela de lo elegido también, aunque su fila ya no se vea: la franja sigue con ello.
  const selectedBlock = Math.floor(selection.row / BLOCK_ROWS);
  const selectedRefs: number[] = [];
  for (
    let index = selectedBlock * BLOCK_ROWS;
    index < Math.min(total, (selectedBlock + 1) * BLOCK_ROWS);
    index += 1
  ) {
    const guide = pages.row(index)?.guide;
    if (guide !== null && guide !== undefined) selectedRefs.push(guide);
  }
  const selectedSignature = `${floorTo(selection.at, TILE_MS)}/${selectedRefs.join(',')}`;
  const requests = useMemo<TileRequest[]>(() => {
    if (!active) return [];
    const out: TileRequest[] = [];
    const seen = new Set<string>();
    const add = (tile: number, refs: string) => {
      const key = `${tile}/${refs}`;
      if (!refs || seen.has(key)) return;
      seen.add(key);
      out.push({ tile, refs: refs.split(',').map(Number) });
    };
    for (const refs of refsSignature.split('|'))
      for (const tile of tilesSignature.split(',').map(Number)) add(tile, refs);
    const [tile = '0', refs = ''] = selectedSignature.split('/');
    add(Number(tile), refs);
    return out;
  }, [refsSignature, tilesSignature, selectedSignature, active]);
  const tileStates = useGuideTiles(head.version, requests);

  // ---- Tramos de cada fila (calculados al pedirlos y guardados) ----
  const segmentsOf = useMemo(() => {
    const cache = new Map<number, Segment[] | null>();
    return (row: number): Segment[] | null => {
      if (cache.has(row)) return cache.get(row) ?? null;
      const channel = pages.row(row);
      const segments = channel
        ? buildSegments(
            channel.guide === null ? null : (tileStates.get(channel.guide) ?? new Map()),
            timeline.start,
            timeline.end,
          )
        : null;
      cache.set(row, segments);
      return segments;
    };
  }, [pages, tileStates, timeline.start, timeline.end]);

  // ---- Lo elegido ----
  const selectedSegments = segmentsOf(selection.row);
  const selectedChannel = pages.row(selection.row);
  const selectedSegment = selectedSegments ? segmentAt(selectedSegments, selection.at) : null;
  const pickedKey =
    selectedChannel && selectedSegment
      ? `${selectedChannel.id}|${selectedSegment.kind}|${selectedSegment.start}|${selectedSegment.end}|${selectedSegment.kind === 'prog' ? selectedSegment.programme.id : ''}`
      : '';
  const pickedRef = useRef<Picked | null>(null);
  pickedRef.current =
    selectedChannel && selectedSegment
      ? { channel: selectedChannel, segment: selectedSegment }
      : null;
  useEffect(() => {
    // Mientras su tesela llega, la franja se queda con lo de antes (sin parpadeo de «Cargando»).
    if (pickedRef.current?.segment.kind === 'loading') return;
    onPicked(pickedRef.current);
  }, [pickedKey, onPicked]);

  // ---- Moverse ----
  const scrollToTime = useCallback(
    (t: number, smooth: boolean) => {
      const node = scrollRef.current;
      if (!node) return;
      const width = Math.max(1, node.clientWidth - scale.colW);
      const left = Math.max(0, xOf(t, timeline, scale) - width / 4);
      const behavior = smooth && !prefersReducedMotion() ? 'smooth' : 'instant';
      try {
        node.scrollTo({ left, behavior: behavior as ScrollBehavior });
      } catch {
        node.scrollLeft = left;
      }
      readView();
    },
    [scale, timeline, readView],
  );

  const ensureVisible = useCallback(
    (row: number, segment: Segment | null) => {
      virtualizer.scrollToIndex(row, { align: 'auto' });
      const node = scrollRef.current;
      if (!node || !segment) return;
      const width = Math.max(1, node.clientWidth - scale.colW);
      const left = node.scrollLeft;
      const segLeft = xOf(segment.start, timeline, scale);
      const segRight = xOf(segment.end, timeline, scale);
      if (segRight <= left + 8 || segLeft >= left + width - 8) {
        node.scrollLeft = Math.max(0, segLeft - 24);
        readView();
      }
    },
    [virtualizer, scale, timeline, readView],
  );

  const select = useCallback(
    (next: Selection, scroll = true) => {
      const row = Math.max(0, Math.min(total - 1, next.row));
      const clamped = { row, at: Math.max(timeline.start, Math.min(timeline.end - 1, next.at)) };
      onSelection(clamped);
      if (scroll) {
        const segments = segmentsOf(row);
        ensureVisible(row, segments ? segmentAt(segments, clamped.at) : null);
      }
    },
    [total, timeline.start, timeline.end, onSelection, segmentsOf, ensureVisible],
  );

  controls.current = {
    goNow: () => {
      scrollToTime(now, true);
      onSelection({ row: selection.row, at: now });
    },
    goTo: (t: number) => {
      scrollToTime(t, true);
      onSelection({ row: selection.row, at: Math.max(t, timeline.start) });
    },
  };

  // Al abrir (y al cambiar de ámbito o de medidas): «ahora» a un cuarto del ancho.
  const opened = useRef('');
  const openKey = `${head.scope}|${scale.ppm}|${timeline.start}`;
  useLayoutEffect(() => {
    if (opened.current === openKey) return;
    opened.current = openKey;
    scrollToTime(now, false);
    // Solo al abrir: `now` avanza y no debe mover la parrilla.
  }, [openKey]);

  // ---- Teclear un número de canal ----
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!typed) return;
    const timer = window.setTimeout(() => {
      const wanted = Number(typed);
      setTyped('');
      if (!Number.isFinite(wanted) || wanted < 1) return;
      let row: number | null;
      if (head.scope === 'all') row = Math.min(total - 1, wanted - 1);
      else {
        const numbers = Array.from(
          { length: Math.min(total, 1000) },
          (_, index) => pages.row(index)?.number,
        );
        row = rowForNumber(numbers, wanted);
      }
      if (row !== null) select({ row, at: selection.at });
    }, NUMBER_TYPING_MS);
    return () => window.clearTimeout(timer);
  }, [typed, head.scope, total, pages, select, selection.at]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const segments = segmentsOf(selection.row);
    const visibleRows = Math.max(
      1,
      Math.floor(((scrollRef.current?.clientHeight ?? 400) - scale.rulerH) / scale.rowH) - 1,
    );
    const picked = pickedRef.current;
    let handled = true;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        const step = segments
          ? stepSegment(segments, selection.at, event.key === 'ArrowLeft' ? -1 : 1)
          : null;
        if (step && step.kind !== 'loading') {
          const left = timeAt(scrollRef.current?.scrollLeft ?? 0, timeline, scale);
          const at = Math.max(step.start, Math.min(left, step.end - MINUTE));
          select({ row: selection.row, at: step.start < left ? at : step.start });
        }
        break;
      }
      case 'ArrowUp':
        select({ row: selection.row - 1, at: selection.at });
        break;
      case 'ArrowDown':
        select({ row: selection.row + 1, at: selection.at });
        break;
      case 'PageUp':
        select({ row: selection.row - visibleRows, at: selection.at });
        break;
      case 'PageDown':
        select({ row: selection.row + visibleRows, at: selection.at });
        break;
      case 'Home':
        controls.current?.goNow();
        break;
      case 'Enter':
        if (picked) {
          if (
            picked.segment.kind !== 'prog' ||
            airingOf(picked.segment.start, picked.segment.end, now) === 'live'
          )
            onPlay(picked.channel);
          else onInfo(picked);
        }
        break;
      case 'i':
      case 'I':
        if (picked) onInfo(picked);
        break;
      default:
        if (/^\d$/.test(event.key)) setTyped((old) => (old + event.key).slice(-4));
        else handled = false;
    }
    if (handled) event.preventDefault();
  };

  // ---- Pintar ----
  const nowX = scale.colW + xOf(now, timeline, scale);
  const nowInRange = now >= timeline.start && now < timeline.end;
  const nowVisible = nowInRange && nowX >= view.left + scale.colW && nowX <= view.left + view.width;
  const marks = rulerMarks(timeline);
  const today = dayStart(now);
  const leftDay = dayStart(Math.max(timeline.start, leftTime));
  const failed = useMemo(() => {
    for (const row of tileStates.values())
      for (const state of row.values()) if (state.status === 'error') return true;
    return false;
  }, [tileStates]);
  const activeId =
    selectedSegment && selectedChannel ? cellId(selection.row, selectedSegment) : undefined;

  return (
    <div
      className="guia-grid-wrap"
      style={
        {
          '--col-w': `${scale.colW}px`,
          '--row-h': `${scale.rowH}px`,
          '--ruler-h': `${scale.rulerH}px`,
          // La parrilla mide lo que tiene (con pocos canales, sin hueco hasta la franja).
          '--content-h': `${contentH}px`,
        } as CSSProperties
      }
    >
      <div
        ref={scrollRef}
        className="guia-grid"
        role="grid"
        aria-label="Guía TV"
        aria-rowcount={total + 1}
        aria-activedescendant={activeId}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
      >
        <div className="guia-grid__content" style={{ width: contentW, height: contentH }}>
          <div className="guia-ruler" aria-hidden="true" style={{ width: contentW }}>
            <div className="guia-ruler__corner">
              <span className="guia-ruler__day">{dayLabel(leftDay, today)}</span>
              <span className="guia-ruler__date">{formatShortDay(leftDay)}</span>
            </div>
            {marks.map((t, index) => {
              const left = scale.colW + xOf(t, timeline, scale);
              const next = marks[index + 1] ?? timeline.end;
              const width = scale.colW + xOf(next, timeline, scale) - left;
              return (
                <span
                  key={t}
                  className={cx('guia-ruler__mark', t === dayStart(t) && 'guia-ruler__mark--day')}
                  style={{ left, width, '--bx': `${left}px` } as CSSProperties}
                >
                  {/* Como el título de los programas: la hora de la media hora
                      que empezó antes de lo visible se ve entera junto a la
                      columna de canales («21:00», no «00»). */}
                  <span className="guia-ruler__label">
                    {t === dayStart(t) && t !== timeline.start ? formatShortDay(t) : formatTime(t)}
                  </span>
                </span>
              );
            })}
            {nowInRange ? (
              <span className="guia-ruler__now" style={{ left: nowX }}>
                {formatTime(now)}
              </span>
            ) : null}
          </div>
          {nowInRange ? (
            <div className="guia-now" aria-hidden="true" style={{ left: nowX, height: contentH }} />
          ) : null}
          {timeline.endsEarly ? (
            <div
              className="guia-end"
              style={{
                left: scale.colW + programmesWidth,
                width: capW,
                top: scale.rulerH,
                height: contentH - scale.rulerH,
              }}
            >
              <span>Fin de la guía disponible</span>
            </div>
          ) : null}
          {items.map((item) => {
            const channel = pages.row(item.index);
            const segments = segmentsOf(item.index);
            return (
              <div
                key={item.key}
                className="guia-row"
                role="row"
                aria-rowindex={item.index + 2}
                style={{ top: item.start, width: contentW }}
              >
                <ChannelCell channel={channel} version={head.version} wide={scale.stripH > 0} />
                {segments ? (
                  visibleSegments(segments, qFrom, qTo).map((segment) => (
                    <Block
                      key={`${segment.kind}-${segment.start}`}
                      id={cellId(item.index, segment)}
                      segment={segment}
                      left={scale.colW + xOf(segment.start, timeline, scale)}
                      width={
                        xOf(segment.end, timeline, scale) - xOf(segment.start, timeline, scale)
                      }
                      now={now}
                      selected={selection.row === item.index && segment === selectedSegment}
                      onClick={() => {
                        select(
                          {
                            row: item.index,
                            at: Math.max(segment.start, Math.min(selection.at, segment.end - 1)),
                          },
                          false,
                        );
                        scrollRef.current?.focus({ preventScroll: true });
                        if (touchSheet && channel) onInfo({ channel, segment });
                      }}
                      onDoubleClick={() => {
                        if (!channel) return;
                        if (
                          segment.kind !== 'prog' ||
                          airingOf(segment.start, segment.end, now) === 'live'
                        )
                          onPlay(channel);
                      }}
                    />
                  ))
                ) : (
                  <div
                    className="guia-block guia-block--loading"
                    role="gridcell"
                    aria-label="Cargando"
                    style={{ left: scale.colW + Math.max(0, view.left), width: areaW }}
                  >
                    <Skeleton height={14} width="40%" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {nowInRange && !nowVisible ? (
        <Button
          className="guia-nowpill"
          variant="primary"
          size="sm"
          icon={nowX < view.left + scale.colW ? 'chev-l' : 'chev-r'}
          onClick={() => controls.current?.goNow()}
        >
          Ahora
        </Button>
      ) : null}
      {failed ? (
        <div className="guia-failed" role="status">
          <Icon name="aviso" size={16} />
          <span>No se pudo cargar parte de la guía</span>
          <Button size="sm" variant="quiet" onClick={() => retryFailedTiles(client)}>
            Reintentar
          </Button>
        </div>
      ) : null}
      {typed ? (
        <div className="guia-typed" role="status" aria-live="polite">
          Canal <Num value={typed} />
        </div>
      ) : null}
    </div>
  );
}

function cellId(row: number, segment: Segment): string {
  return `guia-c-${row}-${segment.start}`;
}

function ChannelCell({
  channel,
  version,
  wide,
}: {
  channel: IptvGuideChannel | undefined;
  version: string;
  wide: boolean;
}) {
  if (!channel)
    return (
      <div className="guia-chan" role="rowheader" aria-label="Cargando canal">
        <Skeleton width="70%" height={12} />
      </div>
    );
  return (
    <div className="guia-chan" role="rowheader" title={channel.name}>
      <span className="guia-chan__num">
        {channel.number !== null ? (
          <Num value={channel.number} />
        ) : (
          <span aria-hidden="true">·</span>
        )}
      </span>
      {wide ? <ChannelLogo channel={channel} version={version} size={30} /> : null}
      <span className="guia-chan__name">
        {channel.name}
        {channel.country ? <small className="guia-chan__country">{channel.country}</small> : null}
      </span>
      {channel.favorite ? <Icon name="star-f" size={16} className="guia-chan__fav" /> : null}
    </div>
  );
}

/** Logo del proveedor por el proxy propio; si no hay o falla, la marca de siempre. */
export function ChannelLogo({
  channel,
  version,
  size,
}: {
  channel: IptvGuideChannel;
  version: string;
  size: number;
}) {
  const src = logoSrc(channel, version);
  const [broken, setBroken] = useState(false);
  if (src && !broken)
    return (
      <img
        className="guia-logo"
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />
    );
  return <ChannelMark name={channel.name} size={size} />;
}

function Block({
  id,
  segment,
  left,
  width,
  now,
  selected,
  onClick,
  onDoubleClick,
}: {
  id: string;
  segment: Segment;
  left: number;
  width: number;
  now: number;
  selected: boolean;
  onClick(): void;
  onDoubleClick(): void;
}) {
  const airing = segment.kind === 'prog' ? airingOf(segment.start, segment.end, now) : null;
  const label = segmentLabel(segment, now);
  const narrow = width < 44;
  const text =
    segment.kind === 'prog'
      ? segment.programme.title
      : segment.kind === 'none'
        ? 'Sin información'
        : segment.kind === 'error'
          ? 'No se pudo cargar'
          : '';
  return (
    <div
      id={id}
      role="gridcell"
      aria-selected={selected}
      aria-label={label}
      title={narrow ? label : undefined}
      className={cx(
        'guia-block',
        `guia-block--${segment.kind}`,
        airing && `guia-block--${airing}`,
        selected && 'guia-block--selected',
      )}
      style={{ left, width: Math.max(1, width - 2), '--bx': `${left}px` } as CSSProperties}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {segment.kind === 'loading' ? (
        <span className="guia-block__shimmer" />
      ) : narrow ? null : (
        <span className="guia-block__label">
          <span className="guia-block__title">{text}</span>
          {segment.kind === 'prog' && width >= 140 ? (
            <span className="guia-block__time">
              {formatTime(segment.programme.start)}-{formatTime(segment.programme.end)}
            </span>
          ) : null}
        </span>
      )}
    </div>
  );
}
