import { useMemo, useState } from 'react';
import { activateDirectory, channelsOf, isFavorite, playChannel, removeRecent, renameItem, toast, toggleFavorite, useNow, useSim } from '../../../core/store';
import type { Item, Match } from '../../../core/types';
import { scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { Crest } from '../../../core/ui/Crest';
import { hhmm, relativeTime } from '../../../core/format';
import { I } from './icons';
import { Menu, Sheet, type MenuItem } from './Sheets';
import { navigate } from '../../../core/router';

/* Biblioteca: favoritos, recientes, listas por directorio y categoría,
   «Emitiendo ahora» y las acciones de canal. */

export type LibTab = 'favoritos' | 'recientes' | 'listas';

/** Qué partido da un canal ahora o después (por nombre de canal). */
export function useChannelProgram(title: string): { match: Match; score: ReturnType<typeof scoreAt> } | null {
  const agenda = useSim((s) => s.agenda);
  const now = useNow();
  return useMemo(() => {
    const key = title.toLowerCase().replace(/\s*(fhd|hd|1080p|720p|sd)$/i, '').trim();
    const candidates = agenda.filter((m) => m.channels.some((c) => c.name.toLowerCase() === key));
    const live = candidates.find((m) => scoreAt(m, now).state === 'in');
    const next = candidates.filter((m) => m.start > now).sort((a, b) => a.start - b.start)[0];
    const m = live ?? next;
    return m ? { match: m, score: scoreAt(m, now) } : null;
  }, [agenda, now, title]);
}

export function useOnAir(): { item: Item; match: Match; score: ReturnType<typeof scoreAt> }[] {
  const favorites = useSim((s) => s.favorites);
  const history = useSim((s) => s.history);
  const agenda = useSim((s) => s.agenda);
  const now = useNow();
  return useMemo(() => {
    const seen = new Set<string>();
    const seenMatch = new Set<string>();
    const out: { item: Item; match: Match; score: ReturnType<typeof scoreAt> }[] = [];
    for (const it of [...favorites, ...history]) {
      if (seen.has(it.title)) continue;
      seen.add(it.title);
      const key = it.title.toLowerCase();
      const m = agenda.find((x) => x.channels.some((c) => c.name.toLowerCase() === key) && scoreAt(x, now).state === 'in');
      if (m && !seenMatch.has(m.id)) {
        seenMatch.add(m.id);
        out.push({ item: it, match: m, score: scoreAt(m, now) });
      }
    }
    return out;
  }, [favorites, history, agenda, now]);
}

export function groupRecents(items: Item[], now: number): { label: string; items: Item[] }[] {
  const start = new Date(now).setHours(0, 0, 0, 0);
  const groups: Record<string, Item[]> = { Hoy: [], Ayer: [], 'Esta semana': [], Antes: [] };
  for (const it of items) {
    const t = Date.parse(it.date);
    if (t >= start) groups.Hoy.push(it);
    else if (t >= start - 86400000) groups.Ayer.push(it);
    else if (t >= start - 6 * 86400000) groups['Esta semana'].push(it);
    else groups.Antes.push(it);
  }
  return Object.entries(groups).filter(([, v]) => v.length).map(([label, items]) => ({ label, items }));
}

export function groupByCategory(items: Item[]): { label: string; items: Item[] }[] {
  const map = new Map<string, Item[]>();
  for (const it of items) {
    const k = it.category || 'General';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(it);
  }
  return [...map.entries()].map(([label, items]) => ({ label, items }));
}

export function ChannelRow({ item, context, onOpen }: { item: Item; context: LibTab | 'buscar'; onOpen?: () => void }) {
  const program = useChannelProgram(item.title);
  const playing = useSim((s) => s.player.target?.kind === 'channel' && s.player.target.id === item.id);
  const fav = useSim((s) => s.favorites.some((f) => f.id === item.id));
  const [menu, setMenu] = useState(false);
  const [rename, setRename] = useState(false);
  const [name, setName] = useState(item.title);
  const now = useNow();
  const open = onOpen ?? (() => navigate('canal', item.id));
  const items: MenuItem[] = [
    { label: 'Ver canal', icon: <I.Play size={16} />, onSelect: open },
    { label: fav ? 'Quitar de favoritos' : 'Añadir a favoritos', icon: <I.Star size={16} filled={fav} />, onSelect: () => toggleFavorite(item.id, item.title) },
    { label: 'Cambiar el nombre', icon: <I.Copy size={16} />, separated: true, onSelect: () => setRename(true) },
    { label: 'Copiar enlace', icon: <I.Link size={16} />, onSelect: () => toast('Enlace acestream:// copiado', 'ok') },
    { label: 'Abrir en la app de AceStream', icon: <I.External size={16} />, onSelect: () => toast('Abriendo en AceStream…') },
    ...(context === 'recientes' ? [{ label: 'Quitar de recientes', icon: <I.Trash size={16} />, danger: true, separated: true, onSelect: () => removeRecent(item.id) } as MenuItem] : []),
    ...(context === 'favoritos' ? [{ label: 'Quitar de favoritos', icon: <I.Trash size={16} />, danger: true, separated: true, onSelect: () => toggleFavorite(item.id) } as MenuItem] : []),
  ];
  const sub = (() => {
    if (playing) return <span className="tb-chan__now is-playing"><I.Speaker size={13} /> En pantalla</span>;
    if (program) {
      const { match, score } = program;
      const h = team(match.home);
      const a = team(match.away);
      if (score.state === 'in') return <span className="tb-chan__now is-live"><i className="tb-minute__dot" /> {h.short} {score.home}–{score.away} {a.short} · {score.halftime ? 'Descanso' : score.clock}</span>;
      return <span className="tb-chan__now">A las {hhmm(match.start)}, {h.name} – {a.name}</span>;
    }
    if (context === 'recientes') return <span className="tb-chan__now">{relativeTime(Date.parse(item.date), now)}</span>;
    return <span className="tb-chan__now">{item.category || 'Canal'}</span>;
  })();
  return (
    <li className={`tb-chan${playing ? ' is-playing' : ''}`}>
      <button type="button" className="tb-chan__hit" onClick={open}>
        <ChannelMark name={item.title} size={44} radius={11} />
        <span className="tb-chan__body">
          <span className="tb-chan__title">{item.title}</span>
          {sub}
        </span>
        {fav && context !== 'favoritos' && <I.Star size={14} filled className="tb-chan__fav" />}
      </button>
      <button type="button" className="tb-chan__more" aria-label={`Más opciones de ${item.title}`} onClick={() => setMenu(true)}>
        <I.More size={18} />
      </button>
      {menu && <Menu items={items} onClose={() => setMenu(false)} title={item.title} />}
      <Sheet
        open={rename}
        onClose={() => setRename(false)}
        title="Cambiar el nombre"
        size="sm"
        footer={
          <button type="button" className="tb-btn tb-btn--primary tb-btn--block" disabled={!name.trim()} onClick={() => { renameItem(item.id, name.trim()); setRename(false); }}>
            Guardar
          </button>
        }
      >
        <label className="tb-field">
          <span className="tb-field__label">Nombre</span>
          <input className="tb-field__input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="tb-field__hint">Solo cambia cómo se ve en tu biblioteca.</div>
      </Sheet>
    </li>
  );
}

export function OnAirStrip() {
  const onAir = useOnAir();
  if (!onAir.length) return null;
  return (
    <section className="tb-onair" aria-label="Emitiendo ahora">
      <h3 className="tb-h3"><i className="tb-minute__dot" /> Emitiendo ahora</h3>
      <div className="tb-onair__strip">
        {onAir.map(({ item, match, score }) => {
          const h = team(match.home);
          const a = team(match.away);
          return (
            <button type="button" key={item.id} className="tb-onair__card" onClick={() => playChannel(item.id)}>
              <span className="tb-onair__crests">
                <Crest team={h} size={28} />
                <Crest team={a} size={28} />
              </span>
              <span className="tb-onair__score">{score.home}–{score.away}</span>
              <span className="tb-onair__meta">{score.halftime ? 'Descanso' : score.clock} · {item.title}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function DirectoryPicker() {
  const dirs = useSim((s) => s.directories);
  const active = useSim((s) => s.activeDirectoryId);
  const [open, setOpen] = useState(false);
  const cur = dirs.find((d) => d.id === active);
  return (
    <div className="tb-dirpick">
      <button type="button" className="tb-dirpick__btn" onClick={() => setOpen(true)}>
        <span className="tb-dirpick__name">{cur?.name ?? 'Lista'}</span>
        <span className="tb-dirpick__meta">{cur?.syncing ? 'Actualizando…' : cur?.syncedAt ? `${cur.count} canales · ${relativeTime(Date.parse(cur.syncedAt), Date.now())}` : 'sin sincronizar'}</span>
        <I.Chevron dir="d" size={16} />
      </button>
      {open && <Menu title="Lista en uso" onClose={() => setOpen(false)} items={dirs.map((d) => ({ label: `${d.name} · ${d.count}`, checked: d.id === active, onSelect: () => activateDirectory(d.id) }))} />}
    </div>
  );
}

export function useLibraryLists() {
  const favorites = useSim((s) => s.favorites);
  const history = useSim((s) => s.history);
  const active = useSim((s) => s.activeDirectoryId);
  const now = useNow();
  const listas = channelsOf(active);
  return { favorites, history, listas, recentsGrouped: groupRecents(history, now), byCategory: groupByCategory(listas), isFavorite };
}
