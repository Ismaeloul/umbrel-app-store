/* Teatro de un canal suelto (`?vista=partido/canal/<hash>`; plan Palco fase
   2, decisión W5): lo que se abre al reproducir desde Canales, el buscador,
   «Pegar hash» o el zapping. Bajo el vídeo, la cabecera del canal (su tesela
   16:9 con la sigla sobre su tono, «Canal», el nombre y de dónde viene) con
   «Reproducir» cuando hace falta y, debajo (o en el panel lateral), las
   pestañas: Fuentes (solo si hay fuentes HERMANAS del mismo canal, regla
   23: ≥ 92 por nombre; sin hermanas no hay selector, §7.1) · Canal (su ficha
   y sus acciones) · Datos técnicos. Aquí nunca se salta de fuente sola
   (reproductor.md §4.4: en la biblioteca, nunca). */

import type { Item, LibraryView } from '@ace/shared';
import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useApiQuery } from '../../api/index.ts';
import { useLayout } from '../../app/layout.tsx';
import { kindFromIh, play, usePlayerSelector } from '../../player/api.ts';
import { Button, ChannelMark, IconButton, Num } from '../../ui/index.ts';
import { findKnownItem } from '../library/model.ts';
import { librarySiblings } from '../sources/model.ts';
import { enterChannel, leaveSession, startChannel, useSession } from '../sources/session.ts';
import { SourcesPanel } from '../sources/SourcesPanel.tsx';
import type { InspectorTarget } from '../sources/SourceInspector.tsx';
import type { SourceListVariant } from '../sources/SourceList.tsx';
import { NerdSection } from './NerdSection.tsx';
import { TheaterTabs, type TheaterTabDef } from './TheaterTabs.tsx';
import { CHANNEL_HINTS, ShortcutHints } from './WhereAired.tsx';

export interface ChannelContext {
  title: string;
  item: Item | null;
  siblings: Item[];
  target: InspectorTarget;
  library: LibraryView | undefined;
  /**
   * Es un canal de tu IPTV (id sintético de favoritos o recientes, `iptvIds`):
   * sin Content ID que enseñar, copiar ni abrir en AceStream (docs/iptv.md §14.5).
   */
  iptvId: boolean;
}

/** Lo que se sabe del canal: su ficha en la biblioteca (si está) y lo que dice el reproductor. */
export function useChannelContext(hash: string): ChannelContext {
  const library = useApiQuery('libraryGet').data;
  const playerTitle = usePlayerSelector((state) =>
    state.channel?.hash === hash ? state.channel.title : null,
  );
  return useMemo(() => {
    const item = findKnownItem(library, hash) ?? null;
    const title = item?.title || playerTitle || `Canal ${hash.slice(0, 8)}`;
    const iptvId = Object.hasOwn(library?.iptvIds ?? {}, hash);
    return {
      title,
      item,
      siblings: librarySiblings(library, hash),
      target: {
        hash,
        title,
        ih: iptvId ? false : item?.ih === true,
        learned: false,
        ...(iptvId ? { iptv: true, iptvId: true } : {}),
      },
      library,
      iptvId,
    };
  }, [library, hash, playerTitle]);
}

function originText(item: Item | null, library: LibraryView | undefined): string {
  if (!item) return 'Fuera de tu biblioteca';
  if (library?.favorites.some((fav) => fav.id === item.id)) return 'En tus favoritos';
  if (item.type === 'web') {
    const list = library?.webSources.find(
      (source) => source.id === library.activeWebSourceId,
    )?.name;
    return list ? `De tu lista ${list}` : 'De tu lista';
  }
  return 'En tus recientes';
}

/** Cuántas fuentes del mismo canal hay (0 si solo está él). */
function siblingCount(siblings: readonly Item[]): number {
  return siblings.length > 1 ? siblings.length : 0;
}

/** La ficha del canal (pestaña «Canal»): de dónde viene, cuántas hermanas y su Content ID (no si es de tu IPTV). */
function ChannelDetails({ hash, context }: { hash: string; context: ChannelContext }) {
  const count = siblingCount(context.siblings);
  return (
    <div className="mc-channel-info">
      <dl className="mc-facts">
        <div className="mc-facts__row">
          <dt>Origen</dt>
          <dd>{originText(context.item, context.library)}</dd>
        </div>
        <div className="mc-facts__row">
          <dt>Fuentes del mismo canal</dt>
          <dd>{count ? <Num value={count} /> : 'Solo esta'}</dd>
        </div>
        {context.iptvId ? null : (
          <div className="mc-facts__row mc-facts__row--hash">
            <dt>{context.target.ih ? 'Infohash' : 'Content ID'}</dt>
            <dd className="mono">{hash}</dd>
          </div>
        )}
      </dl>
      <ShortcutHints hints={CHANNEL_HINTS} />
    </div>
  );
}

export interface ChannelTabsProps {
  hash: string;
  context: ChannelContext;
  variant: SourceListVariant;
  extra?: ReactNode;
  className?: string;
}

/** Las pestañas de un canal: Fuentes (con hermanas) · Canal · Datos técnicos. */
export function ChannelTabs({ hash, context, variant, extra, className }: ChannelTabsProps) {
  const count = useSession((state) => (state.kind === 'channel' ? state.entries.length : 0));
  const sources = (
    <SourcesPanel variant={variant} channelFallback={context.target} className="mc-sources" />
  );
  const details = <ChannelDetails hash={hash} context={context} />;
  const tabs: TheaterTabDef[] = count
    ? [
        { value: 'fuentes', label: 'Fuentes', count, content: sources },
        { value: 'canal', label: 'Canal', content: details },
      ]
    : [
        // Sin hermanas no hay selector (§7.1), pero sí las acciones del canal.
        {
          value: 'canal',
          label: 'Canal',
          content: (
            <>
              {sources}
              {details}
            </>
          ),
        },
      ];
  tabs.push({ value: 'datos', label: 'Datos técnicos', content: <NerdSection /> });
  return <TheaterTabs kind="channel" tabs={tabs} extra={extra} className={className} />;
}

export function ChannelCenter({ hash, active }: { hash: string; active: boolean }) {
  const layout = useLayout();
  const context = useChannelContext(hash);
  const { title, item, siblings, library } = context;
  /* «Reproducir» solo si hace falta: ni con el canal en pantalla ni mientras
     va a arrancar solo (enterChannel lo reproduce si el reproductor sigue en
     reposo desde el inicio). Antes salía un instante al abrir el canal y, al
     quitarse, las fuentes subían de golpe (CLS 0,13 en el móvil; revisión de
     rendimiento de la Fase 2). */
  // Lo que suena puede ser otra fuente del MISMO canal (su IPTV o una hermana).
  const ownIds = useSession((state) =>
    state.key === `c:${hash}` ? state.entries.map((entry) => entry.id).join(',') : '',
  );
  /* useStore se queda con el selector del PRIMER render: `ownIds` llega
     después (cuando la sesión del canal ya tiene sus fuentes), así que la
     decisión se toma aquí, fuera del selector, con lo que suena. */
  const player = usePlayerSelector((state) => ({
    phase: state.phase,
    playing: state.channel?.hash ?? null,
    idleReason: state.idleReason,
  }));
  const showPlay = (() => {
    const idle = player.phase === 'idle' || player.phase === 'error';
    const { playing } = player;
    if (playing && !idle && (playing === hash || ownIds.split(',').includes(playing))) return false;
    const autoStarts =
      player.phase === 'idle' &&
      playing !== hash &&
      (player.idleReason === 'inicio' || player.idleReason === null);
    return !autoStarts;
  })();
  // Con IPTV activa, mientras se pregunta si el canal está en ella (≤ 2,5 s) va a arrancar solo.
  const asking = useSession((state) => state.key === `c:${hash}` && state.phase === 'resolving');
  const siblingsKey = siblings.map((sibling) => sibling.id).join(',');

  /* Las pestañas se montan DESPUÉS de entrar al canal, en el mismo pintado:
     enterChannel va en un efecto de maquetación y `entered` vuelve a pintar
     antes de que el navegador enseñe nada. Montadas antes, su primer pintado
     salía vacío (la sesión aún no existía y su suscripción llega en un efecto
     normal, ya pintado) y al llenarse empujaban lo de debajo fuera de la
     pantalla (CLS 0,05 en el móvil; revisión de rendimiento de la Fase 2). */
  const [entered, setEntered] = useState(false);
  // Sin la biblioteca no se sabe si es un id IPTV (que nunca va al motor, §14.4).
  const libraryReady = useApiQuery('libraryGet').status !== 'pending';
  useLayoutEffect(() => {
    if (!active) return;
    enterChannel({
      hash,
      title,
      siblings,
      activeListId: library?.activeWebSourceId ?? null,
      libraryReady,
    });
    setEntered(true);
    return () => leaveSession();
    // Se vuelve a entrar si cambian el canal, su nombre, sus hermanas (no por identidad) o llega la biblioteca.
  }, [active, hash, title, siblingsKey, libraryReady]);

  const count = siblingCount(siblings);
  const desktop = layout.kind === 'desktop' || layout.kind === 'wide';
  return (
    <div className="mc mc--channel" data-layout={layout.kind}>
      <section className="mc-channel" aria-labelledby={`mc-canal-${hash}`}>
        <ChannelMark name={title} shape="tile" size={72} className="mc-channel__mark" />
        <div className="mc-channel__text">
          <p className="mc-channel__kicker">Canal</p>
          <h1 id={`mc-canal-${hash}`} className="mc-channel__title" tabIndex={-1}>
            {title}
          </h1>
          <p className="mc-channel__meta">
            {originText(item, library)}
            {count ? ` · ${count} fuentes del mismo canal` : ''}
          </p>
        </div>
        {showPlay && !asking ? (
          <Button
            variant="primary"
            icon="play"
            className="mc-channel__play"
            onClick={() =>
              // Un id IPTV no va nunca al motor: pasa por la sesión del canal (§14.4).
              context.iptvId
                ? startChannel({
                    hash,
                    title,
                    kind: 'id',
                    record: true,
                    ih: false,
                    iptv: hash,
                    ...(item?.alias ? { alias: item.alias } : {}),
                  })
                : play(
                    { hash, title, kind: kindFromIh(item?.ih) },
                    { origin: 'library', route: { vista: 'partido', id: null, canal: hash } },
                  )
            }
          >
            Reproducir
          </Button>
        ) : null}
      </section>
      {layout.asideVisible || !entered ? null : (
        <ChannelTabs
          hash={hash}
          context={context}
          variant={desktop ? 'rack' : 'list'}
          className="mc-tabs--view"
          extra={
            layout.asideAvailable ? (
              <IconButton
                icon="panel"
                label="Mostrar el panel lateral"
                onClick={() => layout.setAsideOpen(true)}
              />
            ) : null
          }
        />
      )}
    </div>
  );
}
