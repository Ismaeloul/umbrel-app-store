/* Cartel de fuente (plan Palco fase 2, decisión W6; corrección 2 del brief):
   sustituye a la fila del selector. Una tesela 16:9 con la sigla y el dorsal
   del canal sobre su tono (NUNCA una miniatura de vídeo: el <video> es uno y
   vive en el reproductor), el número de fuente arriba a la derecha y «En
   pantalla» en oro abajo a la izquierda cuando es la que suena. Alrededor de
   la tesela, un filo con el color y el trazo del estado (oro en la que
   suena); debajo, el proveedor, el anillo de estado con su palabra
   (SignalRing: Verificada · Floja · Comprobando · Pendiente · Sin señal ·
   Reportada), la calidad («1080p», «720p», «SD», «HEVC») y el tipo, y la
   frase humana. Estado siempre con forma + palabra + color.

   Conserva lo que usan las e2e y los tests: un <button> por fuente con el
   aria-label largo de describeSource («Fuente N: … · Hash <hash> · …»),
   aria-current y data-state, el menú contextual (clic derecho o pulsación
   larga) con los mismos elementos que la fila de antes, y las flechas para
   moverse entre carteles (Intro o Espacio eligen). Al elegir, un toque
   háptico rígido (HAPTIC_MAP). */

import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { acestreamLink, copyText, openExternal } from '../../player/clipboard.ts';
import { notify } from '../../notices/index.ts';
import {
  Capsule,
  ChannelMark,
  Menu,
  Num,
  SignalRing,
  useContextMenu,
  type MenuItem,
  type SignalRingState,
} from '../../ui/index.ts';
import { channelNameOf, qualityLabel } from './model.ts';
import { confirmSource, openReport, selectSource } from './session.ts';
import type { SourceRow } from './useSources.ts';

/** Los mismos elementos del menú que tenía la fila (inventario §7.1). */
export function rowMenu(row: SourceRow, inMatch: boolean): MenuItem[] {
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
          notify(ok ? 'Hash copiado' : 'No se pudo copiar el hash', {
            tone: ok ? 'ok' : 'err',
            icon: 'copy',
          }),
        ),
    },
    {
      id: 'abrir',
      label: 'Abrir en la app de AceStream',
      icon: 'externo',
      onSelect: () => openExternal(acestreamLink(row.entry.id)),
    },
  ];
  const canLearn = inMatch && row.active && row.entry.learned !== 'correct';
  if (canLearn)
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
    separated: !canLearn,
    onSelect: () => openReport(row.entry.id),
  });
  return items;
}

/** Estado del anillo: el del medidor, salvo la reportada, que tiene dibujo propio. */
export function ringStateOf(row: Pick<SourceRow, 'effective' | 'signal'>): SignalRingState {
  return row.effective.reported ? 'reported' : row.signal.state;
}

export interface SourcePosterProps {
  row: SourceRow;
  inMatch: boolean;
  /** Posición para la entrada escalonada. */
  index: number;
  onArrow(event: KeyboardEvent<HTMLButtonElement>): void;
}

export function SourcePoster({ row, inMatch, index, onArrow }: SourcePosterProps) {
  const { bind, menu } = useContextMenu();
  // La pulsación larga abre el menú; el «clic» que llega al soltar el dedo
  // justo después no debe elegir la fuente.
  const menuOpenedAt = useRef(0);
  useEffect(() => {
    if (menu.open) menuOpenedAt.current = Date.now();
  }, [menu.open]);
  const ring = ringStateOf(row);
  const quality = qualityLabel(row.entry);
  const type = row.presentation.type !== row.presentation.short ? row.presentation.type : null;
  const extras = [quality, type].filter(Boolean).join(' · ');
  return (
    <li className="src-item" style={{ '--i': index } as CSSProperties}>
      <button
        type="button"
        className={cx(
          'src-poster',
          'press',
          row.active && 'is-active',
          row.onScreen && 'is-onscreen',
        )}
        data-state={ring}
        aria-current={row.active ? 'true' : undefined}
        aria-label={row.description}
        title={row.description}
        onClick={() => {
          if (Date.now() - menuOpenedAt.current < 700) return;
          haptic('rigid');
          selectSource(row.entry.id);
        }}
        onKeyDown={onArrow}
        {...bind}
      >
        <span className="src-poster__tile" aria-hidden="true">
          <ChannelMark
            name={channelNameOf(row.entry)}
            shape="tile"
            size={90}
            className="src-poster__mark"
          />
          <span className="src-poster__num">
            <Num value={row.number} />
          </span>
          {row.onScreen ? (
            <Capsule tone="gold" size="sm" icon="senal" className="src-poster__onair">
              En pantalla
            </Capsule>
          ) : null}
        </span>
        <span className="src-poster__body" aria-hidden="true">
          <span className="src-poster__name">{row.presentation.short}</span>
          <span className="src-poster__meta">
            <SignalRing
              state={ring}
              word={row.signal.word}
              active={row.onScreen}
              size={14}
              className="src-poster__ring"
            />
            {extras ? <span className="src-poster__extra">· {extras}</span> : null}
          </span>
          <span className="src-poster__detail">{row.detail}</span>
        </span>
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
