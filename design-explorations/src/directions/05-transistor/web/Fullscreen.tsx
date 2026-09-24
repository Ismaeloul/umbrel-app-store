/* Pantalla completa (web): fondo negro, la imagen al máximo y las teclas
   sobre el vídeo. Esc o F salen. */

import { matchById, setFullscreen, useSim } from '../../../core/store';
import { Video } from '../components/Video';
import { PlayerControls } from '../components/PlayerControls';
import { LcdScore } from '../components/Lcd';
import { Key } from '../components/Key';
import { IcShrink } from '../components/icons';
import { displayTitle, phaseWord } from '../components/text';
import { scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';

export function Fullscreen({ now }: { now: number }) {
  const player = useSim((s) => s.player);
  const revealed = useSim((s) => s.scoreRevealed);
  const t = player.target;
  if (!t) return null;
  const match = t.kind === 'match' ? matchById(t.id) : undefined;
  const s = match ? scoreAt(match, now) : null;
  const title = match ? `${team(match.home).name} – ${team(match.away).name}` : displayTitle(t.id, t.title);
  return (
    <div className="tr-fs" role="dialog" aria-label="Pantalla completa">
      <div className="tr-fs-top">
        <div className="tr-fs-title">
          <strong>{title}</strong>
          <span>{phaseWord(player)}</span>
        </div>
        {match && s && s.state !== 'pre' && (
          <span className="tr-fs-lcd tr-lcd-panel">
            <LcdScore home={s.home} away={s.away} hidden={!revealed[match.id]} height={28} />
          </span>
        )}
        <Key variant="ink" size="sm" icon={<IcShrink size={16} />} onClick={() => setFullscreen(false)}>
          Salir · Esc
        </Key>
      </div>
      <div className="tr-fs-video">
        <Video match={match} now={now} revealed={match ? !!revealed[match.id] : false} frameless overlay={<PlayerControls onVideo />} />
      </div>
    </div>
  );
}
