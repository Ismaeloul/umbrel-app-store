/* Hojas modales de Pizarra. En web son diálogos centrados y opacos; en
   iPhone, hojas desde abajo con asa y arrastre para cerrar (sheet con
   detents en SwiftUI). Un solo anfitrión pinta la hoja abierta en `ui.sheet`. */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { addDirectory, addManualSource, claimPairing, isFavorite, markCorrect, removeRecent, renameItem, reportSource, research, selectSource, toast, toggleFavorite, useSim } from '../../../core/store';
import { navigate } from '../../../core/router';
import { SHORTCUT_TABLE } from '../../../core/keys';
import type { Source } from '../../../core/types';
import { Segmented } from './atoms';
import { REPORT_REASONS } from './data';
import { ICamera, ICheck, IClose, ICopy, IExternal, IFlag, ILink, IPaste, IRefresh, ISpeaker, IStar, ITrash, IPencil, IUsers } from './icons';
import { closeSheet, copyText, extractHash, openSheet, useUi, type SheetSpec } from './prefs';

export function SheetHost({ mode }: { mode: 'web' | 'phone' }) {
  const sheet = useUi((u) => u.sheet);
  const reduced = useSim((s) => s.reducedMotion);
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);
  const dur = reduced ? 0.1 : mode === 'phone' ? 0.24 : 0.18;
  return (
    <AnimatePresence>
      {sheet && (
        <motion.div key="bd" className="pz-sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: dur }} onClick={closeSheet} />
      )}
      {sheet && (mode === 'phone' ? <PhoneSheet key={`sh-${sheet.type}`} spec={sheet} dur={dur} reduced={reduced} /> : <WebDialog key={`dg-${sheet.type}`} spec={sheet} dur={dur} reduced={reduced} />)}
    </AnimatePresence>
  );
}

function WebDialog({ spec, dur, reduced }: { spec: NonNullable<SheetSpec>; dur: number; reduced: boolean }) {
  return (
    <motion.div
      className={`pz-dialog${spec.type === 'help' ? ' pz-dialog--wide' : ''}`}
      role="dialog"
      aria-modal="true"
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, x: '-50%', y: '-50%' }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, x: '-50%', y: '-50%' }}
      transition={{ duration: dur, ease: [0.2, 0.8, 0.2, 1] }}
      style={reduced ? { transform: 'translate(-50%,-50%)' } : undefined}
    >
      <SheetContent spec={spec} mode="web" />
    </motion.div>
  );
}

function PhoneSheet({ spec, dur, reduced }: { spec: NonNullable<SheetSpec>; dur: number; reduced: boolean }) {
  return (
    <motion.div
      className="pz-sheet"
      role="dialog"
      aria-modal="true"
      initial={reduced ? { opacity: 0 } : { y: '100%' }}
      animate={reduced ? { opacity: 1 } : { y: 0 }}
      exit={reduced ? { opacity: 0 } : { y: '100%' }}
      transition={{ duration: dur, ease: [0.2, 0.8, 0.2, 1] }}
      drag="y"
      dragConstraints={{ top: 0 }}
      dragElastic={0.05}
      onDragEnd={(_, info) => {
        if (info.offset.y > 90 || info.velocity.y > 600) closeSheet();
      }}
    >
      <div className="pz-sheet-handle" aria-hidden="true">
        <i />
      </div>
      <SheetContent spec={spec} mode="phone" />
    </motion.div>
  );
}

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="pz-sheet-head">
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      <button type="button" className="pz-tap" onClick={closeSheet} aria-label="Cerrar" style={{ minWidth: 36, minHeight: 36 }}>
        <IClose size={18} />
      </button>
    </div>
  );
}

function SheetContent({ spec, mode }: { spec: NonNullable<SheetSpec>; mode: 'web' | 'phone' }) {
  switch (spec.type) {
    case 'report':
      return <ReportSheet {...spec} />;
    case 'paste':
      return <PasteSheet {...spec} />;
    case 'open-in':
      return <OpenInSheet source={spec.source} title={spec.title} />;
    case 'help':
      return <HelpSheet />;
    case 'rename':
      return <RenameSheet id={spec.id} title={spec.title} />;
    case 'add-list':
      return <AddListSheet />;
    case 'scan':
      return <ScanSheet />;
    case 'source-actions':
      return <SourceActions {...spec} />;
    case 'channel-actions':
      return <ChannelActions id={spec.id} title={spec.title} />;
    case 'match-actions':
      return <MatchActions kind={spec.kind} id={spec.id} mode={mode} />;
  }
}

/* ---------- Reportar ---------- */
function ReportSheet({ kind, id, sourceId }: { kind: 'match' | 'channel'; id: string; sourceId: string }) {
  const [reason, setReason] = useState('no_start');
  const src = useSim((s) => s.sourceSessions[`${kind}:${id}`]?.sources.find((x) => x.id === sourceId));
  return (
    <>
      <Head title="Reportar fuente" sub={src ? `${src.matchedChannel} ${src.resolution} · ${src.listaName}` : undefined} />
      <div className="pz-sheet-body" role="radiogroup" aria-label="Motivo">
        {REPORT_REASONS.map((r) => (
          <button key={r.id} type="button" role="radio" aria-checked={reason === r.id} className={`pz-radio${reason === r.id ? ' is-on' : ''}`} onClick={() => setReason(r.id)}>
            <i />
            <span className="desc">{r.label}</span>
          </button>
        ))}
        <p className="pz-hint">La fuente se aparta un rato y se vuelve a comprobar en segundo plano. Si estaba sonando, saltamos a la siguiente verificada.</p>
      </div>
      <div className="pz-sheet-foot">
        <button type="button" className="pz-btn" onClick={closeSheet}>
          Cancelar
        </button>
        <button
          type="button"
          className="pz-btn pz-btn--primary"
          onClick={() => {
            reportSource(kind, id, sourceId, reason);
            closeSheet();
          }}
        >
          Reportar y comprobar
        </button>
      </div>
    </>
  );
}

/* ---------- Pegar Content ID ---------- */
function PasteSheet({ kind, id }: { kind: 'match' | 'channel'; id: string }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const hash = extractHash(value);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      setValue(t);
    } catch {
      toast('No se pudo leer el portapapeles: pégalo a mano', 'warn');
    }
  };
  const go = () => {
    if (!hash) return;
    addManualSource(kind, id, hash);
    closeSheet();
  };
  return (
    <>
      <Head title="Pegar Content ID" sub="Se añade solo a esta sesión: no se guarda ni se vincula." />
      <div className="pz-sheet-body">
        <div className="pz-field">
          <label htmlFor="pz-paste">Content ID o enlace acestream://</label>
          <input
            id="pz-paste"
            ref={ref}
            className="pz-input pz-input--mono"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go()}
            placeholder="acestream://… o 40 caracteres"
            autoComplete="off"
            spellCheck={false}
          />
          <span className={`pz-hint${hash ? ' is-ok' : value.length > 8 ? ' is-err' : ''}`}>{hash ? `Enlace detectado · ${hash.slice(0, 12)}…` : value.length > 8 ? 'Eso no parece un Content ID.' : 'Acepta el hash suelto, acestream:// o una URL que lo contenga.'}</span>
        </div>
        <button type="button" className="pz-btn" onClick={paste}>
          <IPaste size={16} /> Pegar del portapapeles
        </button>
      </div>
      <div className="pz-sheet-foot">
        <button type="button" className="pz-btn" onClick={closeSheet}>
          Cancelar
        </button>
        <button type="button" className="pz-btn pz-btn--primary" onClick={go} disabled={!hash}>
          Reproducir
        </button>
      </div>
    </>
  );
}

/* ---------- Abrir en… ---------- */
function OpenInSheet({ source, title }: { source: Source | null; title: string }) {
  const hash = source?.id ?? '';
  return (
    <>
      <Head title="Abrir en…" sub={title || undefined} />
      <div className="pz-sheet-body">
        <button
          type="button"
          className="pz-radio"
          onClick={() => {
            toast('Abriendo en la app AceStream…');
            closeSheet();
          }}
          disabled={!hash}
        >
          <IExternal size={18} />
          <span className="desc">
            App AceStream
            <small>Reproduce esta fuente en la aplicación oficial</small>
          </span>
        </button>
        <button
          type="button"
          className="pz-radio"
          onClick={() => {
            copyText(`http://umbrel.local:6878/ace/getstream?id=${hash}`);
            toast('Dirección para VLC copiada', 'ok');
            closeSheet();
          }}
          disabled={!hash}
        >
          <ICopy size={18} />
          <span className="desc">
            VLC
            <small>Copia la dirección de la señal para abrirla en VLC</small>
          </span>
        </button>
        <button
          type="button"
          className="pz-radio"
          onClick={() => {
            copyText(`acestream://${hash}`);
            toast('Enlace acestream:// copiado', 'ok');
            closeSheet();
          }}
          disabled={!hash}
        >
          <ILink size={18} />
          <span className="desc">
            Copiar enlace
            <small>acestream://… para compartirlo</small>
          </span>
        </button>
      </div>
    </>
  );
}

/* ---------- Ayuda de atajos ---------- */
const EXTRA_SHORTCUTS = [
  { keys: '↑ ↓', label: 'Moverse por los partidos de la pizarra', group: 'Pizarra' },
  { keys: 'Intro', label: 'Abrir el partido enfocado', group: 'Pizarra' },
  { keys: 'D', label: 'Densidad Cómodo / Compacto', group: 'Pizarra' },
  { keys: 'T', label: 'Para ti / Todos', group: 'Pizarra' },
];

function HelpSheet() {
  const all = [...SHORTCUT_TABLE, ...EXTRA_SHORTCUTS];
  const groups = [...new Set(all.map((s) => s.group))];
  return (
    <>
      <Head title="Atajos de teclado" sub="No actúan mientras escribes en un campo." />
      <div className="pz-sheet-body" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        {groups.map((g) => (
          <div key={g}>
            <div className="pz-label" style={{ marginBottom: 8 }}>
              {g}
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {all
                .filter((s) => s.group === g)
                .map((s) => (
                  <div key={s.keys} style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 10, alignItems: 'center', fontSize: 13 }}>
                    <span className="pz-kbd" style={{ justifySelf: 'start' }}>
                      {s.keys}
                    </span>
                    <span className="pz-muted">{s.label}</span>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------- Renombrar ---------- */
function RenameSheet({ id, title }: { id: string; title: string }) {
  const [v, setV] = useState(title);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const save = () => {
    if (v.trim()) renameItem(id, v.trim());
    closeSheet();
  };
  return (
    <>
      <Head title="Renombrar canal" />
      <div className="pz-sheet-body">
        <div className="pz-field">
          <label htmlFor="pz-rename">Nombre</label>
          <input id="pz-rename" ref={ref} className="pz-input" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </div>
      </div>
      <div className="pz-sheet-foot">
        <button type="button" className="pz-btn" onClick={closeSheet}>
          Cancelar
        </button>
        <button type="button" className="pz-btn pz-btn--primary" onClick={save} disabled={!v.trim()}>
          Guardar
        </button>
      </div>
    </>
  );
}

/* ---------- Añadir lista ---------- */
function AddListSheet() {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<'m3u' | 'html'>('m3u');
  const ok = name.trim().length > 1 && /^https?:\/\/\S+/.test(url.trim());
  const save = () => {
    addDirectory(name.trim(), url.trim(), type);
    closeSheet();
  };
  return (
    <>
      <Head title="Añadir una lista" sub="Hasta 8 listas; se actualizan solas cada 3 horas." />
      <div className="pz-sheet-body">
        <div className="pz-field">
          <label htmlFor="pz-ln">Nombre</label>
          <input id="pz-ln" className="pz-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mi lista" />
        </div>
        <div className="pz-field">
          <label htmlFor="pz-lu">Dirección</label>
          <input id="pz-lu" className="pz-input pz-input--mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" spellCheck={false} />
        </div>
        <div className="pz-field">
          <label>Formato</label>
          <Segmented value={type} onChange={setType} options={[{ id: 'm3u', label: 'Lista M3U' }, { id: 'html', label: 'Página web' }]} />
        </div>
      </div>
      <div className="pz-sheet-foot">
        <button type="button" className="pz-btn" onClick={closeSheet}>
          Cancelar
        </button>
        <button type="button" className="pz-btn pz-btn--primary" onClick={save} disabled={!ok}>
          Guardar y sincronizar
        </button>
      </div>
    </>
  );
}

/* ---------- Escáner QR simulado ---------- */
function ScanSheet() {
  return (
    <>
      <Head title="Escanear el código QR" sub="Apunta al código que enseña la web en Ajustes › Dispositivos." />
      <div className="pz-sheet-body">
        <div style={{ aspectRatio: '1 / 1', borderRadius: 12, background: '#0a0c10', display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 28, border: '2px solid rgba(255,255,255,.7)', borderRadius: 14, maskImage: 'linear-gradient(#000,#000)' }} aria-hidden="true" />
          <ICamera size={40} style={{ color: 'rgba(255,255,255,.4)' }} />
        </div>
        <p className="pz-hint">En el prototipo no hay cámara: simula la lectura con el botón.</p>
      </div>
      <div className="pz-sheet-foot">
        <button
          type="button"
          className="pz-btn pz-btn--primary"
          onClick={() => {
            claimPairing('482913');
            closeSheet();
          }}
        >
          Simular la lectura del QR
        </button>
      </div>
    </>
  );
}

/* ---------- acciones de fuente (iPhone) ---------- */
function SourceActions({ kind, id, sourceId }: { kind: 'match' | 'channel'; id: string; sourceId: string }) {
  const src = useSim((s) => s.sourceSessions[`${kind}:${id}`]?.sources.find((x) => x.id === sourceId));
  const title = useSim((s) => s.player.target?.title ?? '');
  const run = (fn: () => void) => () => {
    fn();
    closeSheet();
  };
  return (
    <>
      <Head title={src ? `${src.matchedChannel} ${src.resolution}` : 'Fuente'} sub={src ? `${src.listaName}` : undefined} />
      <div className="pz-sheet-body">
        <button type="button" className="pz-radio" onClick={run(() => selectSource(kind, id, sourceId))}>
          <ISpeaker size={18} />
          <span className="desc">Ver esta fuente</span>
        </button>
        <button type="button" className="pz-radio" onClick={run(() => markCorrect(kind, id, sourceId, true))}>
          <ICheck size={18} />
          <span className="desc">Es el canal correcto</span>
        </button>
        <button type="button" className="pz-radio" onClick={run(() => markCorrect(kind, id, sourceId, false))}>
          <IFlag size={18} />
          <span className="desc">No es este canal</span>
        </button>
        <button type="button" className="pz-radio" onClick={() => openSheet({ type: 'open-in', source: src ?? null, title })}>
          <IExternal size={18} />
          <span className="desc">Abrir en…</span>
        </button>
        <button type="button" className="pz-radio" onClick={run(() => { copyText(sourceId); toast('Content ID copiado', 'ok'); })}>
          <ICopy size={18} />
          <span className="desc">Copiar Content ID</span>
        </button>
        <button type="button" className="pz-radio" style={{ color: 'var(--pz-fail-ink)' }} onClick={() => openSheet({ type: 'report', kind, id, sourceId })}>
          <IFlag size={18} />
          <span className="desc">Reportar…</span>
        </button>
      </div>
    </>
  );
}

/* ---------- acciones de canal (iPhone) ---------- */
function ChannelActions({ id, title }: { id: string; title: string }) {
  const fav = useSim((s) => s.favorites.some((f) => f.id === id));
  const recent = useSim((s) => s.history.some((f) => f.id === id));
  const run = (fn: () => void) => () => {
    fn();
    closeSheet();
  };
  return (
    <>
      <Head title={title} />
      <div className="pz-sheet-body">
        <button type="button" className="pz-radio" onClick={run(() => toggleFavorite(id, title))}>
          <IStar size={18} filled={fav} />
          <span className="desc">{fav ? 'Quitar de favoritos' : 'Guardar en favoritos'}</span>
        </button>
        <button type="button" className="pz-radio" onClick={() => openSheet({ type: 'rename', id, title })}>
          <IPencil size={18} />
          <span className="desc">Renombrar</span>
        </button>
        <button type="button" className="pz-radio" onClick={() => openSheet({ type: 'open-in', source: null, title })}>
          <IExternal size={18} />
          <span className="desc">Abrir en…</span>
        </button>
        <button type="button" className="pz-radio" onClick={run(() => { copyText(id); toast('Content ID copiado', 'ok'); })}>
          <ICopy size={18} />
          <span className="desc">Copiar Content ID</span>
        </button>
        {recent && (
          <button type="button" className="pz-radio" style={{ color: 'var(--pz-fail-ink)' }} onClick={run(() => removeRecent(id))}>
            <ITrash size={18} />
            <span className="desc">Quitar de recientes</span>
          </button>
        )}
      </div>
    </>
  );
}

/* ---------- acciones del partido / canal en el centro (iPhone) ---------- */
function MatchActions({ kind, id }: { kind: 'match' | 'channel'; id: string; mode: 'web' | 'phone' }) {
  const src = useSim((s) => {
    const t = s.player.target;
    if (!t?.sourceId) return null;
    return s.sourceSessions[`${t.kind}:${t.id}`]?.sources.find((x) => x.id === t.sourceId) ?? null;
  });
  const title = useSim((s) => s.player.target?.title ?? '');
  const run = (fn: () => void) => () => {
    fn();
    closeSheet();
  };
  return (
    <>
      <Head title="Más" />
      <div className="pz-sheet-body">
        <button type="button" className="pz-radio" onClick={run(() => research(kind, id))}>
          <IRefresh size={18} />
          <span className="desc">
            Rebuscar
            <small>Busca más señales sin parar la que suena</small>
          </span>
        </button>
        <button type="button" className="pz-radio" onClick={() => openSheet({ type: 'paste', kind, id })}>
          <IPaste size={18} />
          <span className="desc">Pegar Content ID</span>
        </button>
        <button type="button" className="pz-radio" onClick={() => openSheet({ type: 'open-in', source: src, title })}>
          <IExternal size={18} />
          <span className="desc">Abrir en…</span>
        </button>
        <button type="button" className="pz-radio" onClick={run(() => navigate('ajustes', 'donde'))}>
          <IUsers size={18} />
          <span className="desc">Dónde se está reproduciendo</span>
        </button>
      </div>
    </>
  );
}

export function useIsFav(id: string) {
  return useSim(() => isFavorite(id));
}
