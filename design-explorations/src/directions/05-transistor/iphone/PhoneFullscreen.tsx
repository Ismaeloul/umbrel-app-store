/* Pantalla completa (iPhone): fondo negro, vídeo centrado y teclas sobre
   la imagen. En SwiftUI sería el reproductor en horizontal. */

import { matchById, setFullscreen, useSim } from '../../../core/store';
import { Video } from '../components/Video';
import { PlayerControls } from '../components/PlayerControls';
import { Key } from '../components/Key';
import { IcShrink } from '../components/icons';
import { displayTitle } from '../components/text';
import { team } from '../../../core/data/teams';

export function PhoneFullscreen({ now }: { now: number }) {
  const player = useSim((s) => s.player);
  const revealed = useSim((s) => s.scoreRevealed);
  const t = player.target;
  if (!t) return null;
  const match = t.kind === 'match' ? matchById(t.id) : undefined;
  const title = match ? `${team(match.home).name} – ${team(match.away).name}` : displayTitle(t.id, t.title);
  return (
    <div className="tr-ph-fs" role="dialog" aria-label="Pantalla completa">
      <div className="tr-ph-fs-top">
        <strong>{title}</strong>
        <Key variant="ink" size="sm" icon={<IcShrink size={16} />} onClick={() => setFullscreen(false)}>
          Salir
        </Key>
      </div>
      <div className="tr-ph-fs-video">
        <Video match={match} now={now} revealed={match ? !!revealed[match.id] : false} frameless />
      </div>
      <PlayerControls phone compact onVideo className="tr-ph-fs-controls" />
    </div>
  );
}
