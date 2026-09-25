/* Canales (web): presintonías, «Emitiendo ahora» y las tres pestañas. */

import { useMemo, useState } from 'react';
import { navigate } from '../../../core/router';
import { channelsOf, playChannel, useSim } from '../../../core/store';
import type { Item } from '../../../core/types';
import { Key, Segmented, SectionTitle } from '../components/Key';
import { Category, ChannelRow, DirectoryBar, EmittingNow, LibraryEmpty, Presets, groupByCategory, groupRecents, useChannelMenu, type LibTab } from '../components/Library';
import { PasteSheet } from '../components/SourceSheets';
import { IcPaste } from '../components/icons';
import { rememberTitle } from '../components/text';

export function WebLibrary({ tab, now }: { tab: string | null; now: number }) {
  const favorites = useSim((s) => s.favorites);
  const history = useSim((s) => s.history);
  const agenda = useSim((s) => s.agenda);
  const activeDir = useSim((s) => s.activeDirectoryId);
  const dirs = useSim((s) => s.directories);
  const playingId = useSim((s) => (s.player.target?.kind === 'channel' ? s.player.target.id : null));
  const [dirId, setDirId] = useState(activeDir);
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [paste, setPaste] = useState(false);

  const defaultTab: LibTab = favorites.length ? 'favoritos' : history.length ? 'recientes' : 'listas';
  const current: LibTab = tab === 'favoritos' || tab === 'recientes' || tab === 'listas' ? tab : defaultTab;
  const setTab = (t: LibTab) => navigate('biblioteca', t, null, { replace: true });

  const open = (item: Item) => {
    playChannel(item.id);
    navigate('canal', item.id);
  };
  const menu = useChannelMenu('web', { onOpen: open, recents: current === 'recientes' });
  const dirItems = useMemo(() => channelsOf(dirs.some((d) => d.id === dirId) ? dirId : activeDir), [dirId, activeDir, dirs]);
  const cats = useMemo(() => groupByCategory(dirItems), [dirItems]);
  const recents = useMemo(() => groupRecents(history, now), [history, Math.floor(now / 60_000)]);

  return (
    <div className="tr-lib">
      <div className="tr-lib-head">
        <h1>Canales</h1>
        <Segmented<LibTab>
          value={current}
          onChange={setTab}
          label="Sección"
          options={[
            { id: 'favoritos', label: 'Favoritos', count: favorites.length },
            { id: 'recientes', label: 'Recientes', count: history.length },
            { id: 'listas', label: 'Listas', count: dirs.length },
          ]}
        />
        <Key icon={<IcPaste size={18} />} onClick={() => setPaste(true)}>
          Pegar Content ID
        </Key>
      </div>

      {favorites.length > 0 && (
        <section className="tr-lib-sect">
          <SectionTitle aside="Tus favoritos, numerados">Presintonías</SectionTitle>
          <Presets items={favorites} onOpen={open} playingId={playingId} />
        </section>
      )}

      <EmittingBlock agenda={agenda} now={now} onOpen={open} />

      <section className="tr-lib-sect">
        {current === 'favoritos' &&
          (favorites.length ? (
            <div className="tr-list tr-list--wide">
              {favorites.map((it, i) => (
                <ChannelRow key={it.id} item={it} agenda={agenda} now={now} onOpen={open} onMenu={menu.openMenu} playing={playingId === it.id} preset={i < 8 ? i + 1 : undefined} />
              ))}
            </div>
          ) : (
            <LibraryEmpty tab="favoritos" onLists={() => setTab('listas')} onSearch={() => navigate('buscar')} onAddList={() => navigate('ajustes', 'listas')} />
          ))}
        {current === 'recientes' &&
          (history.length ? (
            <div className="tr-list">
              {recents.map((g) => (
                <div key={g.label}>
                  <div className="tr-group-label">{g.label}</div>
                  <div className="tr-list tr-list--wide">
                    {g.items.map((it) => (
                      <ChannelRow key={it.id} item={it} agenda={agenda} now={now} onOpen={open} onMenu={menu.openMenu} playing={playingId === it.id} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <LibraryEmpty tab="recientes" onLists={() => setTab('listas')} onSearch={() => navigate('buscar')} onAddList={() => navigate('ajustes', 'listas')} />
          ))}
        {current === 'listas' &&
          (dirs.length ? (
            <>
              <DirectoryBar dirId={dirs.some((d) => d.id === dirId) ? dirId : activeDir} onChange={setDirId} onManage={() => navigate('ajustes', 'listas')} />
              <div className="tr-cats">
                {cats.map((c, i) => {
                  const isOpen = openCats[c.label] ?? i === 0;
                  return (
                    <Category key={c.label} label={c.label} count={c.items.length} open={isOpen} onToggle={() => setOpenCats((o) => ({ ...o, [c.label]: !isOpen }))}>
                      <div className="tr-list tr-list--grid">
                        {c.items.map((it) => (
                          <ChannelRow key={it.id} item={it} agenda={agenda} now={now} onOpen={open} onMenu={menu.openMenu} playing={playingId === it.id} compact />
                        ))}
                      </div>
                    </Category>
                  );
                })}
              </div>
            </>
          ) : (
            <LibraryEmpty tab="listas" onLists={() => setTab('listas')} onSearch={() => navigate('buscar')} onAddList={() => navigate('ajustes', 'listas')} />
          ))}
      </section>
      {menu.node}
      <PasteSheet
        open={paste}
        onClose={() => setPaste(false)}
        kind="channel"
        id=""
        mode="web"
        onPlay={(hash) => {
          rememberTitle(hash, 'Enlace pegado');
          playChannel(hash);
          navigate('canal', hash);
        }}
      />
    </div>
  );
}

function EmittingBlock({ agenda, now, onOpen }: { agenda: Parameters<typeof EmittingNow>[0]['agenda']; now: number; onOpen: (item: Item) => void }) {
  return (
    <section className="tr-lib-sect tr-lib-emitting">
      <SectionTitle aside="Canales tuyos con partido en juego">Emitiendo ahora</SectionTitle>
      <EmittingNow agenda={agenda} now={now} onOpen={onOpen} horizontal />
    </section>
  );
}
