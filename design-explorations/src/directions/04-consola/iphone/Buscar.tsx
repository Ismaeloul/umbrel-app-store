/* Consola · iPhone · Buscar: el panel de comandos adaptado (Tab(role: .search)
   + .searchable con searchScopes): campo arriba, ámbitos como chips, resultados
   agrupados, Content ID detectado. */

import { useEffect, useRef, useState } from 'react';
import { navigate } from '../../../core/router';
import { addManualSource, getState, openTarget, playChannel, setExpanded, toast, useNow, useSim } from '../../../core/store';
import { scoreAt } from '../../../core/score';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { Icon } from '../components/icons';
import { Dot } from '../components/ui';
import { compShort, idLabel, matchTitle, signalSummary } from '../components/lib';
import { SCOPES, useSearch, type ActionDef, type Result, type Scope } from '../components/search';
import { EmptyView, NavBar, Row, Section } from './ui';
import { openSheet } from './state';

function usePhoneActions(): ActionDef[] {
  const target = useSim((s) => s.player.target);
  return [
    { id: 'paste', label: 'Pegar Content ID', icon: 'clipboard', hint: 'reproduce una fuente externa', run: () => { const t = getState().player.target; if (t) openSheet({ type: 'paste', kind: t.kind, id: t.id }); else toast('Pega el Content ID aquí, en el buscador'); } },
    { id: 'where', label: 'Dónde se está reproduciendo', icon: 'radio', run: () => navigate('ajustes', 'donde') },
    { id: 'pair', label: 'Emparejar otro dispositivo', icon: 'qr', run: () => navigate('ajustes', 'dispositivos') },
    { id: 'gustos', label: 'Editar mis gustos', icon: 'heart', run: () => navigate('gustos') },
    { id: 'mode', label: 'Modo de reproducción', icon: 'play', run: () => navigate('ajustes', 'reproduccion') },
    { id: 'theme', label: 'Apariencia', icon: 'sun', run: () => navigate('ajustes', 'apariencia') },
    { id: 'lists', label: 'Listas', icon: 'list', run: () => navigate('ajustes', 'listas') },
    { id: 'health', label: 'Salud del sistema', icon: 'activity', run: () => navigate('ajustes', 'salud') },
    { id: 'now', label: 'Abrir lo que suena', icon: 'tv', when: !!target, run: () => setExpanded(true) },
  ];
}

export function Buscar({ hasMini }: { hasMini: boolean }) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const actions = usePhoneActions();
  const { groups, flat, loadingEngine, hash } = useSearch(q, actions, scope);
  const nowMs = useNow();
  const sessions = useSim((s) => s.sourceSessions);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const run = (r: Result) => {
    switch (r.kind) {
      case 'match':
        navigate('partido', r.id);
        break;
      case 'channel':
        navigate('canal', r.id);
        break;
      case 'engine':
        toast(`«${r.title}» se añade como fuente al próximo partido que abras`, 'ok');
        break;
      case 'action':
        r.action.run();
        break;
      case 'contentId': {
        const t = getState().player.target;
        if (t) {
          addManualSource(t.kind, t.id, r.hash);
          setExpanded(true);
        } else {
          openTarget('channel', r.hash);
          navigate('canal', r.hash);
        }
        break;
      }
    }
  };

  return (
    <>
      <NavBar title="Buscar" large />
      <div className="ip-search">
        <label className="ip-field">
          <Icon name={hash ? 'hash' : 'search'} size={16} className="co-ink-3" />
          <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Canal, partido, acción o Content ID" spellCheck={false} aria-label="Buscar" enterKeyHint="search" />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Borrar" style={{ color: 'var(--co-ink-3)' }}>
              <Icon name="x" size={14} strokeWidth={2.2} />
            </button>
          )}
        </label>
      </div>
      <div className="ip-scopes" role="tablist" aria-label="Ámbito">
        {SCOPES.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={scope === s.id} className={`ip-scope ${scope === s.id ? 'is-on' : ''}`} onClick={() => setScope(s.id)}>
            {s.prefix && <kbd>{s.prefix}</kbd>}
            {s.label}
          </button>
        ))}
      </div>
      <div className={`ip-scroll ${hasMini ? 'has-mini' : ''}`}>
        {hash && (
          <div className="ip-detected">
            <Icon name="check" size={14} strokeWidth={2.2} /> Enlace detectado · {idLabel(hash)}
          </div>
        )}
        {groups.map((g) => (
          <Section key={g.id} title={g.title} count={g.id === 'engine' ? (loadingEngine ? 'buscando…' : g.items.length) : g.items.length}>
            {g.id === 'engine' && !loadingEngine && g.items.length === 0 && <Row title={`El motor no encuentra nada con «${q}».`} />}
            {g.items.map((r) => (
              <ResultRow key={r.id} r={r} onRun={() => run(r)} sig={r.kind === 'match' ? signalSummary(sessions[`match:${r.id}`], r.match, nowMs) : null} />
            ))}
          </Section>
        ))}
        {!q && <EmptyView icon="search" title="Busca un canal o un partido" text="En tu biblioteca y en la agenda al instante; en el motor con dos letras o más. Si pegas un Content ID, se reproduce." />}
        {q && flat.length === 0 && !loadingEngine && <EmptyView icon="search" title={`Nada con «${q}»`} text="Prueba con otro nombre o cambia de ámbito." />}
        {!q && (
          <Section title="Ámbitos" inset>
            <Row title="@ partidos · # canales · > acciones" subtitle="Escribe el prefijo o toca un ámbito arriba" />
          </Section>
        )}
      </div>
    </>
  );
}

function ResultRow({ r, onRun, sig }: { r: Result; onRun: () => void; sig: ReturnType<typeof signalSummary> | null }) {
  const nowMs = useNow();
  switch (r.kind) {
    case 'match': {
      const sc = scoreAt(r.match, nowMs);
      return (
        <Row
          leading={<Dot tone={sc.state === 'in' ? 'live' : sc.state === 'post' ? 'idle' : 'queued'} />}
          title={matchTitle(r.match)}
          subtitle={
            <span className="co-row-flex" style={{ gap: 6 }}>
              <span className="ip-mono">{sc.state === 'in' ? sc.clock : sc.state === 'post' ? 'Final' : r.match.time}</span>
              <span>· {compShort(r.match)}</span>
              {sig && sig.tone !== 'queued' && sig.tone !== 'idle' && (
                <>
                  <Dot tone={sig.tone} size="sm" /> <span>{sig.short}</span>
                </>
              )}
            </span>
          }
          onClick={onRun}
          chevron
        />
      );
    }
    case 'channel':
      return <Row leading={<ChannelMark name={r.item.title} size={28} radius={7} />} title={r.item.title} subtitle={r.inLibrary === 'fav' ? 'Favoritos' : r.inLibrary === 'recent' ? 'Recientes' : r.item.category} onClick={onRun} chevron />;
    case 'engine':
      return (
        <Row
          leading={<Icon name="radio" size={18} className="co-ink-3" />}
          title={r.title}
          subtitle={
            <span className="co-row-flex" style={{ gap: 5 }}>
              <Dot tone={r.availability >= 0.6 ? 'ok' : r.availability > 0 ? 'weak' : 'fail'} size="sm" /> {Math.round(r.availability * 100)} % disponible · {r.category}
            </span>
          }
          onClick={onRun}
        />
      );
    case 'action':
      return <Row leading={<Icon name={r.action.icon} size={18} className="co-ink-3" />} title={r.action.label} subtitle={r.action.hint} onClick={onRun} chevron />;
    case 'contentId':
      return <Row leading={<Icon name="hash" size={18} className="co-ink-3" />} title={`Reproducir Content ID ${idLabel(r.hash)}`} subtitle="Solo en esta sesión; no se guarda" onClick={onRun} trailing={<Icon name="play" size={16} />} />;
  }
}

export { playChannel };
