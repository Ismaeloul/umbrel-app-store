/* Consola · inspector (360 px): propiedades de lo seleccionado o de lo que
   suena, con el color del club como ambiente sutil. Variante «list» (junto a
   la lista) y «full» (junto al reproductor grande). */

import { useEffect, useState } from 'react';
import { navigate, useRoute } from '../../../core/router';
import { ensureSources, isFavorite, itemById, markCorrect, matchById, openTarget, playChannel, research, revealScore, stop, toggleFavorite, toggleTeamFollow, useNow, useSim } from '../../../core/store';
import { phaseOf, scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';
import { hhmm, secondsText, untilText } from '../../../core/format';
import type { Item, Match } from '../../../core/types';
import { Crest } from '../../../core/ui/Crest';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { Icon } from '../components/icons';
import { Bar, Button, Chip, ClubDot, Dot, IconButton, Keys, Menu, Prop, Props, useMenu } from '../components/ui';
import { VideoSurface } from '../components/video';
import { openInItems } from '../components/sheets';
import { channelNow, compLabel, idLabel, matchTitle, modeWord, playerTone, playerWord, signalSummary, sourceLabel, techRows, usePulse, useScoreHidden } from '../components/lib';
import { Controls } from './Player';
import { SourcesHeader, SourcesList } from './Sources';
import { openSheet, useUi } from './state';
import { openMatch } from './Agenda';

export function Inspector({ variant }: { variant: 'list' | 'full' }) {
  const selection = useUi((u) => u.selection);
  const route = useRoute();
  const kind = variant === 'full' ? (route.screen === 'canal' ? 'channel' : 'match') : selection?.kind;
  const id = variant === 'full' ? route.param : selection?.id;
  if (!kind || !id) return <InspectorEmpty />;
  if (kind === 'match') {
    const m = matchById(id);
    if (!m) return <InspectorEmpty />;
    return <MatchInspector m={m} variant={variant} key={m.id} />;
  }
  return <ChannelInspector id={id} variant={variant} key={id} />;
}

function InspectorEmpty() {
  return (
    <div className="co-inspector co-inspector--empty">
      <div className="co-empty">
        <span style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 8, background: 'var(--co-bg-3)', color: 'var(--co-ink-3)', marginBottom: 6 }}>
          <Icon name="layers" size={18} />
        </span>
        <strong>Nada seleccionado</strong>
        <p>Elige un partido o un canal para ver sus propiedades aquí.</p>
        <div className="co-row-flex" style={{ gap: 10, marginTop: 8 }}>
          <span className="co-row-flex" style={{ gap: 5 }}>
            <Keys keys="↑ ↓" /> <span className="co-label">mover</span>
          </span>
          <span className="co-row-flex" style={{ gap: 5 }}>
            <Keys keys="↵" /> <span className="co-label">abrir</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Partido

function MatchInspector({ m, variant }: { m: Match; variant: 'list' | 'full' }) {
  const nowMs = useNow();
  const sc = scoreAt(m, nowMs);
  const hidden = useScoreHidden(m.id);
  const player = useSim((s) => s.player);
  const isTarget = player.target?.kind === 'match' && player.target.id === m.id;
  const session = useSim((s) => s.sourceSessions[`match:${m.id}`]);
  const mode = useSim((s) => s.playbackMode);
  const menu = useMenu();
  const home = team(m.home);
  const away = team(m.away);
  const active = isTarget && session ? session.sources.find((x) => x.id === player.target?.sourceId) : undefined;
  const sig = signalSummary(session, m, nowMs);
  const phaseM = phaseOf(m, nowMs);
  const pulse = usePulse(sc.home + sc.away);
  const [details, setDetails] = useState(false);

  // Al seleccionar un partido cercano, preparamos sus fuentes (precalentado).
  useEffect(() => {
    if (Math.abs(m.start - nowMs) < 150 * 60000 && !session) ensureSources('match', m.id);
  }, [m.id]);

  const estado = isTarget ? (
    <>
      <Dot tone={playerTone(player)} /> {playerWord(player)}
      {player.sharedWith.length > 0 && <span className="co-label"> · también en {player.sharedWith.join(', ')}</span>}
    </>
  ) : phaseM === 'live' ? (
    <>
      <Dot tone="live" /> En directo · {sc.halftime ? 'descanso' : sc.clock}
    </>
  ) : phaseM === 'upcoming' ? (
    <>
      <Dot tone="queued" /> {untilText(m.start, nowMs)}
    </>
  ) : (
    <>
      <Dot tone="idle" /> Terminado
    </>
  );

  const senal = active ? (
    <>
      <Dot tone={sourceLabel(active, nowMs).tone} /> {sourceLabel(active, nowMs).word}
      {active.resolution && <span className="co-label"> · {active.resolution}</span>}
      <span className="co-label co-truncate"> · Fuente {session!.sources.indexOf(active) + 1}, {active.listaName ?? 'Índice'}</span>
    </>
  ) : (
    <>
      <Dot tone={sig.tone} /> <span className="co-truncate">{sig.text}</span>
    </>
  );

  const items = [
    isTarget ? { id: 'stop', label: 'Detener', icon: 'stop' as const, run: () => stop('usuario') } : { id: 'open', label: 'Ver ahora', icon: 'play' as const, keys: 'Enter', run: () => openMatch(m.id) },
    { id: 'reveal', label: hidden ? 'Ver marcador' : 'Tapar marcador', icon: hidden ? ('eye' as const) : ('eye-off' as const), run: () => revealScore(m.id, hidden), disabled: sc.state === 'pre' || !isTarget },
    { id: 'sep1', label: '', sep: true },
    { id: 'research', label: 'Rebuscar fuentes', icon: 'refresh' as const, run: () => research('match', m.id) },
    { id: 'paste', label: 'Pegar Content ID…', icon: 'clipboard' as const, run: () => openSheet({ type: 'paste', kind: 'match', id: m.id }) },
    { id: 'report', label: 'Reportar la fuente en pantalla…', icon: 'flag' as const, disabled: !active, run: () => active && openSheet({ type: 'report', kind: 'match', id: m.id, sourceId: active.id }) },
    { id: 'correct', label: 'Es el canal correcto', icon: 'check' as const, disabled: !active, run: () => active && markCorrect('match', m.id, active.id, true) },
    { id: 'sep2', label: '', sep: true },
    { id: 'fh', label: `Seguir a ${home.name}`, icon: 'star' as const, run: () => toggleTeamFollow(home.name) },
    { id: 'fa', label: `Seguir a ${away.name}`, icon: 'star' as const, run: () => toggleTeamFollow(away.name) },
    { id: 'sep3', label: '', sep: true },
    { id: 'head', label: '', head: 'Abrir en…' },
    ...openInItems(active),
  ];

  return (
    <div className="co-inspector" style={{ ['--co-home' as string]: home.primary, ['--co-away' as string]: away.primary }}>
      <div className="co-insp-ambient" aria-hidden="true" />
      <header className="co-insp-head">
        <span className="co-label co-truncate">{compLabel(m)}</span>
        <span className="co-grow" />
        {m.venue && <span className="co-label co-truncate">{m.venue}</span>}
        <IconButton icon="more" label="Acciones del partido" onClick={(e) => menu.openAt(e, 'right')} />
      </header>

      {variant === 'list' && (
        <div className="co-insp-score">
          <div className="co-insp-team">
            <Crest team={home} size={28} variant="flat" />
            <span className="co-truncate">{home.name}</span>
          </div>
          <div className={`co-insp-num co-num ${pulse ? 'is-goal' : ''}`}>
            {sc.state === 'pre' ? (
              <span className="co-mono co-insp-time">{m.time}</span>
            ) : hidden ? (
              <button type="button" className="co-insp-reveal" onClick={() => revealScore(m.id, true)} title="Ver marcador">
                <span>•</span>
                <span className="co-ink-3">–</span>
                <span>•</span>
              </button>
            ) : (
              <>
                <span>{sc.home}</span>
                <span className="co-ink-3">–</span>
                <span>{sc.away}</span>
              </>
            )}
          </div>
          <div className="co-insp-team is-away">
            <Crest team={away} size={28} variant="flat" />
            <span className="co-truncate">{away.name}</span>
          </div>
        </div>
      )}
      {variant === 'list' && sc.state !== 'pre' && (
        <div className="co-insp-clock">
          <span className={`co-mono ${sc.state === 'in' ? 'is-live' : ''}`}>{sc.state === 'post' ? 'Final' : sc.halftime ? 'Descanso' : sc.clock}</span>
          <Bar value={sc.progress} live={sc.state === 'in'} className="co-grow" />
          {hidden && (
            <button type="button" className="co-linkbtn" onClick={() => revealScore(m.id, true)}>
              Ver marcador
            </button>
          )}
        </div>
      )}
      {variant === 'list' && sc.state === 'pre' && (
        <div className="co-insp-clock">
          <span className="co-label">{untilText(m.start, nowMs)}</span>
          <span className="co-grow" />
          <span className="co-label">{m.round}</span>
        </div>
      )}

      {variant === 'list' && (
        <div className="co-insp-media">
          {isTarget ? (
            <>
              <VideoSurface radius={6} onDoubleClick={() => navigate('partido', m.id)} />
              <div className="co-insp-controls">
                <Controls />
              </div>
            </>
          ) : (
            <button type="button" className="co-insp-preview" onClick={() => openMatch(m.id)} style={{ ['--co-home' as string]: home.primary, ['--co-away' as string]: away.primary }}>
              <span className="co-insp-preview-crests">
                <Crest team={home} size={40} variant="flat" />
                <Crest team={away} size={40} variant="flat" />
              </span>
              <span className="co-btn co-btn--primary">
                <Icon name="play" size={14} /> Ver ahora <Keys keys="↵" />
              </span>
            </button>
          )}
        </div>
      )}

      <section className="co-insp-section">
        <h3 className="co-insp-title">Propiedades</h3>
        <Props>
          <Prop k="Estado">{estado}</Prop>
          <Prop k="Señal">{senal}</Prop>
          {isTarget && player.conn === 'activa' && (
            <Prop k="Retraso">
              <span className="co-mono">{player.behindS >= 1.25 ? `${Math.round(player.behindS)} s por detrás` : 'en directo'}</span>
              <span className="co-label">· colchón {secondsText(player.bufferS)}</span>
            </Prop>
          )}
          <Prop k="Modo">{modeWord(mode)}</Prop>
          <Prop k="Dónde se emite">
            <span className="co-row-flex" style={{ gap: 4, flexWrap: 'wrap' }}>
              {m.channels.map((c) => (
                <Chip key={c.id}>{c.name}</Chip>
              ))}
            </span>
          </Prop>
          {variant === 'full' && (
            <Prop k="Hora">
              <span className="co-mono">{hhmm(m.start)}</span>
              <span className="co-label">· {compLabel(m)}</span>
            </Prop>
          )}
        </Props>
      </section>

      <section className="co-insp-section">
        {session ? (
          <>
            <SourcesHeader session={session} kind="match" id={m.id} compact />
            <SourcesList session={session} kind="match" id={m.id} limit={variant === 'list' ? 6 : undefined} dense />
            {session.sources.every((x) => x.state === 'failed') && (
              <div className="co-insp-nosignal">
                <Dot tone="fail" />
                <span className="co-grow">Ninguna fuente da señal ahora mismo.</span>
                <Button size="sm" icon="refresh" onClick={() => research('match', m.id)}>
                  Rebuscar
                </Button>
                <Button size="sm" icon="clipboard" onClick={() => openSheet({ type: 'paste', kind: 'match', id: m.id })}>
                  Pegar Content ID
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="co-sources-head">
              <span className="co-h2">Fuentes</span>
              <span className="co-label">{phaseM === 'finished' ? 'El partido ha terminado' : 'Se comprueban 45 min antes del partido'}</span>
            </div>
            {phaseM !== 'finished' && (
              <Button size="sm" icon="refresh" onClick={() => ensureSources('match', m.id)} style={{ marginTop: 6 }}>
                Comprobar ahora
              </Button>
            )}
          </>
        )}
      </section>

      <section className="co-insp-section co-insp-section--last">
        <button type="button" className="co-insp-disclosure" onClick={() => setDetails((d) => !d)} aria-expanded={details}>
          <Icon name={details ? 'chevron-down' : 'chevron-right'} size={12} />
          <span className="co-insp-title" style={{ margin: 0 }}>
            Datos técnicos
          </span>
          {!details && isTarget && player.conn === 'activa' && (
            <span className="co-label co-mono">
              {player.stats.peers} pares · {(player.stats.speedDown / 125).toFixed(1).replace('.', ',')} Mbit/s
            </span>
          )}
        </button>
        {details && (
          <Props className="co-insp-tech">
            {isTarget ? (
              techRows(player, active).map((r) => (
                <Prop k={r.k} key={r.k}>
                  <span className="co-mono">{r.v}</span>
                  {r.k === 'Content ID' && active && <CopyBtn text={active.id} />}
                </Prop>
              ))
            ) : (
              <Prop k="Reproductor">
                <span className="co-label">Sin datos hasta que se reproduzca</span>
              </Prop>
            )}
          </Props>
        )}
      </section>

      {menu.state && <Menu at={menu.state} align={menu.state.align} onClose={menu.close} items={items} />}
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  return (
    <IconButton
      icon="copy"
      label="Copiar Content ID"
      style={{ width: 22, height: 22 }}
      iconSize={12}
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => undefined);
      }}
    />
  );
}

// ---------------------------------------------------------------- Canal

function ChannelInspector({ id, variant }: { id: string; variant: 'list' | 'full' }) {
  const item: Item | undefined = itemById(id);
  const title = item?.title ?? `Canal ${idLabel(id)}`;
  const nowMs = useNow();
  const agenda = useSim((s) => s.agenda);
  const player = useSim((s) => s.player);
  const isTarget = player.target?.kind === 'channel' && player.target.id === id;
  const session = useSim((s) => s.sourceSessions[`channel:${id}`]);
  const fav = useSim((s) => s.favorites.some((f) => f.id === id));
  const recent = useSim((s) => s.history.some((f) => f.id === id));
  const directories = useSim((s) => s.directories);
  const mode = useSim((s) => s.playbackMode);
  const menu = useMenu();
  const now = item ? channelNow(item, agenda, nowMs) : null;
  const active = isTarget && session ? session.sources.find((x) => x.id === player.target?.sourceId) : undefined;
  const [details, setDetails] = useState(false);
  const upcoming = item
    ? agenda
        .filter((m) => m.channels.some((c) => c.name === item.title) && phaseOf(m, nowMs) === 'upcoming')
        .sort((a, b) => a.start - b.start)
        .slice(0, 4)
    : [];
  const where = fav ? 'En tus favoritos' : recent ? 'En tus recientes' : item?.listaId ? `De tu lista ${directories.find((d) => d.id === item.listaId)?.name ?? ''}` : 'Fuera de tu biblioteca';

  const open = () => {
    playChannel(id);
    navigate('canal', id);
  };

  const items = [
    isTarget ? { id: 'stop', label: 'Detener', icon: 'stop' as const, run: () => stop('usuario') } : { id: 'open', label: 'Ver ahora', icon: 'play' as const, keys: 'Enter', run: open },
    { id: 'fav', label: fav ? 'Quitar de favoritos' : 'Guardar en favoritos', icon: fav ? ('star-filled' as const) : ('star' as const), run: () => toggleFavorite(id, title) },
    { id: 'rename', label: 'Renombrar…', icon: 'edit' as const, run: () => openSheet({ type: 'rename', id, title }), disabled: !item },
    { id: 'sep1', label: '', sep: true },
    { id: 'research', label: 'Rebuscar fuentes', icon: 'refresh' as const, run: () => research('channel', id) },
    { id: 'paste', label: 'Pegar Content ID…', icon: 'clipboard' as const, run: () => openSheet({ type: 'paste', kind: 'channel', id }) },
    { id: 'report', label: 'Reportar la fuente en pantalla…', icon: 'flag' as const, disabled: !active, run: () => active && openSheet({ type: 'report', kind: 'channel', id, sourceId: active.id }) },
    { id: 'sep2', label: '', sep: true },
    { id: 'head', label: '', head: 'Abrir en…' },
    ...openInItems(active ?? session?.sources[0]),
  ];

  return (
    <div className="co-inspector">
      <header className="co-insp-head">
        <ChannelMark name={title} size={22} radius={5} />
        <span className="co-h2 co-truncate" style={{ fontSize: 13 }}>
          {title}
        </span>
        <span className="co-grow" />
        <IconButton icon={fav ? 'star-filled' : 'star'} label={fav ? 'Quitar de favoritos' : 'Guardar en favoritos'} on={fav} onClick={() => toggleFavorite(id, title)} />
        <IconButton icon="more" label="Acciones del canal" onClick={(e) => menu.openAt(e, 'right')} />
      </header>

      {variant === 'list' && (
        <div className="co-insp-media">
          {isTarget ? (
            <>
              <VideoSurface radius={6} onDoubleClick={() => navigate('canal', id)} />
              <div className="co-insp-controls">
                <Controls />
              </div>
            </>
          ) : (
            <button type="button" className="co-insp-preview is-channel" onClick={open}>
              <ChannelMark name={title} size={44} radius={10} />
              <span className="co-btn co-btn--primary">
                <Icon name="play" size={14} /> Ver ahora <Keys keys="↵" />
              </span>
            </button>
          )}
        </div>
      )}

      <section className="co-insp-section">
        <h3 className="co-insp-title">Propiedades</h3>
        <Props>
          <Prop k="Estado">
            {isTarget ? (
              <>
                <Dot tone={playerTone(player)} /> {playerWord(player)}
              </>
            ) : (
              <>
                <Dot tone="idle" /> En reposo
              </>
            )}
          </Prop>
          {active && (
            <Prop k="Señal">
              <Dot tone={sourceLabel(active, nowMs).tone} /> {sourceLabel(active, nowMs).word}
              <span className="co-label"> · {active.resolution}</span>
            </Prop>
          )}
          {isTarget && player.conn === 'activa' && (
            <Prop k="Retraso">
              <span className="co-mono">{player.behindS >= 1.25 ? `${Math.round(player.behindS)} s por detrás` : 'en directo'}</span>
            </Prop>
          )}
          <Prop k="Ahora">
            {now ? (
              <button type="button" className="co-linkbtn co-truncate" onClick={() => openMatch(now.match.id)} title="Abrir el partido">
                {now.live && <Dot tone="live" size="sm" />}
                <ClubDot color={team(now.match.home).primary} /> {matchTitle(now.match)}
                <span className="co-label"> · {now.live ? scoreAt(now.match, nowMs).clock : hhmm(now.match.start)}</span>
              </button>
            ) : (
              <span className="co-label">Sin partido anunciado</span>
            )}
          </Prop>
          <Prop k="Biblioteca">{where}</Prop>
          <Prop k="Categoría">{item?.category ?? 'Canal suelto'}</Prop>
          {isTarget && <Prop k="Modo">{modeWord(mode)}</Prop>}
        </Props>
      </section>

      {session && (
        <section className="co-insp-section">
          <div className="co-sources-head">
            <span className="co-h2">Fuentes hermanas</span>
            <span className="co-label">{session.sources.length} del mismo canal · sin cambio automático</span>
            <span className="co-grow" />
            <IconButton icon="refresh" label="Rebuscar" onClick={() => research('channel', id)} disabled={session.research} />
          </div>
          <SourcesList session={session} kind="channel" id={id} dense />
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="co-insp-section">
          <h3 className="co-insp-title">Después en este canal</h3>
          {upcoming.map((m) => (
            <button key={m.id} type="button" className="co-insp-next" onClick={() => openMatch(m.id)}>
              <span className="co-mono co-label">{untilText(m.start, nowMs)}</span>
              <span className="co-truncate">{matchTitle(m)}</span>
            </button>
          ))}
        </section>
      )}

      <section className="co-insp-section co-insp-section--last">
        <button type="button" className="co-insp-disclosure" onClick={() => setDetails((d) => !d)} aria-expanded={details}>
          <Icon name={details ? 'chevron-down' : 'chevron-right'} size={12} />
          <span className="co-insp-title" style={{ margin: 0 }}>
            Datos técnicos
          </span>
        </button>
        {details && (
          <Props className="co-insp-tech">
            {isTarget ? (
              techRows(player, active).map((r) => (
                <Prop k={r.k} key={r.k}>
                  <span className="co-mono">{r.v}</span>
                  {r.k === 'Content ID' && active && <CopyBtn text={active.id} />}
                </Prop>
              ))
            ) : (
              <Prop k="Content ID">
                <span className="co-mono">{idLabel(id)}</span>
                <CopyBtn text={id} />
              </Prop>
            )}
          </Props>
        )}
      </section>
      {menu.state && <Menu at={menu.state} align={menu.state.align} onClose={menu.close} items={items} />}
    </div>
  );
}

export function isFav(id: string) {
  return isFavorite(id);
}

export { openTarget };
