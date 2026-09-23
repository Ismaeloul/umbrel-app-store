/* «Tu agenda»: hoja de preferencias (inventario §4). Sustituye al modal
   `veilOnboarding` de la 0.6.59 y NUNCA bloquea (regla 35): se puede cerrar
   siempre, también si guardar falla.

   La abren la tarjeta de primer uso y el vacío de «Para ti» (agenda) y
   «Editar mis gustos» (Ajustes). Para usarla desde otra vista:

     import { PreferencesSheet } from '../preferences/PreferencesSheet.tsx';
     <PreferencesSheet open={abierta} onClose={() => setAbierta(false)} />

   Cada chip conmuta su selección sobre un BORRADOR (aria-pressed); nada se
   guarda hasta «Guardar y ver mi agenda». En el móvil es una hoja desde abajo
   con la botonera fija (por encima del teclado: la Sheet usa --kb). */

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useAppMode } from '../../api/index.ts';
import { notify } from '../../notices/index.ts';
import { Button, Chip, Sheet, TextField } from '../../ui/index.ts';
import { modeAfterSaving } from '../agenda/state.ts';
import {
  addCustomValue,
  chipsFor,
  draftFrom,
  flagFor,
  hasAny,
  PREFERENCE_MAX,
  PREFERENCE_TEXT_MAX,
  preferencesBody,
  toggleValue,
  type PreferenceDraft,
  type PreferenceKind,
} from './model.ts';
import { usePreferences, useSavePreferences } from './usePreferences.ts';
import './preferences.css';

export interface PreferencesSheetProps {
  open: boolean;
  onClose(): void;
  /** «Ahora no» en el primer uso; «Cancelar» el resto de veces. */
  cancelLabel?: string;
}

interface SectionCopy {
  number: string;
  title: string;
  hint: string;
  placeholder: string;
  addLabel: string;
  fullText: string;
}

const COPY: Record<PreferenceKind, SectionCopy> = {
  leagues: {
    number: '01',
    title: 'Tus ligas',
    hint: 'Selecciona todas las que sigues.',
    placeholder: 'Añadir otra liga…',
    addLabel: 'Añadir liga',
    fullText: `Has llegado al máximo de ${PREFERENCE_MAX.leagues} ligas.`,
  },
  teams: {
    number: '02',
    title: 'Tus equipos',
    hint: 'Marca los tuyos o añade otro.',
    placeholder: 'Añadir otro equipo…',
    addLabel: 'Añadir equipo',
    fullText: `Has llegado al máximo de ${PREFERENCE_MAX.teams} equipos.`,
  },
  nationalities: {
    number: '03',
    title: 'Nacionalidades',
    hint: 'Selecciones y fútbol de los países que sigues.',
    placeholder: 'Añadir otro país…',
    addLabel: 'Añadir país',
    fullText: `Has llegado al máximo de ${PREFERENCE_MAX.nationalities} nacionalidades.`,
  },
};

function PreferenceSection({
  kind,
  draft,
  onChange,
  disabled,
}: {
  kind: PreferenceKind;
  draft: PreferenceDraft;
  onChange(next: PreferenceDraft): void;
  disabled: boolean;
}) {
  const copy = COPY[kind];
  const headingId = useId();
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const full = draft[kind].length >= PREFERENCE_MAX[kind];

  const add = () => {
    const result = addCustomValue(draft, kind, text);
    if (result.full) setMessage(copy.fullText);
    else if (!result.added) setMessage(null);
    else {
      onChange(result.draft);
      setText('');
      setMessage(null);
    }
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    }
  };

  return (
    <section className="prefs-section" aria-labelledby={headingId}>
      <div className="prefs-section__head">
        <span className="prefs-section__n" aria-hidden="true">
          {copy.number}
        </span>
        <div>
          <h3 id={headingId} className="prefs-section__title">
            {copy.title}
          </h3>
          <p className="prefs-section__hint">{copy.hint}</p>
        </div>
      </div>
      <div className="prefs-chips" role="group" aria-labelledby={headingId}>
        {chipsFor(kind, draft).map((name) => {
          const pressed = draft[kind].includes(name);
          return (
            <Chip
              key={name}
              pressed={pressed}
              disabled={disabled || (!pressed && full)}
              onClick={() => onChange(toggleValue(draft, kind, name))}
            >
              {kind === 'nationalities' ? (
                <>
                  <span className="prefs-flag" aria-hidden="true">
                    {flagFor(name)}
                  </span>
                  {name}
                </>
              ) : (
                name
              )}
            </Chip>
          );
        })}
      </div>
      <div className="prefs-add">
        <TextField
          ref={inputRef}
          label={copy.placeholder.replace('…', '')}
          hideLabel
          placeholder={copy.placeholder}
          value={text}
          maxLength={PREFERENCE_TEXT_MAX[kind]}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          enterKeyHint="done"
          autoComplete="off"
        />
        <Button size="sm" icon="plus" aria-label={copy.addLabel} onClick={add} disabled={disabled}>
          Añadir
        </Button>
      </div>
      <p className="prefs-section__message" aria-live="polite">
        {message ?? (full ? copy.fullText : '')}
      </p>
    </section>
  );
}

export function PreferencesSheet({
  open,
  onClose,
  cancelLabel = 'Cancelar',
}: PreferencesSheetProps) {
  const mode = useAppMode();
  const { preferences } = usePreferences();
  const save = useSavePreferences();
  const [draft, setDraft] = useState<PreferenceDraft>(() => draftFrom(preferences));
  const [basis, setBasis] = useState(preferences);
  const [touched, setTouched] = useState(false);
  const [failed, setFailed] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);

  // Al abrir, el borrador parte de lo guardado (openPreferences de la 0.6.59).
  // Se ajusta durante el render y no en un efecto: así el primer pintado de
  // la hoja ya enseña los chips correctos. Si lo guardado llega (o cambia en
  // otro dispositivo) mientras la hoja está abierta y aún no has tocado nada,
  // el borrador se pone al día; si ya has tocado algo, manda lo tuyo.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(draftFrom(preferences));
      setBasis(preferences);
      setTouched(false);
      setFailed(false);
    }
  } else if (open && !touched && basis !== preferences) {
    setBasis(preferences);
    setDraft(draftFrom(preferences));
  }

  const edit = (next: PreferenceDraft) => {
    setTouched(true);
    setDraft(next);
  };

  const saving = save.isPending;

  const onSave = async () => {
    setFailed(false);
    try {
      const data = await save.mutateAsync({ body: preferencesBody(preferences, draft) });
      const has = hasAny(data.preferences);
      modeAfterSaving(has);
      notify(
        has ? 'Tu agenda ya está personalizada' : 'Puedes personalizar tu agenda cuando quieras',
        {
          tone: 'ok',
          icon: 'check',
        },
      );
      onClose();
    } catch {
      // Nada queda bloqueado: el aviso lo dice y la hoja se puede cerrar (regla 35).
      setFailed(true);
    }
  };

  const note = failed
    ? 'No pudimos guardar tus gustos. Puedes cerrar y reintentarlo luego.'
    : mode === 'demo'
      ? 'En la demo se guardan únicamente en este navegador.'
      : 'Tus gustos se guardan en Ace Player Neo y se comparten entre tus dispositivos.';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="¿Qué fútbol te mueve?"
      size="lg"
      className="prefs-sheet"
      description={
        <>
          <span className="prefs-eyebrow">Tu agenda</span>
          <span className="prefs-lede">
            Elige tus competiciones, equipos y nacionalidades. Los usaremos para ordenar la agenda;
            siempre podrás ver todos los partidos.
          </span>
        </>
      }
      footer={
        <>
          <Button variant="quiet" onClick={onClose} disabled={saving}>
            {cancelLabel}
          </Button>
          <Button variant="primary" onClick={() => void onSave()} busy={saving}>
            Guardar y ver mi agenda
          </Button>
        </>
      }
    >
      <div className="prefs-body">
        <PreferenceSection kind="leagues" draft={draft} onChange={edit} disabled={saving} />
        <PreferenceSection kind="teams" draft={draft} onChange={edit} disabled={saving} />
        <PreferenceSection kind="nationalities" draft={draft} onChange={edit} disabled={saving} />
        <p
          className="prefs-note"
          data-tone={failed ? 'error' : undefined}
          role={failed ? 'alert' : undefined}
        >
          {note}
        </p>
      </div>
    </Sheet>
  );
}

export default PreferencesSheet;
