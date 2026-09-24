/* Consola · lista de fuentes (web): filas de 32 px con punto de estado,
   proveedor, palabra del producto y tecla 1–9. La activa lleva «En pantalla». */

import { useState } from 'react';
import { markCorrect, research, selectSource, useNow, useSim, type SourceSession } from '../../../core/store';
import type { Source } from '../../../core/types';
import { Icon } from '../components/icons';
import { Button, Dot, IconButton, Keys, Menu, useMenu } from '../components/ui';
import { openInItems } from '../components/sheets';
import { sessionSummary, sourceLabel } from '../components/lib';
import { openSheet } from './state';

export function SourceRow({ src, index, kind, id, active, keyIndex, onMenu, showKeys, dense = false }: { src: Source; index: number; kind: 'match' | 'channel'; id: string; active: boolean; keyIndex: number | null; onMenu: (e: React.MouseEvent, src: Source) => void; showKeys: boolean; dense?: boolean }) {
  const nowMs = useNow();
  const behind = useSim((s) => s.player.behindS);
  const bufferS = useSim((s) => s.player.bufferS);
  const conn = useSim((s) => s.player.conn);
  const lab = sourceLabel(src, nowMs);
  const activeText = conn === 'activa' ? (behind >= 1.25 ? `En pantalla · −${Math.round(behind)} s` : `En pantalla · ${bufferS} s de colchón`) : conn === 'reconectando' ? 'Reconectando…' : conn === 'error' ? 'Sin señal' : 'Conectando…';
  return (
    <div className={`co-src ${active ? 'is-active' : ''} ${src.state === 'failed' ? 'is-failed' : ''}`} onContextMenu={(e) => onMenu(e, src)}>
      <button type="button" className="co-src-main" onClick={() => selectSource(kind, id, src.id)} title={`${src.title} · ${src.peers} pares · ${(src.speedDown / 125).toFixed(1).replace('.', ',')} Mbit/s`}>
        <span className="co-src-n co-mono">{index}</span>
        <Dot tone={active && conn === 'activa' ? 'ok' : lab.tone} />
        <span className="co-src-title co-truncate">
          {src.title}
          <span className="co-src-list"> · {src.listaName ?? 'Índice'}</span>
        </span>
        <span className={`co-src-state ${active ? 'co-mono is-active' : ''}`} title={lab.detail ? `${lab.word} · ${lab.detail}` : lab.word}>
          {active ? (
            <>
              <Icon name="play" size={10} style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 4 }} />
              {activeText}
            </>
          ) : (
            <>
              {lab.word}
              {lab.detail && !dense && <span className="co-src-detail"> · {lab.detail}</span>}
            </>
          )}
        </span>
        {showKeys && keyIndex !== null && keyIndex <= 9 && <Keys keys={String(keyIndex)} className="co-src-key" />}
      </button>
      <IconButton icon="more" label="Más opciones de la fuente" onClick={(e) => onMenu(e, src)} className="co-src-more" />
    </div>
  );
}

export function SourcesList({ session, kind, id, showKeys = true, dense = false, limit }: { session: SourceSession; kind: 'match' | 'channel'; id: string; showKeys?: boolean; dense?: boolean; limit?: number }) {
  const activeId = useSim((s) => (s.player.target?.kind === kind && s.player.target.id === id ? s.player.target.sourceId : null));
  const menu = useMenu();
  const [menuSrc, setMenuSrc] = useState<Source | null>(null);
  const [showAll, setShowAll] = useState(false);
  const playable = session.sources.filter((x) => x.state !== 'failed');
  const failed = session.sources.filter((x) => x.state === 'failed');
  const ordered = [...playable, ...failed];
  const cut = limit && !showAll ? ordered.slice(0, limit) : ordered;
  const hidden = ordered.length - cut.length;
  const onMenu = (e: React.MouseEvent, src: Source) => {
    setMenuSrc(src);
    if (e.type === 'contextmenu') menu.openPointer(e);
    else menu.openAt(e, 'right');
  };
  return (
    <div className={`co-srclist ${dense ? 'is-dense' : ''}`} role="list">
      {cut.map((src) => (
        <SourceRow key={src.id} src={src} index={session.sources.indexOf(src) + 1} kind={kind} id={id} active={src.id === activeId} keyIndex={playable.indexOf(src) >= 0 ? playable.indexOf(src) + 1 : null} onMenu={onMenu} showKeys={showKeys} dense={dense} />
      ))}
      {hidden > 0 && (
        <button type="button" className="co-src-more-btn" onClick={() => setShowAll(true)}>
          Ver {hidden} más{failed.length ? ` (${Math.min(hidden, failed.length)} sin señal)` : ''}
        </button>
      )}
      {menu.state && menuSrc && (
        <Menu
          at={menu.state}
          align={menu.state.align}
          onClose={menu.close}
          items={[
            { id: 'play', label: 'Ver esta fuente', icon: 'play', run: () => selectSource(kind, id, menuSrc.id) },
            { id: 'correct', label: 'Es el canal correcto', icon: 'check', run: () => markCorrect(kind, id, menuSrc.id, true) },
            { id: 'incorrect', label: 'No es este canal', icon: 'x', run: () => markCorrect(kind, id, menuSrc.id, false) },
            { id: 'report', label: 'Reportar…', icon: 'flag', run: () => openSheet({ type: 'report', kind, id, sourceId: menuSrc.id }) },
            { id: 'sep1', label: '', sep: true },
            ...openInItems(menuSrc),
          ]}
        />
      )}
    </div>
  );
}

export function SourcesHeader({ session, kind, id, compact = false }: { session: SourceSession; kind: 'match' | 'channel'; id: string; compact?: boolean }) {
  const n = session.sources.length;
  const sum = sessionSummary(session);
  return (
    <div className="co-sources-head">
      <span className="co-h2">Fuentes</span>
      <span className="co-label">{n}</span>
      <span className="co-label co-truncate co-row-flex" style={{ gap: 5 }}>
        <Dot tone={sum.tone} size="sm" /> {sum.text}
      </span>
      <span className="co-grow" />
      {session.automatic ? <span className="co-chip">Automático</span> : <span className="co-chip">Manual</span>}
      {!compact ? (
        <Button size="sm" icon="refresh" onClick={() => research(kind, id)} disabled={session.research}>
          Rebuscar
        </Button>
      ) : (
        <IconButton icon="refresh" label="Rebuscar" onClick={() => research(kind, id)} disabled={session.research} />
      )}
    </div>
  );
}
