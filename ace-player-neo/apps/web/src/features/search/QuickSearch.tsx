/* Buscar con Ctrl K (rediseño de escritorio, pantalla 6; 01-escritorio.html y
   la mitad «Buscar» de buscar-ajustes.html): una ventana rápida de 640 px
   encima de todo, sobre un velo oscuro. Solo desde 768 px: en el móvil Ctrl K
   y la lupa siguen llevando a la vista Buscar (app/search-open.ts).

   - Sin texto: «Recientes» (las últimas búsquedas con las que abriste algo),
     «Atajos» (En directo ahora, Mis equipos, Mi lista, Mis avisos) y «Pegar un
     enlace» (lee el portapapeles; un acestream:// o un Content ID se ofrece
     para reproducir, la misma regla que «Pegar hash»).
   - Con texto (2 letras): busca A LA VEZ en la Agenda (de hoy en adelante),
     en tus canales (biblioteca y tu IPTV, con «Ahora: …» de la guía o del
     partido que echan) y en el catálogo de Películas y series, agrupado. El
     partido en directo sale primero, con su minuto, sus fuentes y su play.
     Chips «Todo · N», «Partidos · N»… (solo los que tienen algo) y «Ver los
     N» en cada grupo. Si no sale nada, «Buscar en el motor AceStream» lleva a
     la vista Buscar con el texto.
   - Teclado: flechas para moverse (con vuelta), Intro abre, Ctrl+Intro abre
     «Ver juntos» en una película (pide el nombre aquí mismo y crea la sala);
     en lo demás, igual que Intro (y el pie solo enseña «Ctrl Intro ver
     juntos» con una película activa). Esc cierra. Pie con las teclas. Un Intro
     pulsado antes de que se asiente lo escrito, o mientras llegan sus
     resultados (tu IPTV, el catálogo), espera a ellos (no abre los del texto
     anterior ni se pierde), y un clic dentro de la ventana no le quita
     el foco al campo: las flechas siguen funcionando.
   - Accesible: role=dialog modal con el foco atrapado y devuelto al cerrar,
     el campo es un combobox con su listbox (aria-activedescendant), grupos
     con nombre y la cuenta de resultados anunciada.
   - Superficie opaca con borde de 1 px (sin cristal ni desenfoque); entra
     con opacidad y un desplazamiento corto (transform), nada con
     prefers-reduced-motion. */

import '../agenda/demo.ts';
import '../cine/demo.ts';
import '../cine/cine.css';
import './quick-search.css';

import type { FootballMatch, LiveScore, VodCard } from '@ace/shared';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { api, describeFailure, useApiQuery, useIptvActive, useVodActive } from '../../api/index.ts';
import { rememberViewParam, useNavigate } from '../../app/router.tsx';
import { channelTone, oklchCss } from '../../lib/color.ts';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { MEDIA, useMediaQuery } from '../../lib/media.ts';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { ChannelMark } from '../../ui/ChannelMark.tsx';
import { Chip } from '../../ui/Chip.tsx';
import { Icon } from '../../ui/Icon.tsx';
import type { IconName } from '../../ui/icons.ts';
import { isTopOverlay, overlayRoot, popOverlay, pushOverlay, trapTab } from '../../ui/overlay.ts';
import { TeamMark } from '../../ui/TeamMark.tsx';
import { versusSide } from '../agenda/cards.ts';
import { useLibraryQuery, useNow, useSchedule, useScores } from '../agenda/data.ts';
import { dayLabel, liveMinute, madridClock, matchTitle } from '../agenda/domain.ts';
import { setAgendaChip, setAgendaDay, setAgendaMode } from '../agenda/state.ts';
import { Art } from '../cine/Art.tsx';
import { useSettled } from '../cine/data.ts';
import { MY_LIST_CAT } from '../cine/model.ts';
import { saveCredential, saveName, savedName } from '../juntos/client.ts';
import { filterItems, findKnownItem, foldText } from '../library/model.ts';
import { useOnAir } from '../library/on-air.ts';
import { playChannel } from '../library/play.ts';
import { pastedTitle } from '../paste-hash/PasteHashSheet.tsx';
import { registerGuideNowDemo, registerIptvChannelsDemo } from './demo-register.ts';
import { isHashOrLink } from './model.ts';
import { goToEngineSearch } from './navigation.ts';
import {
  addRecent,
  channelBrand,
  GROUP_TITLE,
  highlightParts,
  logoText,
  QUICK_MIN,
  readRecents,
  removeRecent,
  saveRecents,
  searchMatches,
  seeAllText,
  stepIndex,
  visibleCount,
  type QuickFilter,
  type QuickGroup,
  type QuickMatch,
} from './quick-model.ts';

// En la demo, «En tu IPTV» contesta con los canales de la IPTV de ejemplo, y su
// «Ahora: …» sale de una guía inventada.
registerIptvChannelsDemo();
registerGuideNowDemo();

/** Espera tras la última tecla: corta, porque casi todo es local (la agenda y la biblioteca ya están). */
const SETTLE_MS = 160;
/** Canales y títulos que se piden como mucho (por tipo). */
const CHANNELS_MAX = 8;
const TITLES_MAX = 6;

type ShortcutKey = 'directo' | 'equipos' | 'milista' | 'avisos';

const SHORTCUTS: ReadonlyArray<{ key: ShortcutKey; label: string; icon: IconName }> = [
  { key: 'directo', label: 'En directo ahora', icon: 'directo' },
  { key: 'equipos', label: 'Mis equipos', icon: 'camiseta' },
  { key: 'milista', label: 'Mi lista', icon: 'milista' },
  { key: 'avisos', label: 'Mis avisos', icon: 'campana' },
];

interface QuickChannel {
  id: string;
  title: string;
  ih: boolean;
  category: string | undefined;
  /** Id IPTV si es (o se ve por) un canal de tu IPTV. */
  iptv: string | null;
  alias: string | undefined;
}

type Option =
  | { kind: 'reciente'; id: string; text: string }
  | { kind: 'atajo'; id: string; key: ShortcutKey }
  | { kind: 'pegar'; id: string }
  | { kind: 'enlace'; id: string; hash: string }
  | { kind: 'partido'; id: string; item: QuickMatch }
  | { kind: 'canal'; id: string; channel: QuickChannel }
  | { kind: 'titulo'; id: string; card: VodCard }
  | { kind: 'motor'; id: string };

export interface QuickSearchProps {
  open: boolean;
  /** Sube cada vez que se pide abrir (Ctrl K con la ventana abierta vuelve al campo). */
  nonce: number;
  onClose(): void;
}

export default function QuickSearch({ open, nonce, onClose }: QuickSearchProps) {
  const wide = useMediaQuery(MEDIA.tablet);
  // Al pasar a móvil con la ventana abierta, se cierra: allí se busca en la vista Buscar.
  useEffect(() => {
    if (open && !wide) onClose();
  }, [open, wide, onClose]);
  if (!open || !wide) return null;
  return createPortal(<Palette nonce={nonce} onClose={onClose} />, overlayRoot());
}

function Palette({ nonce, onClose }: { nonce: number; onClose(): void }) {
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayId = useRef<symbol | null>(null);
  const listId = useId();
  const titleId = useId();
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<QuickFilter>('todo');
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState(readRecents);
  const [juntos, setJuntos] = useState<VodCard | null>(null);
  /** Intro pulsado antes de que se asiente lo escrito: `true` si fue con Ctrl (ver juntos). */
  const pendingEnter = useRef<boolean | null>(null);

  // Capa modal: el resto de la app queda inert y el foco vuelve a donde estaba.
  useLayoutEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const id = pushOverlay(true);
    overlayId.current = id;
    return () => {
      popOverlay(id);
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, []);

  // Al abrir (y con cada Ctrl K): el campo enfocado y lo escrito seleccionado.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
  }, [nonce]);

  const clean = text.replace(/\s+/g, ' ').trim();
  const query = useSettled(clean, SETTLE_MS);
  const typed = foldText(text).length >= QUICK_MIN;
  const searching = foldText(query).length >= QUICK_MIN;
  const detected = isHashOrLink(text);

  // ---- Datos ----------------------------------------------------------------------

  const now = useNow();
  const today = madridClock(now).date;
  const schedule = useSchedule();
  const days = useMemo(() => schedule.data?.days ?? [], [schedule.data]);
  const todayMatches = useMemo(
    () => days.find((day) => day.date === today)?.matches ?? [],
    [days, today],
  );
  const { scores } = useScores(todayMatches, now, true);
  const matches = useMemo(
    () => (searching && !detected ? searchMatches(days, query, now, today, scores) : []),
    [days, query, now, today, scores, searching, detected],
  );

  const library = useLibraryQuery();
  const withIptv = useIptvActive();
  const withVod = useVodActive();
  const onAir = useOnAir(true);

  const iptvSearch = useApiQuery(
    'iptvChannels',
    { query: { q: query, limit: CHANNELS_MAX } },
    { enabled: withIptv && searching && !detected, retry: false, staleTime: 60_000 },
  );

  const channels = useMemo<QuickChannel[]>(() => {
    if (!searching || detected) return [];
    const data = library.data;
    const out: QuickChannel[] = [];
    const ids = new Set<string>();
    const names = new Set<string>();
    if (data) {
      for (const item of filterItems([...data.favorites, ...data.history, ...data.web], query)) {
        if (ids.has(item.id)) continue;
        ids.add(item.id);
        // Un canal de tu IPTV guardado en tu biblioteca lleva su id IPTV como id (iptvIds).
        const iptv = Object.hasOwn(data.iptvIds ?? {}, item.id) ? item.id : null;
        names.add(foldText(item.alias ?? item.title));
        out.push({
          id: item.id,
          title: item.title,
          ih: item.ih,
          category: item.category,
          iptv,
          alias: item.alias,
        });
      }
    }
    // Solo la respuesta de ESTE texto (una atrasada no pinta encima).
    if (withIptv && iptvSearch.data && foldText(iptvSearch.data.query) === foldText(query)) {
      for (const channel of iptvSearch.data.channels) {
        if (ids.has(channel.id) || names.has(foldText(channel.title))) continue;
        ids.add(channel.id);
        out.push({
          id: channel.id,
          title: channel.title,
          ih: false,
          category: 'IPTV',
          iptv: channel.id,
          alias: undefined,
        });
      }
    }
    return out.slice(0, CHANNELS_MAX);
  }, [library.data, iptvSearch.data, withIptv, query, searching, detected]);

  // «Ahora: …» de la guía de tu IPTV para los canales que lo son.
  const guideIds = channels.flatMap((channel) => (channel.iptv ? [channel.iptv] : []));
  const guideNow = useApiQuery(
    'iptvGuideNow',
    { query: { ids: guideIds.join(',') } },
    { enabled: withIptv && guideIds.length > 0, retry: false, staleTime: 60_000 },
  );
  const nowOn = (channel: QuickChannel): string | null => {
    const fromGuide = guideNow.data?.items.find((item) => item.id === channel.iptv)?.now;
    if (fromGuide?.title) return `Ahora: ${fromGuide.title}`;
    const air = onAir({ title: channel.title, ...(channel.alias ? { alias: channel.alias } : {}) });
    if (air.live) return `Ahora: ${matchTitle(air.live.match)}`;
    if (air.next) return `A las ${air.next.match.time}: ${matchTitle(air.next.match)}`;
    return null;
  };

  const vodQuery = (kind: 'movie' | 'series') =>
    ({ kind, cat: 'all', sort: 'added', q: query, limit: TITLES_MAX }) as const;
  const movies = useApiQuery(
    'vodBrowse',
    { query: vodQuery('movie') },
    { enabled: withVod && searching && !detected, retry: false, staleTime: 60_000 },
  );
  const series = useApiQuery(
    'vodBrowse',
    { query: vodQuery('series') },
    { enabled: withVod && searching && !detected, retry: false, staleTime: 60_000 },
  );
  const titles = useMemo<VodCard[]>(() => {
    if (!searching || detected || !withVod) return [];
    return [...(movies.data?.items ?? []), ...(series.data?.items ?? [])];
  }, [movies.data, series.data, searching, detected, withVod]);

  const loading =
    typed &&
    !detected &&
    (clean !== query ||
      schedule.isLoading ||
      (withIptv && iptvSearch.isFetching && !iptvSearch.data) ||
      (withVod && (movies.isLoading || series.isLoading)));

  // ---- Opciones (el orden de las flechas es el de la pantalla) ----------------------

  const counts: Record<QuickGroup, number> = {
    partidos: matches.length,
    canales: channels.length,
    titulos: titles.length,
  };
  const total = counts.partidos + counts.canales + counts.titulos;
  const shownFilter: QuickFilter = filter !== 'todo' && counts[filter] === 0 ? 'todo' : filter;

  const groups = useMemo(() => {
    const out: Array<{ group: QuickGroup; options: Option[] }> = [];
    const sizes: Record<QuickGroup, number> = {
      partidos: matches.length,
      canales: channels.length,
      titulos: titles.length,
    };
    const take = (group: QuickGroup) => visibleCount(group, sizes[group], shownFilter);
    const partidos = matches
      .slice(0, take('partidos'))
      .map((item): Option => ({ kind: 'partido', id: `p-${item.match.id}`, item }));
    const canales = channels
      .slice(0, take('canales'))
      .map((channel): Option => ({ kind: 'canal', id: `c-${channel.id}`, channel }));
    const pelis = titles
      .slice(0, take('titulos'))
      .map((card): Option => ({ kind: 'titulo', id: `t-${card.id}`, card }));
    if (partidos.length) out.push({ group: 'partidos', options: partidos });
    if (canales.length) out.push({ group: 'canales', options: canales });
    if (pelis.length) out.push({ group: 'titulos', options: pelis });
    return out;
  }, [matches, channels, titles, shownFilter]);

  const options = useMemo<Option[]>(() => {
    if (detected) return [{ kind: 'enlace', id: 'enlace', hash: detected }];
    if (!typed) {
      return [
        ...recents.map((recent, index): Option => ({
          kind: 'reciente',
          id: `r-${index}`,
          text: recent,
        })),
        ...SHORTCUTS.map((shortcut): Option => ({
          kind: 'atajo',
          id: `a-${shortcut.key}`,
          key: shortcut.key,
        })),
        { kind: 'pegar', id: 'pegar' },
      ];
    }
    const found = groups.flatMap((group) => group.options);
    // Sin nada en la agenda, tus canales ni el catálogo: buscar en el motor.
    return found.length || loading ? found : [{ kind: 'motor', id: 'motor' }];
  }, [detected, typed, recents, groups, loading]);

  // Lo escrito o el chip cambian: la primera opción vuelve a ser la activa.
  useEffect(() => setActive(0), [query, typed, shownFilter, detected]);
  const current = Math.min(active, options.length - 1);
  const optionId = (option: Option) => `${listId}-${option.id}`;
  const activeOption = options[current];

  useEffect(() => {
    if (!activeOption) return;
    document.getElementById(optionId(activeOption))?.scrollIntoView({ block: 'nearest' });
    // optionId depende solo de listId.
  }, [activeOption]);

  // ---- Acciones ------------------------------------------------------------------

  const remember = () => {
    if (!typed) return;
    const next = addRecent(recents, text);
    setRecents(next);
    saveRecents(next);
  };

  const finish = () => {
    remember();
    onClose();
  };

  const openMatch = (match: FootballMatch) => {
    if (!match.channels?.length) {
      notify('El canal todavía no está anunciado', { tone: 'info' });
      return;
    }
    haptic('light');
    finish();
    navigate({ vista: 'partido', id: match.id, canal: null });
  };

  const openChannel = (channel: QuickChannel) => {
    haptic('light');
    finish();
    playChannel(navigate, {
      hash: channel.id,
      title: channel.title,
      ih: channel.iptv === channel.id ? false : channel.ih,
      ...(channel.category ? { category: channel.category } : {}),
      record: true,
      origin: 'buscar',
      ...(channel.iptv ? { iptv: channel.iptv } : {}),
      ...(channel.iptv === channel.id && channel.alias ? { alias: channel.alias } : {}),
    });
  };

  const openLink = (hash: string) => {
    const known = findKnownItem(library.data, hash);
    haptic('success');
    onClose();
    playChannel(navigate, {
      hash,
      title: pastedTitle(hash, known?.title),
      ih: known ? known.ih : null,
      ...(known?.category ? { category: known.category } : {}),
      record: false,
      origin: 'pegado',
    });
    notify(known ? 'Reproduciendo el hash seleccionado' : 'Hash externo añadido y reproduciendo', {
      tone: 'ok',
      icon: 'play',
    });
  };

  const runShortcut = (key: ShortcutKey) => {
    haptic('selection');
    onClose();
    if (key === 'directo') {
      setAgendaDay(null);
      setAgendaChip('live');
      navigate({ vista: 'agenda' });
    } else if (key === 'equipos') {
      setAgendaMode('forYou');
      navigate({ vista: 'agenda' });
    } else if (key === 'milista') {
      rememberViewParam('cine', 'cinecat', MY_LIST_CAT);
      navigate({ vista: 'cine', id: null });
    } else {
      // Los avisos de partidos se eligen con tus equipos y ligas (Ajustes → Tu fútbol).
      navigate({ vista: 'ajustes', seccion: 'futbol' });
    }
  };

  const pasteLink = async () => {
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (!clip) throw new Error('vacío');
      setText(clip.slice(0, 200));
      if (!isHashOrLink(clip)) {
        notify('Lo copiado no es un enlace acestream:// ni un Content ID', { tone: 'info' });
      }
    } catch {
      notify('Pega el enlace en el campo con Ctrl V', { tone: 'info' });
    }
    inputRef.current?.focus();
  };

  const choose = (option: Option | undefined, together = false) => {
    if (!option) return;
    switch (option.kind) {
      case 'reciente':
        setText(option.text);
        inputRef.current?.focus();
        return;
      case 'atajo':
        runShortcut(option.key);
        return;
      case 'pegar':
        void pasteLink();
        return;
      case 'enlace':
        openLink(option.hash);
        return;
      case 'partido':
        openMatch(option.item.match);
        return;
      case 'canal':
        openChannel(option.channel);
        return;
      case 'titulo':
        if (together && option.card.kind === 'movie') {
          remember();
          setJuntos(option.card);
          return;
        }
        haptic('light');
        finish();
        navigate({ vista: 'cine', id: option.card.id });
        return;
      case 'motor':
        finish();
        goToEngineSearch(navigate, text);
        return;
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!overlayId.current || !isTopOverlay(overlayId.current)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (juntos) {
        setJuntos(null);
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      onClose();
      return;
    }
    if (boxRef.current) trapTab(event, boxRef.current);
  };

  // El Intro que esperaba: en cuanto lo escrito se asienta y han llegado sus
  // resultados (la agenda, tu IPTV y el catálogo), abre el primero.
  useEffect(() => {
    if (pendingEnter.current === null || loading) return;
    const together = pendingEnter.current;
    pendingEnter.current = null;
    choose(options[0], together);
  });

  const onFieldKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(stepIndex(current, options.length, event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const together = event.ctrlKey || event.metaKey;
      // Lo escrito aún no se ha asentado (las opciones son las del texto
      // anterior) o sus resultados siguen llegando: se abre en cuanto estén.
      if (loading) {
        pendingEnter.current = together;
        return;
      }
      choose(activeOption, together);
      return;
    }
    // Supr quita un reciente (la ✕ de su fila es solo para el ratón).
    if (event.key === 'Delete' && activeOption?.kind === 'reciente' && !text) {
      event.preventDefault();
      const next = removeRecent(recents, activeOption.text);
      setRecents(next);
      saveRecents(next);
    }
  };

  // ---- Pintar ----------------------------------------------------------------------

  const liveText = (said: string) => {
    if (detected) return 'Enlace detectado: se puede reproducir.';
    if (!typed) return '';
    if (loading) return `Buscando «${said}»…`;
    return total === 0
      ? `Sin resultados para «${said}» en la agenda, tus canales ni el catálogo.`
      : `${total} resultados: ${counts.partidos} partidos, ${counts.canales} canales y ${counts.titulos} pelis y series.`;
  };

  const optionProps = (option: Option): OptionProps => ({
    id: optionId(option),
    role: 'option',
    'aria-selected': option === activeOption,
    className: cx('qs-opt', option === activeOption && 'qs-opt--on'),
    onMouseMove: () => {
      const index = options.indexOf(option);
      if (index !== current) setActive(index);
    },
    onClick: (event: { ctrlKey: boolean; metaKey: boolean }) =>
      choose(option, event.ctrlKey || event.metaKey),
  });

  // Solo los chips con algo (como en la maqueta del móvil); «Todo», siempre.
  const chip = (value: QuickFilter, label: string, count: number) =>
    value !== 'todo' && count === 0 ? null : (
      <Chip
        key={value}
        pressed={shownFilter === value}
        onClick={() => {
          setFilter(value);
          inputRef.current?.focus();
        }}
      >
        {`${label} · ${count}`}
      </Chip>
    );

  // Un clic dentro de la ventana (un rótulo, el hueco entre filas, el pie) no
  // le quita el foco al campo: las flechas e Intro solo los escucha el campo.
  // El clic sigue llegando a las filas y a los botones.
  const keepFieldFocus = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (juntos) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea')) return;
    // La barra de desplazamiento de la lista se sigue pudiendo arrastrar.
    if (
      target.scrollHeight > target.clientHeight &&
      event.nativeEvent.offsetX >= target.clientWidth
    )
      return;
    event.preventDefault();
    if (document.activeElement !== inputRef.current) inputRef.current?.focus();
  };

  return (
    <div className="qs-layer" onKeyDown={onKeyDown}>
      <div className="qs-scrim" aria-hidden="true" onMouseDown={onClose} />
      <div
        ref={boxRef}
        className="qs"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={keepFieldFocus}
      >
        <h2 id={titleId} className="sr-only">
          Buscar partidos, canales, pelis y series
        </h2>
        {juntos ? (
          <JuntosStep
            card={juntos}
            onBack={() => {
              setJuntos(null);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            onDone={(code) => {
              onClose();
              navigate({ vista: 'juntos', code });
            }}
          />
        ) : (
          <>
            <div className="qs-field">
              <Icon name="buscar" size={24} className="qs-field__icon" />
              <input
                ref={inputRef}
                className="qs-field__input"
                type="text"
                role="combobox"
                aria-label="Buscar partidos, canales, pelis…"
                aria-expanded={options.length > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
                aria-describedby={`${listId}-teclas`}
                placeholder="Partidos, canales, pelis…"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="go"
                maxLength={200}
                value={text}
                onChange={(event) => {
                  pendingEnter.current = null;
                  setText(event.target.value);
                }}
                onKeyDown={onFieldKey}
              />
              <kbd className="qs-kbd">Esc</kbd>
            </div>

            {typed && !detected && total > 0 ? (
              <div className="qs-chips" role="group" aria-label="Qué enseñar">
                {chip('todo', 'Todo', total)}
                {chip('partidos', 'Partidos', counts.partidos)}
                {chip('canales', 'Canales', counts.canales)}
                {withVod ? chip('titulos', 'Pelis y series', counts.titulos) : null}
              </div>
            ) : null}

            <p className="sr-only" aria-live="polite">
              {liveText(text.trim())}
            </p>
            <p id={`${listId}-teclas`} className="sr-only">
              Flechas para moverse, Intro para abrir y Control más Intro para ver juntos una
              película.
            </p>

            <div className="qs-body" id={listId} role="listbox" aria-label="Resultados">
              {detected ? (
                <Section title="Enlace detectado">
                  <div {...optionProps(options[0]!)}>
                    <span className="qs-opt__mark" aria-hidden="true">
                      <ChannelMark name={pastedTitle(detected)} shape="tile" size={30} />
                    </span>
                    <span className="qs-opt__text">
                      <b>
                        {findKnownItem(library.data, detected)?.title ?? 'Content ID de AceStream'}
                      </b>
                      <small className="mono">{detected}</small>
                    </span>
                    <span className="qs-go" aria-hidden="true">
                      <Icon name="play" size={16} />
                    </span>
                  </div>
                </Section>
              ) : !typed ? (
                <EmptyStart
                  options={options}
                  recents={recents}
                  optionProps={optionProps}
                  onRemove={(recent) => {
                    const next = removeRecent(recents, recent);
                    setRecents(next);
                    saveRecents(next);
                    inputRef.current?.focus();
                  }}
                />
              ) : (
                <>
                  {groups.map(({ group, options: rows }) => (
                    <Section
                      key={group}
                      title={GROUP_TITLE[group]}
                      more={
                        shownFilter === 'todo' && counts[group] > rows.length ? (
                          // Atajo del ratón: con el teclado, el chip del grupo hace lo mismo.
                          <button
                            type="button"
                            className="qs-sec__more"
                            tabIndex={-1}
                            aria-hidden="true"
                            onClick={() => {
                              setFilter(group);
                              inputRef.current?.focus();
                            }}
                          >
                            {seeAllText(group, counts[group])}
                          </button>
                        ) : null
                      }
                    >
                      {rows.map((option) =>
                        option.kind === 'partido' ? (
                          <MatchOption
                            key={option.id}
                            {...optionProps(option)}
                            item={option.item}
                            query={query}
                            today={today}
                            score={scores[option.item.match.id] ?? null}
                          />
                        ) : option.kind === 'canal' ? (
                          <div key={option.id} {...optionProps(option)}>
                            <ChannelLogo name={option.channel.title} />
                            <span className="qs-opt__text">
                              <b>
                                <Marked text={option.channel.title} query={query} />
                              </b>
                              <small>
                                {nowOn(option.channel) ??
                                  (option.channel.iptv === option.channel.id
                                    ? 'Tu IPTV'
                                    : option.channel.category || 'En tus canales')}
                              </small>
                            </span>
                          </div>
                        ) : option.kind === 'titulo' ? (
                          <div key={option.id} {...optionProps(option)}>
                            <span className="qs-poster" aria-hidden="true">
                              <Art
                                id={option.card.id}
                                art="poster"
                                v={option.card.poster}
                                title={option.card.title}
                              />
                            </span>
                            <span className="qs-opt__text">
                              <b>
                                <Marked text={option.card.title} query={query} />
                              </b>
                              <small>
                                {[
                                  option.card.kind === 'movie' ? 'Película' : 'Serie',
                                  option.card.year,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </small>
                            </span>
                          </div>
                        ) : null,
                      )}
                    </Section>
                  ))}
                  {groups.length === 0 && loading ? (
                    <p className="qs-empty qs-empty--loading">{`Buscando «${text.trim()}»…`}</p>
                  ) : null}
                  {options[0]?.kind === 'motor' ? (
                    <>
                      <p className="qs-empty">
                        {`Nada con «${query}» en la agenda, tus canales ni el catálogo.`}
                      </p>
                      <div className="qs-sec" role="group" aria-label="Motor AceStream">
                        <div {...optionProps(options[0])}>
                          <span className="qs-opt__icon" aria-hidden="true">
                            <Icon name="motor" size={20} />
                          </span>
                          <span className="qs-opt__text">
                            <b>{`Buscar «${text.trim()}» en el motor AceStream`}</b>
                            <small>Canales publicados que aún no tienes</small>
                          </span>
                        </div>
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </div>

            <div className="qs-foot" aria-hidden="true">
              <span>
                <kbd className="qs-kbd">↑↓</kbd>moverse
              </span>
              <span>
                <kbd className="qs-kbd">Intro</kbd>abrir
              </span>
              {/* Solo cuando hace algo: «Ver juntos» crea salas de películas
                  (en lo demás, Ctrl+Intro es Intro). */}
              {activeOption?.kind === 'titulo' && activeOption.card.kind === 'movie' ? (
                <span>
                  <kbd className="qs-kbd">Ctrl Intro</kbd>ver juntos
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface OptionProps {
  id: string;
  role: 'option';
  'aria-selected': boolean;
  className: string | undefined;
  onMouseMove(): void;
  onClick(event: { ctrlKey: boolean; metaKey: boolean }): void;
}

/**
 * La pastilla de 52×36 del canal (la de la maqueta): el color de su marca si
 * es un canal conocido y, si no, su tono por el nombre; encima, su nombre.
 * Decorativa: el nombre va al lado.
 */
function ChannelLogo({ name }: { name: string }) {
  const brand = channelBrand(name);
  const style = {
    '--qs-logo': brand?.bg ?? oklchCss(channelTone(name)),
    '--qs-logo-ink': brand?.ink ?? '#fff',
  } as CSSProperties;
  return (
    <span className="qs-logo" style={style} aria-hidden="true">
      {logoText(name)}
    </span>
  );
}

function Section({
  title,
  more,
  children,
}: {
  title: string;
  more?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="qs-sec" role="group" aria-labelledby={id}>
      <div className="qs-sec__head">
        <span id={id}>{title}</span>
        {more}
      </div>
      {children}
    </div>
  );
}

function Marked({ text, query }: { text: string; query: string }) {
  const [before, hit, after] = highlightParts(text, query);
  return (
    <>
      {before}
      {hit ? <mark>{hit}</mark> : null}
      {after}
    </>
  );
}

function EmptyStart({
  options,
  recents,
  optionProps,
  onRemove,
}: {
  options: Option[];
  recents: string[];
  optionProps(option: Option): OptionProps;
  onRemove(recent: string): void;
}) {
  const recentOptions = options.filter((option) => option.kind === 'reciente');
  const shortcutOptions = options.filter((option) => option.kind === 'atajo');
  const paste = options.find((option) => option.kind === 'pegar');
  return (
    <>
      {recents.length > 0 ? (
        <Section title="Recientes">
          {recentOptions.map((option) =>
            option.kind === 'reciente' ? (
              <div
                key={option.id}
                {...optionProps(option)}
                className={cx(optionProps(option).className, 'qs-opt--line')}
              >
                <Icon name="clock" size={18} className="qs-opt__lead" />
                <span className="qs-opt__text">
                  <b className="qs-opt__plain">{option.text}</b>
                </span>
                {/* Atajo del ratón: con el teclado se quita con Supr. */}
                <button
                  type="button"
                  className="qs-opt__x"
                  tabIndex={-1}
                  aria-hidden="true"
                  aria-label={`Quitar «${option.text}» de recientes`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(option.text);
                  }}
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
            ) : null,
          )}
        </Section>
      ) : null}
      <Section title="Atajos">
        <div className="qs-quick">
          {shortcutOptions.map((option) => {
            if (option.kind !== 'atajo') return null;
            const shortcut = SHORTCUTS.find((item) => item.key === option.key)!;
            return (
              <div
                key={option.id}
                {...optionProps(option)}
                className={cx(optionProps(option).className, 'qs-quick__item')}
              >
                <Icon name={shortcut.icon} size={20} className="qs-quick__icon" />
                {shortcut.label}
              </div>
            );
          })}
        </div>
      </Section>
      {paste ? (
        <Section title="Pegar un enlace">
          <div {...optionProps(paste)} className={cx(optionProps(paste).className, 'qs-opt--line')}>
            <Icon name="link" size={18} className="qs-opt__lead" />
            <span className="qs-opt__text">
              <b className="qs-opt__plain">acestream:// o Content ID</b>
            </span>
            <Icon name="paste" size={18} className="qs-opt__trail" />
          </div>
        </Section>
      ) : null}
    </>
  );
}

function MatchOption({
  item,
  query,
  today,
  score,
  ...props
}: OptionProps & {
  item: QuickMatch;
  query: string;
  today: string;
  score: LiveScore | null;
}) {
  const { match, phase } = item;
  const live = phase === 'live';
  const home = versusSide(match, 'home');
  const away = versusSide(match, 'away');
  const title = match.away ? `${home.name} – ${away.name}` : matchTitle(match);
  // Las fuentes del partido en directo: las del precalentado del servidor (si ya las sabe).
  const preheat = useApiQuery(
    'footballPreheat',
    { params: { matchId: match.id } },
    { enabled: live && (match.channels?.length ?? 0) > 0, staleTime: 30_000, retry: false },
  );
  const found = preheat.data?.preheat;
  const sources = found ? found.total || found.candidateCount : 0;
  const minute = liveMinute(score);
  const when = minute ? (minute.halftime ? 'Descanso' : `${minute.minute}'`) : 'Directo';
  const day = dayLabel(match.date, today);
  const dayText =
    day.primary === 'Hoy' || day.primary === 'Mañana'
      ? day.primary
      : `${day.primary} ${day.number}`;
  const rest = live
    ? [match.competition, sources ? `${sources} ${sources === 1 ? 'fuente' : 'fuentes'}` : null]
    : phase === 'done'
      ? ['Terminado', match.competition]
      : [dayText, match.time, match.competition];
  return (
    <div {...props}>
      <span className="qs-crests" aria-hidden="true">
        {[home, away].map((team, index) => (
          <TeamMark
            key={index}
            name={team.name}
            short={team.short}
            colors={team.colors}
            crest={team.crest}
            size={24}
            lit={live}
          />
        ))}
      </span>
      <span className="qs-opt__text">
        <b>
          <Marked text={title} query={query} />
        </b>
        <small>
          {live ? (
            <>
              <span className="qs-live-dot" aria-hidden="true" />
              <span className="qs-live">{when}</span>
              {' · '}
            </>
          ) : null}
          {rest.filter(Boolean).join(' · ')}
        </small>
      </span>
      {live ? (
        <span className="qs-go" aria-hidden="true">
          <Icon name="play" size={16} />
        </span>
      ) : null}
    </div>
  );
}

/** Ctrl+Intro en una película: el nombre y «Crear sala», aquí mismo (como «Ver juntos» de la ficha). */
function JuntosStep({
  card,
  onBack,
  onDone,
}: {
  card: VodCard;
  onBack(): void;
  onDone(code: string): void;
}) {
  const [name, setName] = useState(savedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, []);

  const create = async () => {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api('partyCreate', {
        body: {
          titleId: card.id,
          kind: 'movie',
          artId: card.id,
          poster: card.poster,
          title: card.title,
          subtitle: null,
          audio: null,
          name: clean,
        },
      });
      saveName(clean);
      saveCredential(created.room.code, created.member);
      onDone(created.room.code);
    } catch (failure) {
      setError(describeFailure(failure));
      setBusy(false);
    }
  };

  return (
    <form
      className="qs-juntos"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <div className="qs-field">
        <Icon name="personas" size={24} className="qs-field__icon" />
        <span className="qs-juntos__title">
          Ver juntos · <b>{card.title}</b>
        </span>
        <kbd className="qs-kbd">Esc</kbd>
      </div>
      <div className="qs-juntos__body">
        <label className="qs-juntos__label" htmlFor="qs-juntos-nombre">
          Tu nombre en la sala
        </label>
        <input
          ref={fieldRef}
          id="qs-juntos-nombre"
          className="qs-juntos__input"
          value={name}
          maxLength={24}
          autoComplete="nickname"
          enterKeyHint="go"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'qs-juntos-error' : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        {error ? (
          <p id="qs-juntos-error" className="qs-juntos__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="qs-juntos__acts">
          <Button type="button" variant="ghost" onClick={onBack}>
            Volver
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon="personas"
            busy={busy}
            disabled={!name.trim()}
          >
            Crear sala
          </Button>
        </div>
      </div>
    </form>
  );
}
