/* El selector de fuentes entero: cabecera con el recuento, progreso del
   comprobador (§6), la barra «Emitiendo» (móvil, se desliza para cambiar de
   fuente), la rejilla de carteles (plan Palco fase 2, decisión W6), el aviso
   cuando ninguna da señal y el inspector de la fuente activa.

   Se pinta en UN sitio a la vez: en la pestaña «Fuentes» del panel lateral de
   escritorio (rack, dos carteles por fila) o, si no hay panel (móvil, tableta
   o plegado), en la misma pestaña dentro de la vista (list). Ahí también van
   sus atajos: N (siguiente fuente) y 1-9 (la fuente n). Cambiar de fuente con
   la barra o deslizando da un toque háptico rígido (HAPTIC_MAP). */

import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { useShortcut } from '../../app/shortcuts.ts';
import { cx } from '../../lib/cx.ts';
import { useSwipe } from '../../lib/gestures.ts';
import { haptic } from '../../lib/haptics.ts';
import { prefersReducedMotion } from '../../lib/media.ts';
import { usePlayerSelector } from '../../player/api.ts';
import { Button, EmptyState, IconButton, Num, ProgressBar, SkeletonRows } from '../../ui/index.ts';
import { isIptv, scanProgress, scanProgressText } from './model.ts';
import { openPaste, openResolver, research, selectSource, stepSource } from './session.ts';
import { SourceInspector, type InspectorTarget } from './SourceInspector.tsx';
import { SourceList, type SourceListVariant } from './SourceList.tsx';
import { useSourcesView, type SourceRow } from './useSources.ts';
import './sources.css';

/** «Emitiendo» + canal + «Fuente 2 de 6», con ‹ › y deslizar para cambiar (móvil). */
function NowBar({
  rows,
  total,
  activeHash,
}: {
  rows: readonly SourceRow[];
  total: number;
  activeHash: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const title = usePlayerSelector((state) => state.channel?.title ?? null);
  const ids = rows.map((row) => row.entry.id);
  const active = rows.find((row) => row.entry.id === activeHash);
  const canStep = ids.length > 1;
  const step = (direction: 1 | -1) => {
    haptic('rigid');
    stepSource(direction, ids);
  };
  const move = (dx: number) => {
    if (textRef.current)
      textRef.current.style.transform = dx
        ? `translateX(${Math.max(-60, Math.min(60, dx / 3))}px)`
        : '';
  };
  useSwipe(ref, {
    /* Solo con la barra pintada: al entrar al partido todavía no suena nada
       (sin barra) y useSwipe se engancha al elemento cuando `enabled` cambia;
       si ya valía true antes de que existiera, el gesto no llegaba nunca. */
    enabled: canStep && active !== undefined && title !== null,
    onMove: (dx) => move(dx),
    onCancel: () => move(0),
    onSwipe: (direction) => {
      move(0);
      if (direction === 'left') step(1);
      if (direction === 'right') step(-1);
    },
  });
  if (!active || !title) return null;
  return (
    <div className="src-now" ref={ref}>
      {canStep ? (
        <IconButton icon="chev-l" label="Fuente anterior" onClick={() => step(-1)} />
      ) : null}
      <div className="src-now__text" ref={textRef}>
        <span className="src-now__label">Emitiendo</span>
        <span className="src-now__title" title={title}>
          {title}
        </span>
        <span className="src-now__meta">
          Fuente <Num value={active.number} /> de <Num value={total} />
          {canStep ? <span className="src-now__hint"> · desliza para cambiar</span> : null}
        </span>
      </div>
      {canStep ? (
        <IconButton icon="chev-r" label="Fuente siguiente" onClick={() => step(1)} />
      ) : null}
    </div>
  );
}

/**
 * El rack vive en el panel lateral, que tiene su propio scroll: si la fuente
 * activa CAMBIA y queda fuera, se desplaza ese panel (nunca la página, y
 * nunca con scrollIntoView). Repintar con la misma activa no mueve nada.
 */
function useKeepActiveInPanel(
  root: RefObject<HTMLElement | null>,
  activeHash: string | null,
  enabled: boolean,
) {
  const last = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!enabled || !activeHash || last.current === activeHash) return;
    const first = last.current === null;
    last.current = activeHash;
    const panel = root.current?.closest<HTMLElement>('.app-aside');
    const row = root.current?.querySelector<HTMLElement>('.src-poster[aria-current="true"]');
    if (!panel || !row) return;
    const box = panel.getBoundingClientRect();
    const item = row.getBoundingClientRect();
    // En otra pestaña del panel (oculta) no hay nada que enseñar.
    if (!item.height) return;
    let delta = 0;
    if (item.top < box.top + 12) delta = item.top - box.top - 12;
    else if (item.bottom > box.bottom - 12) delta = item.bottom - box.bottom + 12;
    if (Math.abs(delta) < 1) return;
    panel.scrollTo({
      top: panel.scrollTop + delta,
      behavior: first || prefersReducedMotion() ? 'auto' : 'smooth',
    });
  });
}

export interface SourcesPanelProps {
  variant: SourceListVariant;
  /** Botón de plegar el panel lateral (solo en el panel). */
  headerExtra?: ReactNode;
  /** Con el reproductor en otra cosa: el inspector del canal que suena (modo canal sin hermanas). */
  channelFallback?: InspectorTarget | null;
  className?: string;
}

export function SourcesPanel({
  variant,
  headerExtra,
  channelFallback = null,
  className,
}: SourcesPanelProps) {
  const view = useSourcesView();
  const { state, rows, shown, tucked } = view;
  const headingId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const inMatch = state.kind === 'match';
  useKeepActiveInPanel(rootRef, state.activeHash, variant === 'rack');

  const visibleIds = shown.map((row) => row.entry.id);
  useShortcut({
    id: 'fuentes.siguiente',
    keys: ['n'],
    display: ['N'],
    label: 'Pasa a la siguiente fuente',
    group: 'Fuentes',
    when: () => visibleIds.length > 1,
    handler: () => stepSource(1, visibleIds),
  });
  useShortcut({
    id: 'fuentes.numero',
    keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    display: ['1', '…', '9'],
    label: 'Elige la fuente con ese número',
    group: 'Fuentes',
    when: () => rows.length > 0,
    handler: (event) => {
      const row = rows[Number(event.key) - 1];
      if (row) selectSource(row.entry.id);
    },
  });

  const activeRow = rows.find((row) => row.active) ?? null;
  const target: InspectorTarget | null = activeRow
    ? {
        hash: activeRow.entry.id,
        title: activeRow.entry.title,
        ih: activeRow.entry.ih === true,
        learned: activeRow.entry.learned === 'correct',
        iptv: isIptv(activeRow.entry),
      }
    : channelFallback;

  const checking = shown.find(
    (row) => row.effective.state === 'checking' && row.effective.reason !== 'player_check',
  );
  const progressText = scanProgressText(
    state.scan,
    state.entries,
    view.effectiveById,
    state.preheat,
  );
  const showProgress = inMatch && (state.entries.length > 0 || state.phase === 'resolving');

  let body: ReactNode;
  if (state.phase === 'resolving' && !state.entries.length) {
    body = <SkeletonRows rows={3} label="Buscando fuentes para el partido…" />;
  } else if (state.phase === 'no_channels') {
    body = (
      <EmptyState
        title="Canal por confirmar"
        actions={
          <Button size="sm" icon="paste" onClick={() => openPaste(true)}>
            Pegar hash
          </Button>
        }
      >
        Este partido todavía no tiene canal anunciado. Si lo encuentras por tu cuenta, pega su
        Content ID.
      </EmptyState>
    );
  } else if ((state.phase === 'choices' || state.phase === 'not_found') && !state.entries.length) {
    body = (
      <EmptyState
        title={
          state.phase === 'choices'
            ? 'Elige la señal que quieres usar'
            : 'No hemos encontrado el canal'
        }
        actions={
          <>
            <Button size="sm" variant="primary" icon="buscar" onClick={() => openResolver(true)}>
              Encontrar canal
            </Button>
            <Button size="sm" icon="paste" onClick={() => openPaste(true)}>
              Pegar hash
            </Button>
          </>
        }
      >
        {state.phase === 'choices'
          ? 'Hay varias coincidencias posibles. No reproduciremos ninguna sin que la confirmes.'
          : 'No aparece en tus listas ni en el buscador. Puedes pegar un Content ID.'}
      </EmptyState>
    );
  } else if (rows.length) {
    body = (
      <>
        {variant === 'list' ? (
          <NowBar rows={shown} total={rows.length} activeHash={state.activeHash} />
        ) : null}
        <SourceList
          shown={shown}
          tucked={tucked}
          variant={variant}
          inMatch={inMatch}
          label={inMatch ? 'Fuentes del partido' : 'Fuentes del canal'}
        />
      </>
    );
  }

  // Modo canal sin hermanas: sin selector (§7.1), solo el inspector.
  const hideHeader = !inMatch && !rows.length;

  return (
    <section
      ref={rootRef}
      className={cx('src', `src--${variant}`, className)}
      aria-labelledby={hideHeader ? undefined : headingId}
      aria-label={hideHeader ? 'Acciones del canal' : undefined}
    >
      {hideHeader ? null : (
        <header className="src__head">
          <h2 id={headingId} className="src__title">
            {inMatch ? 'Fuentes' : 'Otras fuentes'}
            {rows.length ? (
              <span className="src__count">
                <Num value={rows.length} />
              </span>
            ) : null}
          </h2>
          <div className="src__actions">
            {inMatch ? (
              <IconButton
                icon="refresh"
                label={state.researching ? 'Rebuscando…' : 'Rebuscar fuentes'}
                busy={state.researching}
                className="src__research"
                onClick={() => void research()}
              />
            ) : null}
            {headerExtra}
          </div>
        </header>
      )}
      {showProgress ? (
        <div className="src__progress" aria-live="polite">
          <ProgressBar
            value={state.phase === 'resolving' ? 0 : scanProgress(state.scan, state.entries)}
            label="Progreso del comprobador"
            tone="accent"
            size="thin"
            className={cx(state.scan && state.scan.status !== 'complete' && 'is-running')}
          />
          <p className="src__progress-text">
            {state.phase === 'resolving' ? 'Preparando fuentes' : progressText}
            {checking && state.scan && state.scan.status !== 'complete' ? (
              <span className="src__progress-now">
                {' '}
                · la <Num value={checking.number} /> se está probando ahora
              </span>
            ) : null}
          </p>
        </div>
      ) : null}
      {state.failureText ? (
        <div className="src__failure" role="status">
          <p>{state.failureText}</p>
          <div className="src__failure-actions">
            <Button
              size="sm"
              icon="refresh"
              busy={state.researching}
              onClick={() => void research()}
            >
              {state.researching ? 'Rebuscando…' : 'Rebuscar'}
            </Button>
            <Button size="sm" icon="paste" onClick={() => openPaste(true)}>
              Pegar hash
            </Button>
          </div>
        </div>
      ) : null}
      {body}
      <SourceInspector
        target={target}
        inMatch={inMatch}
        researching={state.researching}
        layout={variant === 'rack' ? 'grid' : 'row'}
      />
    </section>
  );
}
