/* «Reproducir otro hash» (inventario-front §7.5 y §8.7): pegar un Content ID,
   un enlace `acestream://` o una URL con `?id=`/`?content_id=`.

   - La validación es la de TODO el sistema, `normalizeHash` de @ace/shared
     (la misma que usa el servidor): si cada sitio tuviera la suya, el mismo
     canal podría entrar dos veces.
   - Se valida a cada tecla; el botón está deshabilitado mientras no vale y
     el error sale en cuanto hay algo escrito que no sirve. Intro reproduce.
   - Al reproducir no se apunta en Recientes (`record: false`) ni se vincula a
     ningún partido; el título es el del canal si ya lo tienes en la
     biblioteca y, si no, `Stream {8 primeros}` (index.html:3949).
   - Con permiso de portapapeles (contexto seguro) hay un botón «Pegar»: en el
     móvil ahorra la pulsación larga sobre el campo.

   Cada vista monta su propia hoja (la biblioteca, el buscador...); el centro
   de partido puede reutilizarla con `onSubmit` para meter el hash como fuente
   manual del partido en vez de navegar. */

import { normalizeHash } from '@ace/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useApiQuery } from '../../api/index.ts';
import { useNavigate } from '../../app/router.tsx';
import { haptic } from '../../lib/haptics.ts';
import { notify } from '../../notices/index.ts';
import { Button, IconButton, Sheet, TextField } from '../../ui/index.ts';
import { findKnownItem } from '../library/model.ts';
import { playChannel } from '../library/play.ts';
import './paste-hash.css';

export const INVALID_HASH_MESSAGE =
  'Introduce un Content ID o enlace AceStream válido de 40 caracteres.';

/** Título para un hash pegado: el suyo si ya está en la biblioteca, si no `Stream abcd1234`. */
export function pastedTitle(hash: string, knownTitle?: string | null): string {
  return knownTitle?.trim() || `Stream ${hash.slice(0, 8)}`;
}

export interface PasteHashSheetProps {
  open: boolean;
  onClose(): void;
  /**
   * Qué hacer con el hash válido. Por defecto, reproducirlo (navegar al
   * centro de partido con `partido/canal/<hash>`).
   */
  onSubmit?(hash: string): void;
}

function canReadClipboard(): boolean {
  try {
    return Boolean(globalThis.isSecureContext && navigator.clipboard?.readText);
  } catch {
    return false;
  }
}

export function PasteHashSheet({ open, onClose, onSubmit }: PasteHashSheetProps) {
  const navigate = useNavigate();
  const library = useApiQuery('libraryGet', undefined, { enabled: open });
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const hash = normalizeHash(value);
  const showError = value.trim().length > 0 && !hash;

  const close = () => {
    onClose();
    setValue('');
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!hash) {
      notify('Pega un ID AceStream válido de 40 caracteres o un enlace acestream://', {
        tone: 'warn',
      });
      return;
    }
    close();
    // Content ID pegado: toque de éxito (HAPTIC_MAP).
    haptic('success');
    if (onSubmit) {
      onSubmit(hash);
      return;
    }
    const known = findKnownItem(library.data, hash);
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

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setValue(text.trim());
      inputRef.current?.focus();
    } catch {
      notify('No se pudo leer el portapapeles. Pega el enlace en el campo.', { tone: 'warn' });
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Reproducir otro hash"
      size="sm"
      initialFocus={inputRef}
      description={
        <p className="paste__eyebrow">
          <strong>Fuente externa</strong> · Añádela solo a esta sesión
        </p>
      }
      footer={
        <Button variant="primary" icon="play" type="submit" form={formId} disabled={!hash} block>
          Reproducir hash
        </Button>
      }
    >
      <form id={formId} className="paste" onSubmit={submit} noValidate>
        <TextField
          ref={inputRef}
          label="Content ID o enlace AceStream"
          placeholder="acestream://…"
          icon="hash"
          value={value}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          inputMode="url"
          error={showError ? INVALID_HASH_MESSAGE : null}
          hint="Acepta un hash de 40 caracteres, un enlace acestream:// o una URL con el ID. No se vinculará automáticamente al canal ni se guardará en favoritos."
          onChange={(event) => setValue(event.target.value)}
          trailing={
            value ? (
              <IconButton
                icon="x"
                label="Borrar Content ID"
                className="paste__clear"
                onClick={() => {
                  setValue('');
                  inputRef.current?.focus();
                }}
              />
            ) : null
          }
        />
        {hash ? (
          <p className="paste__ok" aria-live="polite">
            Hash detectado: <code className="mono">{hash}</code>
          </p>
        ) : null}
        {canReadClipboard() ? (
          <Button variant="quiet" icon="paste" size="sm" onClick={() => void pasteFromClipboard()}>
            Pegar del portapapeles
          </Button>
        ) : null}
      </form>
    </Sheet>
  );
}
