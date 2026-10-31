/* Vista «Guía TV» (`?vista=guia`, docs/iptv.md §20; investigación en
   docs/investigacion/guia-tv.md). La parrilla de la IPTV estilo Movistar+:
   «Favoritos | Todos», días con programación, «Ahora», la parrilla (Board)
   y el programa elegido (hoja en el móvil).

   Desde 768, la Guía del rediseño de escritorio (01-escritorio.html §2):
   barra «Guía» con buscador y campana; debajo, los días (Ayer, Hoy, Dom 1…)
   y los chips Favoritos (se quita y se pone: sin él, todos los canales),
   Deportes, Cine y Noticias (`&tipo=`, que se suman a Favoritos); la
   parrilla a lo ancho (unas 3 h a la vista) y, al pulsar un programa, un
   popover con «Te aviso» y «Ver ficha». El móvil no cambia.

   En la navegación es hija de Canales (se ilumina Canales): se entra con el
   botón «Guía TV» de la cabecera de Canales, que solo sale con IPTV activa.
   Así la barra no pasa de 5 destinos (con «Pelis y series»). */

import type { IptvGuideChannel, IptvGuideScope } from '@ace/shared';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { ViewProps } from '../../app/contracts.ts';
import { useNavigate, useSearchParam } from '../../app/router.tsx';
import { VISTA_TITLE } from '../../app/routes.ts';
import { ViewHeader } from '../../app/ViewHeader.tsx';
import { cx } from '../../lib/cx.ts';
import { useLayoutKind } from '../../lib/media.ts';
import { readItem, STORAGE_KEYS, writeItem } from '../../lib/storage.ts';
import { Button, Chip, EmptyState, Segmented, Skeleton } from '../../ui/index.ts';
import { playChannel } from '../library/play.ts';
import { Board, type BoardControls, type Picked, type Selection } from './Board.tsx';
import { useGuidePages } from './data.ts';
import { InfoSheet, ProgrammePopover, type PopoverTarget } from './Detail.tsx';
import {
  buildTimeline,
  dayChipLabel,
  dayStart,
  DESK_MAX_DAYS,
  formatLongDay,
  GUIDE_TYPES,
  pagesBetween,
  scaleFor,
  SCOPE_PARAM,
  SCOPE_URL,
  scopeFromUrl,
  TYPE_PARAM,
  typeFromUrl,
  type GuideType,
} from './model.ts';
import './demo.ts';
import './guia.css';

const NOW_TICK_MS = 30_000;

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function useScope(): [IptvGuideScope, (scope: IptvGuideScope) => void] {
  const [param, setParam] = useSearchParam(SCOPE_PARAM);
  const scope =
    scopeFromUrl(param) ?? scopeFromUrl(readItem(STORAGE_KEYS.guideScope)) ?? 'favorites';
  const set = useCallback(
    (next: IptvGuideScope) => {
      writeItem(STORAGE_KEYS.guideScope, SCOPE_URL[next]);
      setParam(SCOPE_URL[next]);
    },
    [setParam],
  );
  return [scope, set];
}

/** El chip de tipo de escritorio (`&tipo=deportes`): filtra dentro del ámbito y no se recuerda. */
function useType(): [GuideType | null, (type: GuideType | null) => void] {
  const [param, setParam] = useSearchParam(TYPE_PARAM);
  const set = useCallback((next: GuideType | null) => setParam(next), [setParam]);
  return [typeFromUrl(param), set];
}

const dateTime = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export default function GuiaView({ active }: ViewProps) {
  const navigate = useNavigate();
  const kind = useLayoutKind();
  const desk = kind !== 'mobile';
  const scale = scaleFor(kind);
  const now = useNow(active);
  const [chosenScope, setScope] = useScope();
  const [urlType, setType] = useType();
  // Los chips de tipo son de escritorio: en el móvil, `&tipo=` no cuenta.
  const type = desk ? urlType : null;
  const scope = chosenScope;
  const [pageList, setPageList] = useState<number[]>([0]);
  const pages = useGuidePages(scope, pageList, active, type, desk);
  const head = pages.head;

  const onRows = useCallback((first: number, last: number) => {
    const next = pagesBetween(first, last, Number.POSITIVE_INFINITY);
    setPageList((old) => (old.join(',') === next.join(',') ? old : next));
  }, []);

  const [selection, setSelection] = useState<Selection>(() => ({ row: 0, at: Date.now() }));
  const [picked, setPicked] = useState<Picked | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [popover, setPopover] = useState<PopoverTarget | null>(null);
  const [viewTime, setViewTime] = useState(() => Date.now());
  const controls = useRef<BoardControls | null>(null);

  // Otro ámbito u otro tipo: de nuevo arriba, a esta hora.
  const shownScope = head?.scope ?? scope;
  /* Los chips responden al momento: mientras llega la lista nueva (se sigue
     viendo la de antes), marcan lo pedido; luego, lo que dio el servidor
     (sin favoritos, «Todos»). */
  const chipScope = pages.stale ? scope : shownScope;
  const listKey = `${shownScope}|${type ?? ''}`;
  const lastList = useRef(listKey);
  useEffect(() => {
    if (lastList.current === listKey) return;
    lastList.current = listKey;
    setSelection({ row: 0, at: Date.now() });
    setPageList([0]);
    setPopover(null);
  }, [listKey]);

  const timeline = useMemo(
    () =>
      buildTimeline(
        {
          from: head?.from ?? null,
          to: head?.to ?? null,
          coveredFrom: head?.coveredFrom ?? null,
          coveredTo: head?.coveredTo ?? null,
        },
        now,
        desk ? { yesterday: true, maxDays: DESK_MAX_DAYS } : {},
      ),
    // Basta con recalcularla al cambiar de día o de guía.
    [head?.from, head?.to, head?.coveredFrom, head?.coveredTo, dayStart(now), desk],
  );

  const play = useCallback(
    (channel: IptvGuideChannel) => {
      setInfoOpen(false);
      setPopover(null);
      playChannel(navigate, {
        hash: channel.id,
        title: channel.name,
        ih: false,
        category: 'IPTV',
        record: true,
        origin: 'biblioteca',
        iptv: channel.id,
      });
    },
    [navigate],
  );
  const openInfo = useCallback((next: Picked) => {
    setPicked(next);
    setInfoOpen(true);
  }, []);
  const openPopover = useCallback((next: Picked, anchor: HTMLElement) => {
    setPicked(next);
    setPopover({ picked: next, anchor });
  }, []);

  // El alto de la parrilla: lo que queda de pantalla debajo de la cabecera.
  const boardRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const node = boardRef.current;
      if (!node) return;
      const next = Math.round(node.getBoundingClientRect().top + (globalThis.scrollY ?? 0));
      setTop((old) => (old === next ? old : next));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  const scopeItems = [
    { value: 'favorites' as const, label: 'Favoritos', ...(head ? { count: head.favorites } : {}) },
    { value: 'all' as const, label: 'Todos', ...(head ? { count: head.all } : {}) },
  ];
  const goIptvSettings = () => navigate({ vista: 'ajustes', seccion: 'iptv' });

  const header = desk ? (
    <ViewHeader title="Guía" />
  ) : (
    <ViewHeader
      title={VISTA_TITLE.guia}
      subtitle={head && head.state === 'ready' ? subtitleOf(head) : undefined}
      actions={
        head?.state === 'ready' ? (
          <Segmented
            label="Canales de la guía"
            items={scopeItems}
            value={shownScope}
            onChange={setScope}
            className="guia-scope"
          />
        ) : null
      }
    />
  );

  let body;
  if (!head && pages.loading) {
    body = (
      <div
        className="guia-board guia-board--skeleton"
        aria-busy="true"
        ref={boardRef}
        style={{ '--guia-top': `${top}px` } as CSSProperties}
      >
        <Skeleton height="100%" radius="l" />
        <span className="sr-only">Cargando la guía…</span>
      </div>
    );
  } else if (!head) {
    body = (
      <EmptyState
        tone="error"
        title="No se pudo cargar la guía"
        actions={
          <Button variant="primary" icon="refresh" onClick={pages.refetch}>
            Reintentar
          </Button>
        }
      >
        Comprueba la conexión con tu Umbrel y vuelve a intentarlo.
      </EmptyState>
    );
  } else if (head.state === 'inactive') {
    body = (
      <EmptyState
        title="Conecta tu IPTV para ver la guía"
        actions={
          <Button variant="primary" icon="ajustes" onClick={goIptvSettings}>
            Ir a Ajustes → IPTV
          </Button>
        }
      >
        La Guía TV enseña la programación de los canales de tu proveedor de IPTV. Si ya la tienes,
        puede que esté en pausa.
      </EmptyState>
    );
  } else if (head.state === 'preparing') {
    body = (
      <EmptyState
        title="Preparando la guía…"
        actions={
          <Button variant="quiet" icon="refresh" onClick={pages.refetch}>
            Volver a mirar
          </Button>
        }
      >
        Tu proveedor está mandando la programación. En cuanto llegue, aparece aquí sola.
      </EmptyState>
    );
  } else if (head.state === 'none') {
    body = (
      <EmptyState
        title="Tu proveedor no da guía"
        actions={
          <Button variant="quiet" icon="ajustes" onClick={goIptvSettings}>
            Ver Ajustes → IPTV
          </Button>
        }
      >
        Tu IPTV no trae programación (EPG). Los canales se pueden ver igual desde Canales.
      </EmptyState>
    );
  } else if (head.state === 'failed') {
    body = (
      <EmptyState
        tone="error"
        title="No se pudo descargar la guía"
        actions={
          <>
            <Button variant="primary" icon="refresh" onClick={pages.refetch}>
              Reintentar
            </Button>
            <Button variant="quiet" icon="ajustes" onClick={goIptvSettings}>
              Ajustes → IPTV
            </Button>
          </>
        }
      >
        {head.failedAt
          ? `Último intento: ${dateTime.format(new Date(head.failedAt))}. Se vuelve a probar sola.`
          : 'Se vuelve a probar sola dentro de un rato.'}
      </EmptyState>
    );
  } else if (head.total === 0 && type) {
    const typeName = GUIDE_TYPES.find((item) => item.value === type)?.label.toLowerCase() ?? type;
    const inFavorites = shownScope === 'favorites';
    body = (
      <>
        <DeskBar
          days={[]}
          viewDay={dayStart(viewTime)}
          today={dayStart(now)}
          scope={chipScope}
          type={type}
          onDay={() => {}}
          onScope={setScope}
          onType={setType}
        />
        <EmptyState
          title={
            inFavorites
              ? `Ninguno de tus favoritos es de ${typeName} con guía`
              : `No hay canales de ${typeName} con guía`
          }
          actions={
            inFavorites ? (
              <Button variant="quiet" onClick={() => setScope('all')}>
                Buscar en todos los canales
              </Button>
            ) : (
              <Button variant="quiet" onClick={() => setType(null)}>
                Ver todos los canales
              </Button>
            )
          }
        >
          {inFavorites
            ? 'Quita «Favoritos» para ver los de todos los canales de tu proveedor.'
            : 'Tu proveedor no tiene programación de canales de este tipo.'}
        </EmptyState>
      </>
    );
  } else if (head.total === 0) {
    body = (
      <EmptyState
        title="Ningún canal tiene programación"
        actions={
          <Button variant="quiet" onClick={() => navigate({ vista: 'biblioteca' })}>
            Ir a Canales
          </Button>
        }
      >
        La guía de tu proveedor ha llegado vacía. Se vuelve a descargar sola.
      </EmptyState>
    );
  } else {
    const days = timeline.days;
    const viewDay = dayStart(viewTime);
    const today = dayStart(now);
    const onlyToday = days.length === 1;
    const goDay = (start: number) =>
      start === today
        ? controls.current?.goNow()
        : controls.current?.goTo(start + (viewTime - viewDay));
    body = (
      <>
        {desk ? (
          <DeskBar
            days={days.map((day) => day.start)}
            viewDay={viewDay}
            today={today}
            scope={chipScope}
            type={type}
            onDay={goDay}
            onScope={setScope}
            onType={setType}
            onlyToday={onlyToday && head.coveredTo !== null}
          />
        ) : (
          <div className="guia-toolbar">
            {onlyToday ? (
              <p className="guia-toolbar__day">
                <strong>Hoy</strong> · {formatLongDay(today)}
                {head.coveredTo !== null ? (
                  <span className="guia-toolbar__hint"> · tu proveedor solo da la guía de hoy</span>
                ) : null}
              </p>
            ) : (
              <div className="guia-days" role="group" aria-label="Día">
                {days.map((day) => (
                  <Chip
                    key={day.start}
                    pressed={viewDay === day.start}
                    onClick={() =>
                      day.start === today
                        ? controls.current?.goNow()
                        : controls.current?.goTo(day.start + (viewTime - viewDay))
                    }
                  >
                    {day.label}
                  </Chip>
                ))}
              </div>
            )}
            <Button
              variant="quiet"
              size="sm"
              icon="clock"
              onClick={() => controls.current?.goNow()}
              title="Volver a ahora (Inicio)"
            >
              Ahora
            </Button>
          </div>
        )}
        {head.fellBack ? (
          <p className="guia-note">
            Ninguno de tus favoritos tiene guía: te enseño todos los canales.
          </p>
        ) : null}
        {head.partial ? (
          <p className="guia-note">
            Tu proveedor no da la guía completa: solo hay programación de unos pocos canales.
          </p>
        ) : null}
        <div
          ref={boardRef}
          className="guia-board"
          style={
            {
              '--guia-top': `${top}px`,
              '--col-w': `${scale.colW}px`,
            } as CSSProperties
          }
        >
          <Board
            head={head}
            pages={pages}
            onRows={onRows}
            timeline={timeline}
            scale={scale}
            now={now}
            active={active}
            touchSheet={!desk}
            desk={desk}
            {...(desk ? { onOpen: openPopover } : {})}
            selection={selection}
            onSelection={setSelection}
            onPicked={setPicked}
            onPlay={play}
            onInfo={openInfo}
            onViewTime={setViewTime}
            controls={controls}
          />
        </div>
        {desk ? (
          <ProgrammePopover
            target={popover}
            version={head.version}
            now={now}
            onClose={() => setPopover(null)}
            onPlay={() => popover && play(popover.picked.channel)}
          />
        ) : null}
        <InfoSheet
          picked={picked}
          open={infoOpen}
          version={head.version}
          now={now}
          onClose={() => setInfoOpen(false)}
          onPlay={() => picked && play(picked.channel)}
        />
      </>
    );
  }

  return (
    <div className={cx('guia', desk && 'guia--desk')} data-layout={kind}>
      {header}
      {body}
    </div>
  );
}

/** La barra de escritorio bajo el título: los días y los chips (Favoritos y por tipo). */
function DeskBar({
  days,
  viewDay,
  today,
  scope,
  type,
  onDay,
  onScope,
  onType,
  onlyToday = false,
}: {
  days: readonly number[];
  viewDay: number;
  today: number;
  scope: IptvGuideScope;
  type: GuideType | null;
  onDay(start: number): void;
  onScope(scope: IptvGuideScope): void;
  onType(type: GuideType | null): void;
  /** Solo hay «Hoy» porque el proveedor no da más: se dice (como en el móvil). */
  onlyToday?: boolean;
}) {
  return (
    <div className="guia-bar">
      {days.length ? (
        <div className="guia-bar__days" role="group" aria-label="Día">
          {days.map((start) => (
            <button
              key={start}
              type="button"
              className="guia-bar__day"
              aria-pressed={viewDay === start}
              aria-current={start === today ? 'date' : undefined}
              onClick={() => onDay(start)}
            >
              {dayChipLabel(start, today)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="guia-bar__chips" role="group" aria-label="Canales">
        <Chip
          pressed={scope === 'favorites'}
          onClick={() => onScope(scope === 'favorites' ? 'all' : 'favorites')}
        >
          Favoritos
        </Chip>
        {GUIDE_TYPES.map((item) => (
          <Chip
            key={item.value}
            pressed={type === item.value}
            onClick={() => onType(type === item.value ? null : item.value)}
          >
            {item.label}
          </Chip>
        ))}
      </div>
      {onlyToday ? <p className="guia-bar__hint">Tu proveedor solo da la guía de hoy</p> : null}
    </div>
  );
}

function subtitleOf(head: NonNullable<ReturnType<typeof useGuidePages>['head']>): string {
  const parts = [head.provider || 'Tu IPTV'];
  parts.push(`${head.all.toLocaleString('es-ES')} canales con guía`);
  if (head.failedAt && head.updatedAt)
    parts.push(`no se pudo actualizar; es la del ${dateTime.format(new Date(head.updatedAt))}`);
  return parts.join(' · ');
}
