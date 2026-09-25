/* Hojas del centro de partido: Reportar (5 motivos), Pegar Content ID y
   Abrir en… (AceStream / VLC). */

import { useEffect, useState } from 'react';
import { addManualSource, reportSource, toast } from '../../../core/store';
import type { Source } from '../../../core/types';
import { Field, Key } from './Key';
import { ActionSheet, Sheet } from './Sheet';
import { IcExternal, IcLink, IcPaste } from './icons';
import { pasteHash } from './text';

const REASONS: { id: string; label: string; hint: string }[] = [
  { id: 'no_start', label: 'No arranca', hint: 'Se queda sintonizando y no llega imagen' },
  { id: 'cuts', label: 'Se corta', hint: 'Arranca pero se para cada poco' },
  { id: 'wrong_channel', label: 'Canal incorrecto', hint: 'Emite otra cosa' },
  { id: 'quality', label: 'Mala calidad', hint: 'Imagen a bloques o borrosa' },
  { id: 'audio', label: 'Problema de audio', hint: 'Sin sonido o desincronizado' },
];

export function ReportSheet({ open, onClose, source, kind, id, mode }: { open: boolean; onClose: () => void; source: Source | null; kind: 'match' | 'channel'; id: string; mode: 'web' | 'phone' }) {
  const [reason, setReason] = useState('no_start');
  useEffect(() => {
    if (open) setReason('no_start');
  }, [open]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Reportar fuente"
      subtitle={source ? source.title : undefined}
      mode={mode}
      footer={
        <>
          <Key variant="ghost" onClick={onClose}>
            Cancelar
          </Key>
          <Key
            variant="orange"
            onClick={() => {
              if (source) reportSource(kind, id, source.id, reason);
              onClose();
            }}
          >
            Reportar y comprobar
          </Key>
        </>
      }
    >
      <div className="tr-radio-list" role="radiogroup" aria-label="Motivo">
        {REASONS.map((r) => (
          <button key={r.id} type="button" role="radio" aria-checked={reason === r.id} className={`tr-radio${reason === r.id ? ' is-on' : ''}`} onClick={() => setReason(r.id)}>
            <i />
            <span>
              <span>{r.label}</span>
              <small>{r.hint}</small>
            </span>
          </button>
        ))}
      </div>
      <p className="tr-sheet-text">La fuente se aparta un rato y se vuelve a comprobar en segundo plano. Si estaba sonando, pasamos a la siguiente que funcione.</p>
    </Sheet>
  );
}

export function PasteSheet({ open, onClose, kind, id, mode, onPlay }: { open: boolean; onClose: () => void; kind: 'match' | 'channel'; id: string; mode: 'web' | 'phone'; onPlay?: (hash: string) => void }) {
  const [value, setValue] = useState('');
  useEffect(() => {
    if (open) setValue('');
  }, [open]);
  const hash = pasteHash(value);
  const fromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      setValue(t);
    } catch {
      toast('No se pudo leer el portapapeles: pega el enlace a mano');
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Pegar Content ID"
      subtitle={onPlay ? 'Se reproduce como canal suelto, sin guardarlo' : 'Una fuente externa, solo para esta emisión'}
      mode={mode}
      footer={
        <>
          <Key variant="ghost" onClick={onClose}>
            Cancelar
          </Key>
          <Key
            variant="orange"
            disabled={!hash}
            onClick={() => {
              if (hash) {
                if (onPlay) onPlay(hash);
                else addManualSource(kind, id, hash);
              }
              onClose();
            }}
          >
            Reproducir
          </Key>
        </>
      }
    >
      <Field mono value={value} onChange={(e) => setValue(e.target.value)} placeholder="Content ID o enlace acestream://" autoFocus={mode === 'web'} spellCheck={false} autoCapitalize="off" leading={<IcLink size={18} />} />
      <div className="tr-paste-row">
        <Key size="sm" icon={<IcPaste size={16} />} onClick={fromClipboard}>
          Pegar del portapapeles
        </Key>
        {value && !hash && <span className="tr-paste-hint tr-tone-yellow">No parece un Content ID (40 caracteres)</span>}
        {hash && <span className="tr-paste-hint tr-tone-green">Enlace detectado</span>}
      </div>
    </Sheet>
  );
}

export function OpenInSheet({ open, onClose, mode }: { open: boolean; onClose: () => void; mode: 'web' | 'phone' }) {
  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Abrir en…"
      mode={mode}
      actions={[
        { label: 'App de AceStream', hint: 'Abre esta fuente en la app AceStream', icon: <IcExternal />, run: () => toast('Abriendo en la app de AceStream…') },
        { label: 'VLC', hint: 'Copia el enlace para «Abrir ubicación de red»', icon: <IcExternal />, run: () => toast('Enlace copiado: pégalo en VLC', 'ok') },
        { label: 'Copiar enlace acestream://', icon: <IcLink />, run: () => toast('Enlace copiado', 'ok') },
      ]}
    />
  );
}
