/* Consola · hojas modales compartidas por la web (y reutilizadas en iPhone con
   otro envoltorio): Reportar, Pegar Content ID, Abrir en…, Renombrar, Añadir lista,
   Ayuda de atajos. La lógica es común; el envoltorio (Sheet) es el de la web. */

import { useState } from 'react';
import { SHORTCUT_TABLE } from '../../../core/keys';
import { addDirectory, addManualSource, renameItem, reportSource, toast, useSim } from '../../../core/store';
import type { Source } from '../../../core/types';
import { Button, Keys, Sheet } from './ui';
import { Icon } from './icons';
import { detectContentId, idLabel, REPORT_REASONS } from './lib';

// ---------------------------------------------------------------- Reportar

export function ReportBody({ source, index, reason, setReason }: { source: Source; index: number; reason: string; setReason: (r: string) => void }) {
  return (
    <div style={{ display: 'grid', gap: 2, paddingBottom: 8 }}>
      <p className="co-label" style={{ margin: '0 0 8px' }}>
        Fuente {index} · {source.listaName ?? 'Índice'} · {source.title}
      </p>
      {REPORT_REASONS.map((r) => (
        <button key={r.id} type="button" className={`co-option ${reason === r.id ? 'is-on' : ''}`} onClick={() => setReason(r.id)} role="radio" aria-checked={reason === r.id}>
          <span className="co-radio" />
          <span>{r.label}</span>
        </button>
      ))}
      <p className="co-label" style={{ margin: '8px 0 0' }}>
        La fuente se aparta un rato y se vuelve a comprobar en segundo plano. Si es el canal incorrecto, no se vuelve a proponer.
      </p>
    </div>
  );
}

export function ReportSheet({ kind, id, source, index, onClose }: { kind: 'match' | 'channel'; id: string; source: Source; index: number; onClose: () => void }) {
  const [reason, setReason] = useState('no_start');
  return (
    <Sheet
      title="Reportar fuente"
      subtitle="Qué está pasando con esta señal"
      icon="flag"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            kind="primary"
            onClick={() => {
              reportSource(kind, id, source.id, reason);
              onClose();
            }}
          >
            Reportar y comprobar
          </Button>
        </>
      }
    >
      <ReportBody source={source} index={index} reason={reason} setReason={setReason} />
    </Sheet>
  );
}

// ---------------------------------------------------------------- Pegar Content ID

export function PasteBody({ value, setValue, autoFocus }: { value: string; setValue: (v: string) => void; autoFocus?: boolean }) {
  const hash = detectContentId(value);
  return (
    <div style={{ display: 'grid', gap: 10, paddingBottom: 8 }}>
      <label className="co-field" style={{ height: 36 }}>
        <Icon name="hash" size={14} className="co-ink-3" />
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Content ID o enlace acestream://" spellCheck={false} autoFocus={autoFocus} className="co-mono" style={{ fontSize: 13 }} />
        <button
          type="button"
          className="co-btn co-btn--sm"
          onClick={async () => {
            try {
              const t = await navigator.clipboard.readText();
              setValue(t);
            } catch {
              toast('No se pudo leer el portapapeles', 'warn');
            }
          }}
        >
          Pegar
        </button>
      </label>
      <div className="co-row-flex" style={{ minHeight: 20 }}>
        {hash ? (
          <span className="co-chip co-chip--ok">
            <Icon name="check" size={12} /> Enlace detectado · {idLabel(hash)}
          </span>
        ) : value.trim() ? (
          <span className="co-chip">Aún no parece un Content ID (40 caracteres)</span>
        ) : (
          <span className="co-label">Solo para esta sesión: no se guarda ni se vincula al canal.</span>
        )}
      </div>
    </div>
  );
}

export function PasteSheet({ kind, id, onClose }: { kind: 'match' | 'channel'; id: string; onClose: () => void }) {
  const [value, setValue] = useState('');
  const hash = detectContentId(value);
  return (
    <Sheet
      title="Pegar Content ID"
      subtitle="Reproduce una fuente externa en este partido"
      icon="clipboard"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            kind="primary"
            icon="play"
            disabled={!hash}
            onClick={() => {
              if (!hash) return;
              addManualSource(kind, id, hash);
              onClose();
            }}
          >
            Reproducir
          </Button>
        </>
      }
    >
      <PasteBody value={value} setValue={setValue} autoFocus />
    </Sheet>
  );
}

// ---------------------------------------------------------------- Abrir en…

export function openInItems(source: Source | undefined) {
  return [
    {
      id: 'ace',
      label: 'Abrir en la app de AceStream',
      icon: 'external' as const,
      disabled: !source,
      run: () => toast('Abriendo en la app de AceStream…'),
    },
    {
      id: 'vlc',
      label: 'Abrir en VLC',
      icon: 'external' as const,
      disabled: !source,
      run: () => toast('Enlace para VLC copiado', 'ok'),
    },
    {
      id: 'copy',
      label: 'Copiar enlace acestream://',
      icon: 'link' as const,
      disabled: !source,
      run: () => {
        if (source) navigator.clipboard?.writeText(`acestream://${source.id}`).catch(() => undefined);
        toast('Enlace copiado', 'ok');
      },
    },
  ];
}

// ---------------------------------------------------------------- Renombrar

export function RenameSheet({ id, current, onClose }: { id: string; current: string; onClose: () => void }) {
  const [v, setV] = useState(current);
  return (
    <Sheet
      title="Renombrar canal"
      icon="edit"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            kind="primary"
            disabled={!v.trim()}
            onClick={() => {
              renameItem(id, v.trim());
              onClose();
            }}
          >
            Guardar
          </Button>
        </>
      }
    >
      <label className="co-field" style={{ marginBottom: 8, height: 36 }}>
        <input value={v} onChange={(e) => setV(e.target.value)} autoFocus />
      </label>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Añadir lista

export function AddListBody({ name, setName, url, setUrl, type, setType }: { name: string; setName: (v: string) => void; url: string; setUrl: (v: string) => void; type: 'm3u' | 'html'; setType: (v: 'm3u' | 'html') => void }) {
  return (
    <div style={{ display: 'grid', gap: 10, paddingBottom: 8 }}>
      <label className="co-field" style={{ height: 36 }}>
        <span className="co-label" style={{ width: 64 }}>
          Nombre
        </span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mi lista" autoFocus />
      </label>
      <label className="co-field" style={{ height: 36 }}>
        <span className="co-label" style={{ width: 64 }}>
          Dirección
        </span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" spellCheck={false} className="co-mono" style={{ fontSize: 12 }} />
      </label>
      <div className="co-row-flex">
        <span className="co-label" style={{ width: 64 }}>
          Formato
        </span>
        <div className="co-seg" role="tablist">
          <button type="button" className={type === 'm3u' ? 'is-on' : ''} onClick={() => setType('m3u')}>
            M3U
          </button>
          <button type="button" className={type === 'html' ? 'is-on' : ''} onClick={() => setType('html')}>
            Página web
          </button>
        </div>
      </div>
      <p className="co-label" style={{ margin: 0 }}>
        Hasta 8 listas; se actualizan cada 3 horas.
      </p>
    </div>
  );
}

export function AddListSheet({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<'m3u' | 'html'>('m3u');
  const ok = name.trim().length > 1 && /^https?:\/\/.+\..+/.test(url.trim());
  return (
    <Sheet
      title="Añadir una lista"
      icon="plus"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            kind="primary"
            disabled={!ok}
            onClick={() => {
              addDirectory(name.trim(), url.trim(), type);
              onClose();
            }}
          >
            Guardar lista
          </Button>
        </>
      }
    >
      <AddListBody name={name} setName={setName} url={url} setUrl={setUrl} type={type} setType={setType} />
    </Sheet>
  );
}

// ---------------------------------------------------------------- Ayuda de atajos

export const CONSOLA_SHORTCUTS: { keys: string; label: string; group: string }[] = [
  { keys: '⌘ K', label: 'Panel de comandos', group: 'General' },
  { keys: '↑ ↓', label: 'Mover la selección', group: 'Listas' },
  { keys: 'J K', label: 'Mover la selección (alternativa)', group: 'Listas' },
  { keys: 'Enter', label: 'Abrir lo seleccionado', group: 'Listas' },
  { keys: '[', label: 'Plegar la barra lateral', group: 'General' },
  { keys: '⌘ ,', label: 'Ajustes', group: 'General' },
];

export function HelpSheet({ onClose }: { onClose: () => void }) {
  const all = [...SHORTCUT_TABLE.filter((s) => !s.keys.startsWith('Mayús')), ...CONSOLA_SHORTCUTS];
  const groups = ['General', 'Listas', 'Reproductor', 'Fuentes'];
  return (
    <Sheet title="Atajos de teclado" subtitle="No actúan mientras escribes en un campo" icon="keyboard" onClose={onClose} width={560}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', paddingBottom: 12 }}>
        {groups.map((g) => (
          <section key={g} style={{ breakInside: 'avoid' }}>
            <h3 className="co-label" style={{ margin: '10px 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11 }}>
              {g}
            </h3>
            {all
              .filter((s) => s.group === g)
              .map((s) => (
                <div key={s.keys + s.label} className="co-row-flex" style={{ height: 30, borderBottom: '1px solid var(--co-line)' }}>
                  <span className="co-grow co-truncate">{s.label}</span>
                  <Keys keys={s.keys.replace('Espacio · K', 'Espacio').replace('1 – 9', '1–9')} />
                </div>
              ))}
          </section>
        ))}
      </div>
    </Sheet>
  );
}

/** Texto del reintento cuando nada funciona. */
export function useNoSignalText(kind: 'match' | 'channel', id: string): string | null {
  const session = useSim((s) => s.sourceSessions[`${kind}:${id}`]);
  if (!session) return null;
  const all = session.sources.every((x) => x.state === 'failed');
  if (!all) return null;
  return 'Ninguna fuente da señal ahora mismo';
}
