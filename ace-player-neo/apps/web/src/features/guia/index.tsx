/* Vista «Guía TV» (`?vista=guia`, docs/iptv.md §20; investigación en
   docs/investigacion/guia-tv.md). La parrilla de la IPTV estilo Movistar+:
   «Favoritos | Todos», días con programación, «Ahora», la parrilla (Board)
   y el programa elegido (franja en PC, hoja en el móvil).

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
import { useLayoutKind } from '../../lib/media.ts';
import { readItem, STORAGE_KEYS, writeItem } from '../../lib/storage.ts';
import { Button, Chip, EmptyState, Segmented, Skeleton } from '../../ui/index.ts';
import { playChannel } from '../library/play.ts';
import { Board, type BoardControls, type Picked, type Selection } from './Board.tsx';
import { useGuidePages } from './data.ts';
import { InfoSheet, Strip } from './Detail.tsx';
import {
  buildTimeline,
  dayStart,
  formatLongDay,
  pagesBetween,
  scaleFor,
  SCOPE_PARAM,
  SCOPE_URL,
  scopeFromUrl,
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

const dateTime = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export default function GuiaView({ active }: ViewProps) {
  const navigate = useNavigate();
  const kind = useLayoutKind();
  const scale = scaleFor(kind);
  const now = useNow(active);
  const [scope, setScope] = useScope();
  const [pageList, setPageList] = useState<number[]>([0]);
  const pages = useGuidePages(scope, pageList, active);
  const head = pages.head;

  const onRows = useCallback((first: number, last: number) => {
    const next = pagesBetween(first, last, Number.POSITIVE_INFINITY);
    setPageList((old) => (old.join(',') === next.join(',') ? old : next));
  }, []);

  const [selection, setSelection] = useState<Selection>(() => ({ row: 0, at: Date.now() }));
  const [picked, setPicked] = useState<Picked | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [viewTime, setViewTime] = useState(() => Date.now());
  const controls = useRef<BoardControls | null>(null);

  // Otro ámbito: de nuevo arriba, a esta hora.
  const shownScope = head?.scope ?? scope;
  const lastScope = useRef(shownScope);
  useEffect(() => {
    if (lastScope.current === shownScope) return;
    lastScope.current = shownScope;
    setSelection({ row: 0, at: Date.now() });
    setPageList([0]);
  }, [shownScope]);

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
      ),
    // Basta con recalcularla al cambiar de día o de guía.
    [head?.from, head?.to, head?.coveredFrom, head?.coveredTo, dayStart(now)],
  );

  const play = useCallback(
    (channel: IptvGuideChannel) => {
      setInfoOpen(false);
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

  const header = (
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
    body = (
      <>
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
              '--strip-h': `${scale.stripH}px`,
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
            touchSheet={scale.stripH === 0}
            selection={selection}
            onSelection={setSelection}
            onPicked={setPicked}
            onPlay={play}
            onInfo={openInfo}
            onViewTime={setViewTime}
            controls={controls}
          />
          {scale.stripH > 0 ? (
            <Strip
              picked={picked}
              version={head.version}
              now={now}
              onPlay={() => picked && play(picked.channel)}
              onInfo={() => picked && openInfo(picked)}
            />
          ) : null}
        </div>
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
    <div className="guia" data-layout={kind}>
      {header}
      {body}
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
