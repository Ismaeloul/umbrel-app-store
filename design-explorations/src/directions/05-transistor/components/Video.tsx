/* La pantalla del receptor: el vídeo falso con marco de tinta y las
   superposiciones de estado (sintonizando, reconectando n/3, sin señal,
   en otro dispositivo). Los controles son teclas físicas debajo (o encima
   en pantalla completa). */

import { motion, type PanInfo } from 'motion/react';
import type { ReactNode } from 'react';
import { connect, togglePlay, useSim } from '../../../core/store';
import { useSourceSession } from './hooks';
import type { Match } from '../../../core/types';
import { FakeVideo } from '../../../core/video/FakeVideo';
import { team } from '../../../core/data/teams';
import { scoreAt } from '../../../core/score';
import { Wave } from './Wave';
import { Key } from './Key';
import { IcPlay, IcPhone } from './icons';
import { displayTitle, playerErrorText, sourcesSummary } from './text';

export interface VideoProps {
  match?: Match | null;
  now: number;
  revealed?: boolean;
  /** Deslizar a los lados (iPhone). */
  onSwipe?: (dir: 1 | -1) => void;
  /** Tocar el vídeo. */
  onTap?: () => void;
  radius?: number;
  className?: string;
  overlay?: ReactNode;
  /** Sin marco de receptor (pantalla completa). */
  frameless?: boolean;
}

export function Video({ match, now, revealed = false, onSwipe, onTap, radius = 8, className, overlay, frameless }: VideoProps) {
  const player = useSim((s) => s.player);
  const engine = useSim((s) => s.engine.status);
  const target = player.target;
  const session = useSourceSession(target?.kind ?? 'match', target?.id ?? null);
  const source = session?.sources.find((x) => x.id === target?.sourceId);
  const playing = player.conn === 'activa' && player.media === 'playing';
  const quality: 'ok' | 'weak' | 'frozen' = player.conn === 'reconectando' || (player.conn === 'activa' && player.media === 'buffering') ? 'frozen' : source?.state === 'weak' ? 'weak' : 'ok';
  const s = match ? scoreAt(match, now) : null;
  const score = match && s && s.state !== 'pre' && revealed ? `${s.home}–${s.away}` : undefined;
  const channelLabel = source?.matchedChannel ?? (target ? displayTitle(target.id, target.title) : undefined);

  const loading = player.conn === 'pidiendo' || player.conn === 'conectando' || player.conn === 'precarga' || player.conn === 'arrancando' || (player.conn === 'activa' && player.media === 'buffering');
  const reconnecting = player.conn === 'reconectando';
  const error = player.conn === 'error';
  const handoff = player.conn === 'idle' && !!player.handoff;
  /* El comprobador busca la primera señal: hay objetivo pero aún no hay conexión. */
  const searching = player.conn === 'idle' && !!target && !player.handoff;
  const paused = player.conn === 'activa' && player.media === 'paused';
  const seeking = player.conn === 'activa' && player.media === 'seeking';

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (!onSwipe) return;
    if (info.offset.x < -70 || info.velocity.x < -500) onSwipe(1);
    else if (info.offset.x > 70 || info.velocity.x > 500) onSwipe(-1);
  };

  const retry = () => {
    if (player.conn === 'error') togglePlay();
  };
  const playHere = () => {
    if (target?.sourceId) connect(target.sourceId, 'manual');
  };

  return (
    <motion.div
      className={`tr-video${frameless ? ' is-frameless' : ''}${className ? ` ${className}` : ''}`}
      style={{ borderRadius: frameless ? 0 : radius }}
      drag={onSwipe ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.12}
      onDragEnd={onSwipe ? onDragEnd : undefined}
      onTap={onTap}
    >
      <FakeVideo
        playing={playing || seeking}
        quality={quality}
        home={match ? team(match.home).primary : '#d8d8d8'}
        away={match ? team(match.away).primary : '#2b5ee8'}
        channel={channelLabel}
        score={score}
        kind={match ? 'broadcast' : 'studio'}
      />
      {player.sharedWith.length > 0 && (
        <span className="tr-video-shared">
          <IcPhone size={14} /> También lo ve {player.sharedWith.join(', ')}
        </span>
      )}
      {searching && (
        <div className="tr-video-overlay">
          <Wave size={18} strong />
          <strong>Buscando señal…</strong>
          <span>{session ? sourcesSummary(session) : 'Reuniendo fuentes'}</span>
        </div>
      )}
      {loading && (
        <div className="tr-video-overlay">
          <Wave size={18} strong />
          <strong>{player.conn === 'precarga' || player.conn === 'arrancando' || player.media === 'buffering' ? 'Cargando los primeros segundos…' : 'Sintonizando…'}</strong>
          {source && <span>{source.title}</span>}
        </div>
      )}
      {reconnecting && (
        <div className="tr-video-overlay">
          <Wave size={18} strong />
          <strong>Reconectando {player.reconnects}/3</strong>
          <span>La señal se ha cortado</span>
        </div>
      )}
      {error && (
        <div className="tr-video-overlay is-error">
          <strong>Sin señal</strong>
          <span>{playerErrorText(player, engine !== 'online')}</span>
          {engine === 'online' && (
            <Key variant="orange" size="sm" onClick={retry}>
              Reintentar
            </Key>
          )}
        </div>
      )}
      {handoff && player.handoff && (
        <div className="tr-video-overlay">
          <IcPhone size={22} />
          <strong>En otro dispositivo</strong>
          <span>«{player.handoff.byDevice}» se ha quedado el mando con {player.handoff.title}</span>
          <Key variant="orange" size="sm" onClick={playHere}>
            Reproducir aquí
          </Key>
        </div>
      )}
      {paused && !overlay && (
        <div className="tr-video-overlay is-quiet" aria-hidden="true">
          <span className="tr-video-pausebadge">
            <IcPlay size={22} />
          </span>
        </div>
      )}
      {overlay}
    </motion.div>
  );
}
