/* Canal suelto (web): dorsal, título, la pantalla y sus fuentes hermanas.
   Desde la biblioteca nunca hay salto automático de fuente. */

import { useEffect, useState } from 'react';
import { back } from '../../../core/router';
import { getState, isFavorite, itemById, playChannel, toggleFavorite, useSim } from '../../../core/store';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { Video } from '../components/Video';
import { PlayerControls } from '../components/PlayerControls';
import { StatusLineView } from '../components/Toasts';
import { Teletext, type TtPage } from '../components/Teletext';
import { IconKey, Key } from '../components/Key';
import { ChannelNowLine } from '../components/Library';
import { OpenInSheet } from '../components/SourceSheets';
import { IcChevronLeft, IcExternal, IcPlay, IcStar } from '../components/icons';
import { displayTitle } from '../components/text';

export function WebChannel({ id, now }: { id: string; now: number }) {
  const item = itemById(id);
  const favorites = useSim((s) => s.favorites);
  const agenda = useSim((s) => s.agenda);
  const targetKey = useSim((s) => (s.player.target ? `${s.player.target.kind}:${s.player.target.id}` : null));
  const targetTitle = useSim((s) => s.player.target?.title ?? '');
  const statusLine = useSim((s) => s.statusLine);
  const watchingId = useSim((s) => (s.player.target?.kind === 'match' ? s.player.target.id : null));
  const revealed = useSim((s) => s.scoreRevealed);
  const [page, setPage] = useState<TtPage>('fuentes');
  const [openIn, setOpenIn] = useState(false);
  const playingHere = targetKey === `channel:${id}`;
  const fav = favorites.some((f) => f.id === id) || isFavorite(id);
  const title = item?.title ?? displayTitle(id, playingHere ? targetTitle : `Canal ${id.slice(0, 8)}`);

  useEffect(() => {
    const p = getState().player;
    if (!(p.target?.kind === 'channel' && p.target.id === id)) playChannel(id);
  }, [id]);

  const meta = [fav ? 'En tus favoritos' : item?.listaId ? `De tu lista ${item.listaId === 'nueva-era' ? 'Nueva Era' : item.listaId === 'elcano' ? 'Elcano' : 'Principal'}` : 'Fuera de tu biblioteca', item?.category].filter(Boolean).join(' · ');

  return (
    <div className="tr-match">
      <div className="tr-match-bar">
        <Key variant="ghost" size="sm" icon={<IcChevronLeft size={16} />} onClick={() => back('biblioteca')}>
          Canales
        </Key>
        <span className="tr-match-bar-title">Canal</span>
      </div>
      <div className="tr-match-grid">
        <div className="tr-match-main">
          <div className="tr-chhead">
            <ChannelMark name={title} size={56} radius={12} />
            <div className="tr-chhead-text">
              <h1>{title}</h1>
              <span className="tr-chhead-meta">{meta}</span>
              {item && <ChannelNowLine item={item} agenda={agenda} now={now} watchingId={watchingId} revealed={revealed} />}
            </div>
            <div className="tr-chhead-keys">
              <IconKey label={fav ? 'Quitar de favoritos' : 'Guardar en favoritos'} icon={<IcStar filled={fav} />} pressed={fav} onClick={() => toggleFavorite(id, title)} />
              <IconKey label="Abrir en…" icon={<IcExternal />} onClick={() => setOpenIn(true)} />
            </div>
          </div>
          {playingHere ? (
            <>
              <Video now={now} />
              <StatusLineView line={statusLine} fallback="" />
              <PlayerControls />
            </>
          ) : (
            <div className="tr-idle">
              <strong>Ahora suena otra cosa</strong>
              <span>Puedes pasar a este canal cuando quieras.</span>
              <Key variant="orange" size="lg" icon={<IcPlay size={18} />} onClick={() => playChannel(id)}>
                Ver este canal
              </Key>
            </div>
          )}
        </div>
        <Teletext kind="channel" id={id} now={now} mode="web" pages={['fuentes', 'tecnico']} page={page} onPage={setPage} watchingId={watchingId} revealed={revealed} className="tr-match-tt" />
      </div>
      <OpenInSheet open={openIn} onClose={() => setOpenIn(false)} mode="web" />
    </div>
  );
}
