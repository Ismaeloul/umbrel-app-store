/* Canal suelto (iPhone): dorsal, título, la pantalla (deslizar a los lados
   zapea entre favoritos y la lista en uso) y las fuentes hermanas. */

import { motion, type PanInfo } from 'motion/react';
import { useEffect, useState } from 'react';
import { back } from '../../../core/router';
import { getState, isFavorite, itemById, playChannel, setExpanded, toggleFavorite, useSim, zap } from '../../../core/store';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { Video } from '../components/Video';
import { PlayerControls } from '../components/PlayerControls';
import { StatusLineView } from '../components/Toasts';
import { Teletext, type TtPage } from '../components/Teletext';
import { IconKey, Key } from '../components/Key';
import { ChannelNowLine } from '../components/Library';
import { OpenInSheet } from '../components/SourceSheets';
import { IcChevronDown, IcExternal, IcPlay, IcStar } from '../components/icons';
import { displayTitle } from '../components/text';
import { NavBar } from './NavBar';

export function PhoneChannel({ id, now }: { id: string; now: number }) {
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

  const minimize = () => {
    setExpanded(false);
    back('biblioteca');
  };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) minimize();
  };
  const meta = [fav ? 'En tus favoritos' : item ? 'De tu lista' : 'Fuera de tu biblioteca', item?.category].filter(Boolean).join(' · ');

  return (
    <div className="tr-ph-match">
      <NavBar
        title="Canal"
        backLabel="Canales"
        fallback="biblioteca"
        right={
          <>
            <IconKey label={fav ? 'Quitar de favoritos' : 'Guardar en favoritos'} icon={<IcStar filled={fav} />} size={36} variant="ghost" pressed={fav} onClick={() => toggleFavorite(id, title)} />
            {playingHere && <IconKey label="Minimizar" icon={<IcChevronDown />} size={36} variant="ghost" onClick={minimize} />}
          </>
        }
      />
      <motion.div className="tr-ph-hero" drag={playingHere ? 'y' : false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.4 }} onDragEnd={playingHere ? onDragEnd : undefined}>
        <div className="tr-chhead">
          <ChannelMark name={title} size={48} radius={10} />
          <div className="tr-chhead-text">
            <h1>{title}</h1>
            <span className="tr-chhead-meta">{meta}</span>
            {item && <ChannelNowLine item={item} agenda={agenda} now={now} watchingId={watchingId} revealed={revealed} />}
          </div>
          <IconKey label="Abrir en…" icon={<IcExternal />} size={40} onClick={() => setOpenIn(true)} />
        </div>
        {playingHere ? (
          <Video now={now} onSwipe={(dir) => zap(dir)} />
        ) : (
          <div className="tr-idle">
            <strong>Ahora suena otra cosa</strong>
            <Key variant="orange" icon={<IcPlay size={16} />} onClick={() => playChannel(id)}>
              Ver este canal
            </Key>
          </div>
        )}
      </motion.div>
      <div className="tr-ph-body">
        {playingHere && (
          <>
            <StatusLineView line={statusLine} fallback="Desliza el vídeo a los lados para zapear." />
            <PlayerControls phone compact />
          </>
        )}
        <Teletext kind="channel" id={id} now={now} mode="phone" pages={['fuentes', 'tecnico']} page={page} onPage={setPage} watchingId={watchingId} revealed={revealed} />
      </div>
      <OpenInSheet open={openIn} onClose={() => setOpenIn(false)} mode="phone" />
    </div>
  );
}
