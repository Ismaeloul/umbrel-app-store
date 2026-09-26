/* Inspector de la fuente activa (inventario §7.4): una cápsula con las
   acciones de la fuente que está en pantalla.

   - Favorito / En favoritos (el mismo flujo que la biblioteca: hoja con el
     nombre al añadir y deshacer al quitar, §13.4).
   - Rebuscar / Rebuscando… (solo en un partido, §7.6).
   - Pegar hash (§7.5): sin fuente activa dentro de un partido es lo ÚNICO
     que queda, justo para cuando no aparece ninguna señal (regla 26).
   - Copiar hash.
   - Es el canal correcto / ✓ Canal aprendido (solo en un partido, §7.8).
   - Reportar (§7.7).
   - «Abrir en…» (D7): la app de AceStream con `acestream://` y copiar la
     URL del stream para VLC.
   - Con una IPTV en pantalla (docs/iptv.md §8.1) solo quedan «Rebuscar»,
     «Pegar hash», «Es el canal correcto» y «Reportar»: un id IPTV no es un
     hash de AceStream que copiar o abrir fuera, ni se guarda en Favoritos
     (el favorito es el canal de AceStream, que ya trae la IPTV primero).

   Es un componente de React normal: si ni la fuente ni las acciones
   cambian, el DOM no se toca y la fila no vuelve al principio al
   desplazarla en el móvil (index.html:3897-3903). */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../../lib/cx.ts';
import { externalStreamUrl } from '../../player/clipboard.ts';
import { Button, Menu, type MenuItem } from '../../ui/index.ts';
import {
  copyAcestreamLink,
  copyHash,
  copyStreamUrl,
  openInAceStream,
} from '../library/clipboard.ts';
import { useChannelActions } from '../library/useChannelActions.tsx';
import { confirmSource, openPaste, openReport, research } from './session.ts';

export interface InspectorTarget {
  hash: string;
  title: string;
  ih: boolean;
  learned: boolean;
  /** Es una fuente de la IPTV. */
  iptv?: boolean;
}

export interface SourceInspectorProps {
  /** La fuente en pantalla; null si no hay ninguna. */
  target: InspectorTarget | null;
  inMatch: boolean;
  researching: boolean;
  layout: 'row' | 'grid';
  className?: string;
}

/** «Abrir en…» (D7) con el mismo dibujo que las demás acciones de la cápsula. */
function OpenElsewhere({ hash, ih }: { hash: string; ih: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const items: MenuItem[] = [
    {
      id: 'app',
      label: 'Abrir en la app de AceStream',
      icon: 'externo',
      onSelect: () => openInAceStream(hash),
    },
    {
      id: 'vlc',
      label: 'Copiar URL del stream (VLC)',
      icon: 'link',
      onSelect: () => void copyStreamUrl(externalStreamUrl(hash, ih ? 'infohash' : 'auto')),
    },
    {
      id: 'enlace',
      label: 'Copiar enlace acestream://',
      icon: 'copy',
      onSelect: () => void copyAcestreamLink(hash),
    },
  ];
  return (
    <>
      <Button
        size="sm"
        icon="externo"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor((current) => (current ? null : event.currentTarget))}
      >
        Abrir en…
      </Button>
      <Menu
        open={anchor !== null}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        label="Abrir en otra app"
        items={items}
      />
    </>
  );
}

/**
 * En el móvil la fila se desliza: un fundido en el borde por el que quedan
 * acciones dice que hay más (y desaparece al llegar al final).
 */
function useScrollEdge(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<'none' | 'start' | 'middle' | 'end'>('none');
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdge(
      max <= 1
        ? 'none'
        : el.scrollLeft >= max - 1
          ? 'end'
          : el.scrollLeft <= 1
            ? 'start'
            : 'middle',
    );
  }, [enabled]);
  useLayoutEffect(() => {
    measure();
    const el = ref.current;
    if (!el || !enabled || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, enabled]);
  return { ref, edge, onScroll: measure };
}

export function SourceInspector({
  target,
  inMatch,
  researching,
  layout,
  className,
}: SourceInspectorProps) {
  const actions = useChannelActions();
  const scroll = useScrollEdge(layout === 'row');
  if (!target) {
    if (!inMatch) return null;
    return (
      <div
        className={cx('src-inspector', 'src-inspector--solo', className)}
        role="group"
        aria-label="Acciones de la fuente"
      >
        <Button size="sm" icon="paste" onClick={() => openPaste(true)}>
          Pegar hash
        </Button>
      </div>
    );
  }
  const isFavorite = actions.favoriteIds.has(target.hash);
  const iptv = target.iptv === true;
  return (
    <div
      ref={scroll.ref}
      className={cx('src-inspector', `src-inspector--${layout}`, className)}
      role="group"
      aria-label="Acciones de la fuente"
      data-edge={layout === 'row' ? scroll.edge : undefined}
      onScroll={layout === 'row' ? scroll.onScroll : undefined}
    >
      {iptv ? null : (
        <Button
          size="sm"
          icon={isFavorite ? 'star-f' : 'star'}
          pressed={isFavorite}
          className={cx(isFavorite && 'is-on')}
          onClick={() =>
            actions.toggleFavorite({
              id: target.hash,
              title: target.title,
              category: 'Fútbol',
              ih: target.ih,
            })
          }
        >
          {isFavorite ? 'En favoritos' : 'Favorito'}
        </Button>
      )}
      {inMatch ? (
        <Button
          size="sm"
          icon="refresh"
          busy={researching}
          className="src-inspector__research"
          onClick={() => void research()}
        >
          {researching ? 'Rebuscando…' : 'Rebuscar'}
        </Button>
      ) : null}
      <Button size="sm" icon="paste" onClick={() => openPaste(true)}>
        Pegar hash
      </Button>
      {iptv ? null : (
        <Button size="sm" icon="copy" onClick={() => void copyHash(target.hash)}>
          Copiar hash
        </Button>
      )}
      {inMatch ? (
        <Button
          size="sm"
          icon={target.learned ? 'check' : 'learn'}
          pressed={target.learned}
          disabled={target.learned}
          onClick={() => void confirmSource(target.hash)}
        >
          {target.learned ? '✓ Canal aprendido' : 'Es el canal correcto'}
        </Button>
      ) : null}
      <Button size="sm" icon="flag" onClick={() => openReport(target.hash)}>
        Reportar
      </Button>
      {iptv ? null : <OpenElsewhere hash={target.hash} ih={target.ih} />}
      {actions.sheets}
    </div>
  );
}
