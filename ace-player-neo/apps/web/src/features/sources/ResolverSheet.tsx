/* «Encontrar canal» (inventario §5.2). Se abre cuando la resolución no
   encuentra una señal clara: con candidatos («Elige la señal que quieres
   usar») o sin ninguno («No hemos encontrado el canal»).

   - Nada ambiguo se reproduce sin que lo confirmes (regla 24): cada
     candidato es un botón y solo al pulsarlo suena, directamente, sin
     esperar al comprobador.
   - «Recordar mi elección para {canal}» viene marcado: se vincula el canal
     (`POST /api/v1/football/bindings`) y, si falla, suena igual con aviso.
   - «Vincular a mano» siempre está: pegar un Content ID lo vincula al canal
     para la próxima vez.
   - Arreglos de la 0.6.59: la disponibilidad se lee como porcentaje (§29.9:
     «0.91 fuentes») y copiar el nombre funciona también por HTTP (§29.10). */

import { normalizeHash } from '@ace/shared';
import { useId, useRef, useState, type FormEvent } from 'react';
import { notify } from '../../notices/index.ts';
import { copyText } from '../../player/clipboard.ts';
import { Button, Icon, IconButton, Sheet, TextField } from '../../ui/index.ts';
import { availabilityPercent, checkedLabel, INVALID_HASH_TEXT, resolutionSourceLabel } from './model.ts';
import { bindManual, chooseCandidate, openResolver, resolverChannel, useSession } from './session.ts';

export function ResolverSheet() {
  const open = useSession((state) => state.resolverOpen);
  const state = useSession((s) => s);
  const resolution = state.resolution;
  const channel = resolverChannel(state);
  const [remember, setRemember] = useState(true);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const firstChoice = useRef<HTMLButtonElement>(null);
  const formId = useId();
  const rememberId = useId();

  const choices = resolution?.candidates ?? [];
  const notFound = resolution?.status !== 'choices';
  const heading = notFound ? 'No hemos encontrado el canal' : 'Elige la señal que quieres usar';
  const copy = notFound
    ? resolution?.engineAvailable === false
      ? 'Revisamos tus listas, pero el buscador AceStream no estaba disponible. Puedes introducirlo manualmente.'
      : 'No aparece en tus listas ni en el buscador AceStream. Puedes buscarlo fuera y pegarlo aquí.'
    : 'Hay varias coincidencias posibles. No reproduciremos ninguna sin que la confirmes.';

  const close = () => {
    openResolver(false);
    setError(null);
  };

  const submitManual = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    if (!normalizeHash(value)) {
      setError(INVALID_HASH_TEXT);
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const problem = await bindManual(value);
      setError(problem);
      if (!problem) setValue('');
    } finally {
      setBusy(false);
    }
  };

  const choose = async (index: number) => {
    const candidate = choices[index];
    if (!candidate || busy) return;
    setBusy(true);
    try {
      await chooseCandidate(
        { id: candidate.id, title: candidate.title, ih: candidate.ih, source: candidate.source },
        remember,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Encontrar canal"
      size="md"
      initialFocus={choices.length ? firstChoice : inputRef}
    >
      <div className="src-resolve">
        <div className="src-resolve__summary">
          <span className="src-resolve__icon" aria-hidden="true">
            <Icon name={notFound ? 'buscar' : 'tv'} size={24} />
          </span>
          <div>
            <h3 className="src-resolve__title">{heading}</h3>
            <p className="src-resolve__copy">{copy}</p>
          </div>
        </div>
        {resolution?.checked.length ? (
          <ul className="src-resolve__checked" aria-label="Lo que se ha revisado">
            {resolution.checked.map((item) => (
              <li key={item}>{checkedLabel(item)} ✓</li>
            ))}
          </ul>
        ) : null}
        {choices.length ? (
          <>
            <ul className="src-resolve__choices">
              {choices.map((candidate, index) => {
                const percent = availabilityPercent(candidate.availability);
                return (
                  <li key={candidate.id}>
                    <button
                      ref={index === 0 ? firstChoice : undefined}
                      type="button"
                      className="src-resolve__choice press"
                      disabled={busy}
                      onClick={() => void choose(index)}
                    >
                      <span className="src-resolve__choice-text">
                        <strong>{candidate.title}</strong>
                        <small>
                          {resolutionSourceLabel(candidate.source)}
                          {percent !== null ? ` · ${percent}% disponible` : ''}
                        </small>
                      </span>
                      <Icon name="play" size={20} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <label className="src-resolve__remember" htmlFor={rememberId}>
              <input
                id={rememberId}
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              <span>
                Recordar mi elección para <strong>{channel}</strong>
              </span>
            </label>
          </>
        ) : null}
        <form id={formId} className="src-resolve__manual" onSubmit={(event) => void submitManual(event)} noValidate>
          <h4>¿Lo has encontrado por tu cuenta?</h4>
          <p>Pega el Content ID o enlace AceStream. Lo vincularemos a este canal para la próxima vez.</p>
          <div className="src-resolve__channel">
            <code>{channel}</code>
            <IconButton
              icon="copy"
              label="Copiar nombre del canal"
              onClick={() =>
                void copyText(channel).then((ok) =>
                  notify(ok ? 'Nombre del canal copiado' : 'No se pudo copiar el nombre', {
                    tone: ok ? 'ok' : 'warn',
                    icon: 'copy',
                  }),
                )
              }
            />
          </div>
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
            error={error}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
          />
          <Button variant="primary" icon="link" type="submit" busy={busy} block>
            Vincular y reproducir
          </Button>
        </form>
      </div>
    </Sheet>
  );
}
