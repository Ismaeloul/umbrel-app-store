/* Lista de fuentes (inventario §7.1-7.2):
   - `list` (móvil y tableta, opción A): una fila por fuente con número,
     proveedor en una palabra, medidor con palabra y una frase humana
     («funcionó en el reproductor», «reintento a las 20:16»).
   - `rack` (escritorio, injerto B2): columnas alineadas Nº · proveedor ·
     estado · pares · Mbit/s con cifras de celda fija.

   Reglas que cuida:
   - El orden es el del servidor y los números no cambian: una fuente que se
     pliega no renumera las demás, y la lista nunca se recoloca sola (regla 1).
   - Estado siempre con forma + palabra (SignalBadge); «comprobando» late.
   - La activa lleva «En pantalla» y aria-current; pulsarla no hace nada.
   - Clic derecho o pulsación larga: menú contextual de la fuente.
   - Flechas ↑ ↓ para moverse entre filas; Intro o Espacio la eligen. */

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import { cx } from '../../lib/cx.ts';
import { acestreamLink, copyText, openExternal } from '../../player/clipboard.ts';
import { notify } from '../../notices/index.ts';
import { Icon, Menu, Num, SignalBadge, useContextMenu, type MenuItem } from '../../ui/index.ts';
import { swarmMbit } from './model.ts';
import { openReport, selectSource, confirmSource } from './session.ts';
import type { SourceRow } from './useSources.ts';

export type SourceListVariant = 'list' | 'rack';

function rowMenu(row: SourceRow, inMatch: boolean): MenuItem[] {
  const items: MenuItem[] = [
    {
      id: 'ver',
      label: row.onScreen ? 'Ya está en pantalla' : 'Ver esta fuente',
      icon: 'play',
      disabled: row.onScreen,
      onSelect: () => selectSource(row.entry.id),
    },
    {
      id: 'copiar-hash',
      label: 'Copiar hash',
      icon: 'hash',
      onSelect: () =>
        void copyText(row.entry.id).then((ok) =>
          notify(ok ? 'Hash copiado' : 'No se pudo copiar el hash', { tone: ok ? 'ok' : 'err', icon: 'copy' }),
        ),
    },
    {
      id: 'abrir',
      label: 'Abrir en la app de AceStream',
      icon: 'externo',
      onSelect: () => openExternal(acestreamLink(row.entry.id)),
    },
  ];
  if (inMatch && row.active && row.entry.learned !== 'correct')
    items.push({
      id: 'correcto',
      label: 'Es el canal correcto',
      icon: 'learn',
      separated: true,
      onSelect: () => void confirmSource(row.entry.id),
    });
  items.push({
    id: 'reportar',
    label: 'Reportar…',
    icon: 'flag',
    danger: true,
    separated: !(inMatch && row.active && row.entry.learned !== 'correct'),
    onSelect: () => openReport(row.entry.id),
  });
  return items;
}

function focusSibling(event: KeyboardEvent<HTMLButtonElement>, listRef: RefObject<HTMLElement | null>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.src-row') ?? [])];
  const index = buttons.indexOf(event.currentTarget);
  const next = buttons[index + (event.key === 'ArrowDown' ? 1 : -1)];
  if (!next) return;
  event.preventDefault();
  next.focus();
}

function SourceRowView({
  row,
  variant,
  inMatch,
  listRef,
  index,
}: {
  row: SourceRow;
  variant: SourceListVariant;
  inMatch: boolean;
  listRef: RefObject<HTMLElement | null>;
  index: number;
}) {
  const { bind, menu } = useContextMenu();
  // La pulsación larga abre el menú; el «clic» que llega al soltar el dedo
  // justo después no debe elegir la fuente.
  const menuOpenedAt = useRef(0);
  useEffect(() => {
    if (menu.open) menuOpenedAt.current = Date.now();
  }, [menu.open]);
  const mbit = swarmMbit(row.entry);
  const peers = row.entry.probe?.peers ?? 0;
  return (
    <li className="src-item" style={{ '--i': index } as CSSProperties}>
      <button
        type="button"
        className={cx('src-row', 'press', `src-row--${variant}`, row.active && 'is-active')}
        data-state={row.signal.state}
        aria-current={row.active ? 'true' : undefined}
        aria-label={row.description}
        title={variant === 'rack' ? row.description : undefined}
        onClick={() => {
          if (Date.now() - menuOpenedAt.current < 700) return;
          selectSource(row.entry.id);
        }}
        onKeyDown={(event) => focusSibling(event, listRef)}
        {...bind}
      >
        <span className="src-row__num" aria-hidden="true">
          <Num value={row.number} />
        </span>
        <span className="src-row__main" aria-hidden="true">
          <span className="src-row__name">{row.presentation.short}</span>
          <span className="src-row__detail">
            {row.onScreen ? (
              <span className="src-row__here">
                <Icon name="senal" size={16} />
                En pantalla
              </span>
            ) : null}
            <span className="src-row__phrase">{row.detail}</span>
          </span>
        </span>
        <span className="src-row__sig" aria-hidden="true">
          <SignalBadge
            state={row.signal.state}
            label={row.signal.word}
            size="sm"
            layout={variant === 'list' ? 'stacked' : 'inline'}
          />
        </span>
        {variant === 'rack' ? (
          <>
            <span className="src-row__peers" aria-hidden="true">
              {peers > 0 ? <Num value={peers} /> : '—'}
            </span>
            <span className="src-row__mbit" aria-hidden="true">
              {mbit ? <Num value={mbit} /> : '—'}
            </span>
          </>
        ) : null}
      </button>
      <Menu
        open={menu.open}
        anchor={menu.anchor}
        onClose={menu.onClose}
        label={`Fuente ${row.number}`}
        items={rowMenu(row, inMatch)}
      />
    </li>
  );
}

export interface SourceListProps {
  shown: readonly SourceRow[];
  tucked: readonly SourceRow[];
  variant: SourceListVariant;
  inMatch: boolean;
  label: string;
}

export function SourceList({ shown, tucked, variant, inMatch, label }: SourceListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [showTucked, setShowTucked] = useState(false);
  const failedTucked = tucked.filter((row) => row.signal.state === 'fail').length;
  return (
    <div className={cx('src-list', `src-list--${variant}`)} ref={listRef}>
      {variant === 'rack' && shown.length ? (
        <div className="src-rack__head" aria-hidden="true">
          <span>Nº</span>
          <span>Fuente</span>
          <span>Estado</span>
          <span>Pares</span>
          <span>Mbit/s</span>
        </div>
      ) : null}
      {shown.length ? (
        <ol className="src-list__rows stagger" aria-label={label}>
          {shown.map((row, index) => (
            <SourceRowView
              key={row.entry.id}
              row={row}
              variant={variant}
              inMatch={inMatch}
              listRef={listRef}
              index={index}
            />
          ))}
        </ol>
      ) : null}
      {tucked.length ? (
        <>
          <button
            type="button"
            className="src-list__more press"
            aria-expanded={showTucked}
            onClick={() => setShowTucked((open) => !open)}
          >
            <Icon name={showTucked ? 'chev-u' : 'chev-d'} size={18} />
            {showTucked
              ? 'Ocultar las que no dan señal'
              : `Ver ${tucked.length} más${
                  failedTucked === tucked.length
                    ? ' sin señal'
                    : failedTucked
                      ? ` (${failedTucked} sin señal, ${tucked.length - failedTucked} en cola)`
                      : ' en cola'
                }`}
          </button>
          {showTucked ? (
            <ol className="src-list__rows src-list__rows--tucked" aria-label={`${label}: sin señal o en cola`}>
              {tucked.map((row, index) => (
                <SourceRowView
                  key={row.entry.id}
                  row={row}
                  variant={variant}
                  inMatch={inMatch}
                  listRef={listRef}
                  index={index}
                />
              ))}
            </ol>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
