/* Hojas de la biblioteca: «Renombrar canal» (§13.5) y «Guardar favorito»
   (§13.4). Sustituyen a los modales `veilEdit` y `veilSave` de la 0.6.59, con
   sus mismos textos. El campo se enfoca al abrir y Intro guarda. */

import { useId, useRef, useState, type FormEvent } from 'react';
import { Button, TextField } from '../../ui/index.ts';
import { defaultFavoriteTitle } from './data.ts';

export interface RenameTarget {
  title: string;
}

export function RenameSheetBody({
  target,
  onSave,
  formId,
}: {
  target: RenameTarget;
  onSave(title: string): void;
  formId: string;
}) {
  const [value, setValue] = useState(target.title);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(value);
  };
  return (
    <form id={formId} onSubmit={submit} className="lib-sheet-form">
      <TextField
        label="Nuevo nombre"
        value={value}
        maxLength={120}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(event) => setValue(event.target.value)}
      />
    </form>
  );
}

export function RenameFooter({ formId, busy }: { formId: string; busy?: boolean }) {
  return (
    <Button variant="primary" type="submit" form={formId} busy={busy} block>
      Guardar cambios
    </Button>
  );
}

export interface FavoriteTarget {
  id: string;
  title: string;
  category?: string;
  ih?: boolean;
}

export function SaveFavoriteBody({
  target,
  onSave,
  formId,
}: {
  target: FavoriteTarget;
  onSave(title: string): void;
  formId: string;
}) {
  const [value, setValue] = useState(target.title);
  const hashId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(value);
  };
  return (
    <form id={formId} onSubmit={submit} className="lib-sheet-form">
      <TextField
        ref={inputRef}
        label="Nombre del canal"
        placeholder="Ej: DAZN LaLiga"
        value={value}
        maxLength={120}
        autoComplete="off"
        enterKeyHint="done"
        hint={value.trim() ? undefined : `Si lo dejas vacío: «${defaultFavoriteTitle(target.id)}»`}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="lib-hashbox">
        <span id={hashId} className="lib-hashbox__label">
          Hash
        </span>
        <code className="mono lib-hashbox__value" aria-labelledby={hashId}>
          {target.id}
        </code>
      </div>
    </form>
  );
}

export function SaveFavoriteFooter({ formId, busy }: { formId: string; busy?: boolean }) {
  return (
    <Button variant="primary" icon="star" type="submit" form={formId} busy={busy} block>
      Guardar en favoritos
    </Button>
  );
}
