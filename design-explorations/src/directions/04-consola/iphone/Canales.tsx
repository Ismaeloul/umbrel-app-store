/* Consola · iPhone · Canales (Favoritos / Recientes / Listas por directorio y
   categoría, «Emitiendo ahora») y Canal (hoja de propiedades con fuentes hermanas). */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { navigate } from '../../../core/router';
import { activateDirectory, channelsOf, ensureSources, itemById, playChannel, removeRecent, research, stop, syncDirectory, toast, toggleFavorite, useNow, useSim } from '../../../core/store';
import { scoreAt, phaseOf } from '../../../core/score';
import { hhmm, relativeTime, untilText } from '../../../core/format';
import type { Item } from '../../../core/types';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { Icon } from '../components/icons';
import { Dot } from '../components/ui';
import { VideoSurface } from '../components/video';
import { channelNow, groupByCategory, groupRecents, idLabel, matchTitle, playerTone, playerWord, simTime, sourceLabel, techRows, useReducedMotionPref } from '../components/lib';
import { openInItems } from '../components/sheets';
import { EmptyView, NavBar, NavButton, PillButton, Row, Section, Seg, Value } from './ui';
import { PhoneControls, PhoneSources, PhoneStatus, sourcesSummary } from './Player';
import { openSheet } from './state';
import { openMatchPhone } from './Partidos';

type Tab = 'favoritos' | 'recientes' | 'listas';

export function Canales({ hasMini, initialTab }: { hasMini: boolean; initialTab?: string }) {
  const favorites = useSim((s) => s.favorites);
  const history = useSim((s) => s.history);
  const directories = useSim((s) => s.directories);
  const activeDir = useSim((s) => s.activeDirectoryId);
  const agenda = useSim((s) => s.agenda);
  const nowMs = useNow();
  const [tab, setTab] = useState<Tab>(() => (initialTab === 'recientes' ? 'recientes' : initialTab && initialTab !== 'favoritos' ? 'listas' : favorites.length ? 'favoritos' : history.length ? 'recientes' : 'listas'));
  const [dirId, setDirId] = useState(initialTab && directories.some((d) => d.id === initialTab) ? initialTab : activeDir);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const dir = directories.find((d) => d.id === dirId) ?? directories[0];
  const items: Item[] = tab === 'favoritos' ? favorites : tab === 'recientes' ? history : channelsOf(dir?.id);
  const onAir = useMemo(() => {
    const seen = new Set<string>();
    return items.filter((it) => {
      const n = channelNow(it, agenda, nowMs);
      if (!n?.live || seen.has(it.title)) return false;
      seen.add(it.title);
      return true;
    });
  }, [items, agenda, Math.floor(nowMs / 30000)]);
  const groups = useMemo(() => {
    if (tab === 'recientes') return groupRecents(items, nowMs);
    if (tab === 'listas') return groupByCategory(items);
    // Favoritos: los que ya salen en «Emitiendo ahora» no se repiten debajo.
    const rest = items.filter((it) => !onAir.includes(it));
    return rest.length ? [{ title: onAir.length ? 'Favoritos' : '', items: rest }] : [];
  }, [items, tab, onAir, Math.floor(nowMs / 60000)]);

  const pickList = () =>
    openSheet({
      type: 'actions',
      title: 'Lista',
      items: directories.map((d) => ({ id: d.id, label: `${d.name}${d.id === activeDir ? ' · en uso' : ''} · ${d.count}`, icon: 'list' as const, run: () => setDirId(d.id) })),
    });

  return (
    <>
      <NavBar title="Canales" large right={<NavButton icon="clipboard" label="Pegar Content ID" onClick={() => navigate('buscar')} />} />
      <div className={`ip-scroll ${hasMini ? 'has-mini' : ''}`}>
        <div className="ip-toolbar" data-testid="selector-biblioteca">
          <Seg
            value={tab}
            onChange={setTab}
            ariaLabel="Sección"
            options={[
              { id: 'favoritos', label: 'Favoritos', count: favorites.length },
              { id: 'recientes', label: 'Recientes', count: history.length },
              { id: 'listas', label: 'Listas', count: directories.length },
            ]}
          />
        </div>
        {tab === 'listas' && dir && (
          <Section inset>
            <Row
              leading={<Icon name="list" size={18} className="co-ink-3" />}
              title={
                <span className="co-row-flex" style={{ gap: 6 }}>
                  {dir.name}
                  {dir.id === activeDir && <span className="co-chip co-chip--accent">En uso</span>}
                </span>
              }
              subtitle={dir.syncing ? `Actualizando… ${Math.round((dir.syncProgress ?? 0) * 100)} %` : dir.syncedAt ? `${dir.count} canales · actualizada ${relativeTime(simTime(new Date(dir.syncedAt).getTime()), nowMs)}` : `${dir.count} canales`}
              onClick={pickList}
              trailing={<span className="ip-link">Cambiar</span>}
            />
            {dir.id !== activeDir && <Row title="Usar esta lista" onClick={() => activateDirectory(dir.id)} trailing={<Icon name="check" size={16} className="co-ink-3" />} />}
            <Row title="Actualizar ahora" onClick={() => syncDirectory(dir.id)} disabled={dir.syncing} trailing={<Icon name="refresh" size={16} className="co-ink-3" />} />
          </Section>
        )}
        {onAir.length > 0 && (
          <Section
            title={
              <>
                <Dot tone="live" size="sm" /> Emitiendo ahora
              </>
            }
            count={onAir.length}
          >
            {onAir.map((it) => (
              <ChannelRow key={`air-${it.id}`} it={it} tab={tab} />
            ))}
          </Section>
        )}
        {groups.map((g) => (
          <Section key={g.title || 'all'} title={g.title || undefined} count={g.title ? g.items.length : undefined} collapsible={tab === 'listas'} collapsed={!!collapsed[g.title]} onToggle={() => setCollapsed((c) => ({ ...c, [g.title]: !c[g.title] }))}>
            {g.items.map((it) => (
              <ChannelRow key={it.id} it={it} tab={tab} />
            ))}
          </Section>
        ))}
        {tab === 'favoritos' && favorites.length === 0 && <EmptyView icon="star" title="Aún no tienes favoritos" text="Desliza un canal de tus listas hacia la derecha para guardarlo." action={<PillButton onClick={() => setTab('listas')}>Ver las listas</PillButton>} />}
        {tab === 'recientes' && history.length === 0 && <EmptyView icon="clock" title="Aún no has visto nada" text="Los canales que reproduzcas se quedan aquí." action={<PillButton onClick={() => navigate('agenda')}>Ir a Partidos</PillButton>} />}
        {tab === 'listas' && items.length === 0 && <EmptyView icon="list" title="Esta lista está vacía" action={<PillButton onClick={() => navigate('ajustes', 'listas')}>Gestionar listas</PillButton>} />}
      </div>
    </>
  );
}

function ChannelRow({ it, tab }: { it: Item; tab: Tab }) {
  const nowMs = useNow();
  const agenda = useSim((s) => s.agenda);
  const fav = useSim((s) => s.favorites.some((f) => f.id === it.id));
  const isTarget = useSim((s) => s.player.target?.kind === 'channel' && s.player.target.id === it.id);
  const reduced = useReducedMotionPref();
  const now = channelNow(it, agenda, nowMs);
  const [open, setOpen] = useState<0 | 1 | -1>(0);
  const [dragging, setDragging] = useState(false);
  const sub = now ? (
    <span className="co-row-flex" style={{ gap: 5 }}>
      {now.live ? <Dot tone="live" size="sm" /> : <Dot tone="queued" size="sm" />}
      <span className="co-truncate">{matchTitle(now.match)}</span>
      <span className="ip-mono" style={{ color: 'var(--co-ink-3)' }}>{now.live ? scoreAt(now.match, nowMs).clock : hhmm(now.match.start)}</span>
    </span>
  ) : tab === 'recientes' ? (
    relativeTime(simTime(new Date(it.date).getTime()), nowMs)
  ) : (
    it.category
  );
  const removable = tab === 'recientes' || tab === 'favoritos';
  return (
    <div className={`ip-swipe ${open || dragging ? 'is-open' : ''}`}>
      <div className="ip-swipe-actions" style={{ left: 0, right: 'auto' }}>
        <button
          type="button"
          className="ip-swipe-action"
          onClick={() => {
            toggleFavorite(it.id);
            setOpen(0);
          }}
        >
          <Icon name={fav ? 'star-filled' : 'star'} size={18} />
          {fav ? 'Quitar' : 'Favorito'}
        </button>
      </div>
      {removable && (
        <div className="ip-swipe-actions">
          <button
            type="button"
            className="ip-swipe-action is-danger"
            onClick={() => {
              if (tab === 'recientes') removeRecent(it.id);
              else toggleFavorite(it.id);
              setOpen(0);
            }}
          >
            <Icon name="trash" size={18} />
            Quitar
          </button>
        </div>
      )}
      <motion.div
        className="ip-swipe-front"
        drag={reduced ? false : 'x'}
        dragConstraints={{ left: removable ? -88 : 0, right: 88 }}
        dragElastic={0.05}
        dragMomentum={false}
        animate={{ x: open === 1 ? 88 : open === -1 ? -88 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        onDragStart={() => setDragging(true)}
        onDragEnd={(_, info) => {
          setDragging(false);
          setOpen(info.offset.x > 40 ? 1 : info.offset.x < -40 && removable ? -1 : 0);
        }}
      >
        <Row
          leading={<ChannelMark name={it.title} size={32} radius={8} />}
          title={
            <span className="co-row-flex" style={{ gap: 6 }}>
              <span className="co-truncate">{it.title}</span>
              {isTarget && <span className="co-chip co-chip--ok">En pantalla</span>}
            </span>
          }
          subtitle={sub}
          onClick={() => (open ? setOpen(0) : navigate('canal', it.id))}
          chevron
          trailing={fav && tab !== 'favoritos' ? <Icon name="star-filled" size={14} className="ip-mine" /> : undefined}
        />
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------- Canal

export function Canal({ id, hasMini }: { id: string; hasMini: boolean }) {
  const item = itemById(id);
  const title = item?.title ?? `Canal ${idLabel(id)}`;
  const nowMs = useNow();
  const agenda = useSim((s) => s.agenda);
  const player = useSim((s) => s.player);
  const isTarget = player.target?.kind === 'channel' && player.target.id === id;
  const session = useSim((s) => s.sourceSessions[`channel:${id}`]);
  const fav = useSim((s) => s.favorites.some((f) => f.id === id));
  const directories = useSim((s) => s.directories);
  const active = isTarget && session ? session.sources.find((x) => x.id === player.target?.sourceId) : undefined;
  const now = item ? channelNow(item, agenda, nowMs) : null;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ detalles: true });
  useEffect(() => {
    ensureSources('channel', id);
  }, [id]);
  const upcoming = item ? agenda.filter((m) => m.channels.some((c) => c.name === item.title) && phaseOf(m, nowMs) === 'upcoming').sort((a, b) => a.start - b.start).slice(0, 4) : [];
  const where = fav ? 'En tus favoritos' : item?.listaId ? `De tu lista ${directories.find((d) => d.id === item.listaId)?.name ?? ''}` : 'Canal suelto';
  const more = () =>
    openSheet({
      type: 'actions',
      title,
      items: [
        { id: 'fav', label: fav ? 'Quitar de favoritos' : 'Guardar en favoritos', icon: fav ? 'star-filled' : 'star', run: () => toggleFavorite(id, title) },
        { id: 'rename', label: 'Renombrar…', icon: 'edit', disabled: !item, run: () => openSheet({ type: 'rename', id, title }) },
        { id: 'research', label: 'Rebuscar fuentes', icon: 'refresh', run: () => research('channel', id) },
        { id: 'paste', label: 'Pegar Content ID…', icon: 'clipboard', run: () => openSheet({ type: 'paste', kind: 'channel', id }) },
        { id: 'report', label: 'Reportar la fuente…', icon: 'flag', disabled: !active, run: () => active && openSheet({ type: 'report', kind: 'channel', id, sourceId: active.id }) },
        { id: 'copyname', label: 'Copiar nombre', icon: 'copy', run: () => { navigator.clipboard?.writeText(title).catch(() => undefined); toast('Nombre copiado', 'ok'); } },
        ...openInItems(active ?? session?.sources[0]),
        ...(isTarget ? [{ id: 'stop', label: 'Detener', icon: 'stop' as const, danger: true, run: () => stop('usuario') }] : []),
      ],
    });
  return (
    <>
      <NavBar title={title} backLabel="Canales" right={<NavButton icon="more" label="Más" onClick={more} />} />
      <div className={`ip-scroll ${hasMini ? 'has-mini' : ''}`}>
        <div className="ip-inline-video">
          {isTarget ? (
            <VideoSurface radius={14} />
          ) : (
            <div className="ip-inline-idle" style={{ background: 'var(--co-bg-3)' }}>
              <ChannelMark name={title} size={56} radius={14} />
              <p>{now ? (now.live ? `Ahora: ${matchTitle(now.match)}` : `Después: ${matchTitle(now.match)} · ${hhmm(now.match.start)}`) : 'Sin partido anunciado'}</p>
              <PillButton kind="primary" icon="play" onClick={() => playChannel(id)}>
                Ver ahora
              </PillButton>
            </div>
          )}
        </div>
        {isTarget && (
          <div style={{ padding: '0 16px' }}>
            <PhoneStatus />
            <PhoneControls compact />
          </div>
        )}
        <Section title="Estado" inset>
          <Row title="Reproducción" trailing={<Value tone={isTarget ? playerTone(player) : 'idle'}>{isTarget ? playerWord(player) : 'En reposo'}</Value>} />
          {active && <Row title="Señal" trailing={<Value tone={sourceLabel(active, nowMs).tone}>{sourceLabel(active, nowMs).word} · {active.resolution}</Value>} />}
          <Row title="Ahora" onClick={now ? () => openMatchPhone(now.match.id) : undefined} chevron={!!now} trailing={<Value tone={now?.live ? 'live' : undefined}>{now ? matchTitle(now.match) : 'Sin partido'}</Value>} />
          <Row title="Biblioteca" trailing={<Value>{where}</Value>} />
          <Row title="Favorito" trailing={<button type="button" className="ip-navbtn" style={{ width: 32, height: 32 }} onClick={() => toggleFavorite(id, title)} aria-label={fav ? 'Quitar de favoritos' : 'Guardar en favoritos'}><Icon name={fav ? 'star-filled' : 'star'} size={18} /></button>} />
        </Section>
        {session && (
          <Section title="Fuentes hermanas" count={sourcesSummary(session)} footer="Del mismo canal. Aquí no hay cambio automático: eliges tú.">
            <PhoneSources session={session} kind="channel" id={id} />
          </Section>
        )}
        {upcoming.length > 0 && (
          <Section title="Después en este canal" inset>
            {upcoming.map((m) => (
              <Row key={m.id} title={matchTitle(m)} subtitle={untilText(m.start, nowMs)} onClick={() => openMatchPhone(m.id)} chevron />
            ))}
          </Section>
        )}
        <Section title="Detalles" inset collapsible collapsed={!!collapsed.detalles} onToggle={() => setCollapsed((c) => ({ ...c, detalles: !c.detalles }))}>
          {isTarget ? techRows(player, active).map((r) => <Row key={r.k} title={r.k} trailing={<span className="ip-mono" style={{ fontSize: 13 }}>{r.v}</span>} />) : <Row title="Content ID" trailing={<span className="ip-mono" style={{ fontSize: 13 }}>{idLabel(id)}</span>} />}
        </Section>
      </div>
    </>
  );
}
