/* Ajustes → IPTV (docs/iptv.md §1), con la piel «Palco» de «Listas»:
   formulario «Conectar tu IPTV» (M3U o Xtream Codes) y, con IPTV guardada,
   su tarjeta con el estado, «Usar la IPTV», «Actualizar», «Cambiar datos» y
   «Eliminar» con segundo toque.

   Higiene con los secretos (§1.4):
   - se llama con `api()` directo, NUNCA con useApiMutation: TanStack guarda
     `variables` en la caché de mutaciones;
   - ni el cuerpo ni la respuesta pasan por console ni por diagnósticos;
   - los campos se vacían al guardar, al cancelar y al ocultarse o
     desmontarse la sección (Activity conserva el estado de React);
   - el servidor nunca devuelve la URL, el usuario ni la contraseña: en
     «Cambiar datos» los secretos llegan vacíos y, si no se escriben, no se
     mandan (ausente = el guardado).

   Guardar hace la prueba rápida en el servidor y no guarda si falla; el
   recuento de canales llega después por SSE (`iptv.status`, que invalida
   `iptvGet`) o, sin SSE, sondeando cada 3 s como mucho 2 min. */

import { IPTV_CLIENT, type IptvProviderView, type IptvView } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent, type Ref } from 'react';
import { api, routeKey, routePrefix, useApiQuery, useRealtimeStatus } from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { notify } from '../../notices/index.ts';
import {
  Button,
  Capsule,
  EmptyState,
  Icon,
  IconButton,
  Segmented,
  SkeletonRows,
  Switch,
  TextField,
} from '../../ui/index.ts';
import { CONFIRM_DELETE_MS, looksPrivateUrl } from '../directories/model.ts';
import { useSecondTap } from '../settings/second-tap.ts';
import {
  accountLine,
  capsuleOf,
  EMPTY_FORM,
  editForm,
  guideLine,
  hostLine,
  IPTV_DELETE_NOTE,
  IPTV_EDIT_TITLE,
  IPTV_FORM_TITLE,
  IPTV_KIND_LABEL,
  IPTV_NAME_MAX,
  IPTV_NAME_PLACEHOLDER,
  IPTV_PAUSE_HELP,
  IPTV_PRIVACY_NOTE,
  IPTV_PRIVATE_HINT,
  IPTV_SAVED_PASSWORD,
  IPTV_SAVED_URL,
  IPTV_SAVED_USERNAME,
  IPTV_SAVING,
  IPTV_SECRET_MAX,
  IPTV_SERVER_PLACEHOLDER,
  IPTV_TOASTS,
  IPTV_URL_MAX,
  IPTV_URL_PLACEHOLDER,
  iptvErrorMessage,
  isEmptyFieldMessage,
  metaLine,
  needsSecrets,
  refreshingText,
  staleLine,
  syncedText,
  syncingText,
  validateForm,
  type IptvField,
  type IptvFieldErrors,
  type IptvForm,
  type IptvKind,
} from './model.ts';
import './IptvSection.css';

type Note = { tone: 'info' | 'ok' | 'err'; text: string } | null;
type Busy = 'save' | 'sync' | 'toggle' | 'delete' | null;
/** Lo que se espera que llegue por `iptv.status` tras guardar o actualizar. */
type Awaiting = { kind: 'save' | 'sync'; name: string; since: number } | null;

/** Los secretos fuera del estado: se llama al guardar, cancelar y ocultar. */
function withoutSecrets(form: IptvForm): IptvForm {
  return form.username || form.password || form.url
    ? { ...form, username: '', password: '', url: '' }
    : form;
}

function StatusLine({ note, id }: { note: Note; id?: string }) {
  return (
    <p
      id={id}
      className={cx('dir-status', note && `dir-status--${note.tone}`)}
      role={note?.tone === 'err' ? 'alert' : 'status'}
      aria-live="polite"
    >
      {note ? (
        <>
          <Icon
            name={note.tone === 'err' ? 'aviso' : note.tone === 'ok' ? 'check' : 'refresh'}
            size={16}
          />
          {note.text}
        </>
      ) : null}
    </p>
  );
}

export function IptvSection() {
  const client = useQueryClient();
  const realtime = useRealtimeStatus();
  const [awaiting, setAwaiting] = useState<Awaiting>(null);
  const query = useApiQuery('iptvGet', undefined, {
    // Sin SSE, se sondea mientras dure la sincronización (§1.5), 2 min como mucho.
    refetchInterval: (q) => {
      if (realtime === 'open') return false;
      const syncing = q.state.data?.provider?.status === 'syncing';
      const since = awaiting?.since ?? q.state.dataUpdatedAt;
      return syncing && Date.now() - since < IPTV_CLIENT.syncPollMaxMs
        ? IPTV_CLIENT.syncPollMs
        : false;
    },
  });
  const view = query.data;
  const provider = view?.provider ?? null;

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<IptvForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<IptvFieldErrors>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<Note>(null);
  const confirm = useSecondTap(CONFIRM_DELETE_MS);
  const fieldRefs = useRef<Partial<Record<IptvField, HTMLInputElement | null>>>({});
  const titleId = useId();
  /* Foco al cambiar entre la tarjeta y el formulario: sin esto se queda en
     <body> y un lector de pantalla pierde el sitio. */
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const editRef = useRef<HTMLButtonElement | null>(null);
  const focusAfter = useRef<'title' | 'edit' | null>(null);
  const hasProvider = provider !== null;
  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === 'title') titleRef.current?.focus();
    else if (target === 'edit') editRef.current?.focus();
  }, [editing, hasProvider]);

  // Al ocultarse (Activity) o desmontarse, fuera los secretos escritos.
  useEffect(() => () => setForm(withoutSecrets), []);

  const apply = (next: IptvView) => client.setQueryData(routeKey('iptvGet'), next);
  /* `bootstrap.features.iptv` (iptvActive) lo refresca el SSE; sin SSE, aquí. */
  const refreshBoot = () => {
    if (realtime !== 'open')
      void client.invalidateQueries({ queryKey: routePrefix('bootstrap'), refetchType: 'all' });
  };

  // Lo que llega por SSE (o por el sondeo) cierra el «Descargando los canales…».
  useEffect(() => {
    if (!awaiting || !provider || provider.status === 'syncing') return;
    setAwaiting(null);
    refreshBoot();
    if (provider.status === 'ok') {
      setNote({
        tone: 'ok',
        text: syncedText(provider.name, provider.channels, view?.refreshHours ?? 6),
      });
      notify(
        awaiting.kind === 'save'
          ? IPTV_TOASTS.saved(provider.channels)
          : IPTV_TOASTS.synced(provider.channels),
        { tone: 'ok', icon: 'tv' },
      );
    } else if (provider.status === 'error' && provider.error) {
      setNote({ tone: 'err', text: provider.error.message });
      if (awaiting.kind === 'save')
        notify(IPTV_TOASTS.saveFailed(provider.error.message), { tone: 'err' });
    }
  }, [awaiting, provider, view?.refreshHours]);

  const update = (patch: Partial<IptvForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    const touched = Object.keys(patch) as Array<keyof IptvForm>;
    if (touched.some((key) => key in errors))
      setErrors((current) => {
        const next = { ...current };
        for (const key of touched) delete next[key as IptvField];
        return next;
      });
  };

  const openEdit = (target: IptvProviderView) => {
    confirm.disarm();
    setForm(editForm(target));
    setErrors({});
    setNote(null);
    focusAfter.current = 'title';
    setEditing(true);
  };

  const cancelEdit = () => {
    setForm(EMPTY_FORM);
    setErrors({});
    setNote(null);
    focusAfter.current = 'edit';
    setEditing(false);
  };

  const save = async () => {
    const saved = editing ? provider : null;
    const result = validateForm(form, saved);
    if (!result.ok) {
      // Como en «Listas»: un campo vacío se avisa en tono «warn»; una dirección
      // que no es http(s), bajo su campo. En los dos casos, el foco va a él.
      const message = result.errors[result.first] ?? '';
      const empty = isEmptyFieldMessage(message);
      setErrors(empty ? {} : result.errors);
      fieldRefs.current[result.first]?.focus();
      if (empty) notify(message, { tone: 'warn' });
      return;
    }
    setErrors({});
    setBusy('save');
    setNote({ tone: 'info', text: IPTV_SAVING });
    try {
      const next = await api('iptvSave', { body: result.body });
      apply(next);
      // Guardado: los secretos se van del formulario y del DOM.
      focusAfter.current = 'edit';
      setForm(EMPTY_FORM);
      setEditing(false);
      const name = next.provider?.name ?? result.body.name ?? 'IPTV';
      if (next.provider?.status === 'syncing') {
        setNote({ tone: 'info', text: syncingText(name) });
        setAwaiting({ kind: 'save', name, since: Date.now() });
      } else if (next.provider) {
        setNote({
          tone: 'ok',
          text: syncedText(name, next.provider.channels, next.refreshHours),
        });
        notify(IPTV_TOASTS.saved(next.provider.channels), { tone: 'ok', icon: 'tv' });
      }
      haptic('success');
    } catch (error) {
      const message = iptvErrorMessage(error, form.kind);
      setNote({ tone: 'err', text: message });
      notify(IPTV_TOASTS.saveFailed(message), { tone: 'err' });
      haptic('error');
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (enabled: boolean) => {
    setBusy('toggle');
    try {
      apply(await api('iptvUpdate', { body: { enabled } }));
      refreshBoot();
      haptic('selection');
      notify(enabled ? IPTV_TOASTS.enabled : IPTV_TOASTS.paused, {
        tone: 'ok',
        icon: 'tv',
      });
    } catch (error) {
      notify(iptvErrorMessage(error), { tone: 'err' });
    } finally {
      setBusy(null);
    }
  };

  const sync = async (target: IptvProviderView) => {
    setBusy('sync');
    setNote({ tone: 'info', text: refreshingText(target.name) });
    try {
      const next = await api('iptvSync');
      apply(next);
      setAwaiting({ kind: 'sync', name: target.name, since: Date.now() });
    } catch (error) {
      setNote({ tone: 'err', text: iptvErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      apply(await api('iptvDelete'));
      refreshBoot();
      focusAfter.current = 'title';
      setAwaiting(null);
      setNote(null);
      setEditing(false);
      setForm(EMPTY_FORM);
      notify(IPTV_TOASTS.deleted, { tone: 'ok', icon: 'trash' });
    } catch (error) {
      notify(iptvErrorMessage(error), { tone: 'err' });
    } finally {
      setBusy(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save();
  };

  if (!view) {
    return query.isError ? (
      <EmptyState
        tone="error"
        title="No se pudo cargar la IPTV"
        actions={
          <Button variant="quiet" icon="refresh" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        }
      >
        {query.error instanceof Error ? query.error.message : null}
      </EmptyState>
    ) : (
      <SkeletonRows rows={2} label="Cargando la IPTV…" />
    );
  }

  const showForm = !provider || editing;
  const secretsRequired = needsSecrets(form, editing ? provider : null);
  const kindItems: Array<{ value: IptvKind; label: string }> = [
    { value: 'm3u', label: 'Lista M3U' },
    { value: 'xtream', label: 'Xtream Codes' },
  ];
  const urlValue = form.kind === 'm3u' ? form.url : form.server;
  const privateHint = urlValue && looksPrivateUrl(urlValue) ? IPTV_PRIVATE_HINT : undefined;
  const bind = (field: IptvField) => (el: HTMLInputElement | null) => {
    fieldRefs.current[field] = el;
  };

  return (
    <div className="dirs iptv">
      {provider && !editing ? (
        <IptvCard
          provider={provider}
          busy={busy}
          armed={confirm.armed === 'iptv'}
          note={
            note ??
            (provider.status === 'syncing'
              ? { tone: 'info', text: refreshingText(provider.name) }
              : null)
          }
          onToggle={(enabled) => void toggle(enabled)}
          onSync={() => void sync(provider)}
          onEdit={() => openEdit(provider)}
          editRef={editRef}
          onDelete={() => confirm.tap('iptv', () => void remove())}
        />
      ) : null}

      {showForm ? (
        <form className="dir-form iptv-form" onSubmit={submit} noValidate aria-labelledby={titleId}>
          <h3 id={titleId} ref={titleRef} tabIndex={-1} className="dir-form__title">
            {editing ? IPTV_EDIT_TITLE : IPTV_FORM_TITLE}
          </h3>
          <Segmented
            label={IPTV_KIND_LABEL}
            block
            value={form.kind}
            onChange={(kind: IptvKind) => {
              haptic('selection');
              setErrors({});
              update({ kind });
            }}
            items={kindItems}
          />
          <TextField
            label="Nombre"
            placeholder={IPTV_NAME_PLACEHOLDER}
            value={form.name}
            maxLength={IPTV_NAME_MAX}
            autoComplete="off"
            onChange={(event) => update({ name: event.target.value })}
          />
          {form.kind === 'm3u' ? (
            <TextField
              ref={bind('url')}
              label="Dirección de la lista"
              placeholder={editing && !secretsRequired ? IPTV_SAVED_URL : IPTV_URL_PLACEHOLDER}
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={IPTV_URL_MAX}
              value={form.url}
              error={errors.url ?? null}
              hint={privateHint}
              onChange={(event) => update({ url: event.target.value })}
            />
          ) : (
            <>
              <TextField
                ref={bind('server')}
                label="Servidor"
                placeholder={IPTV_SERVER_PLACEHOLDER}
                type="url"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={IPTV_URL_MAX}
                value={form.server}
                error={errors.server ?? null}
                hint={privateHint}
                onChange={(event) => update({ server: event.target.value })}
              />
              <TextField
                ref={bind('username')}
                label="Usuario"
                placeholder={editing && !secretsRequired ? IPTV_SAVED_USERNAME : undefined}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={IPTV_SECRET_MAX}
                value={form.username}
                error={errors.username ?? null}
                data-1p-ignore=""
                data-lpignore="true"
                data-bwignore=""
                onChange={(event) => update({ username: event.target.value })}
              />
              <TextField
                ref={bind('password')}
                label="Contraseña"
                placeholder={editing && !secretsRequired ? IPTV_SAVED_PASSWORD : undefined}
                type="password"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={IPTV_SECRET_MAX}
                value={form.password}
                error={errors.password ?? null}
                data-1p-ignore=""
                data-lpignore="true"
                data-bwignore=""
                onChange={(event) => update({ password: event.target.value })}
              />
            </>
          )}
          <div className="dir-form__acts">
            <Button
              type="submit"
              variant="primary"
              icon={editing ? 'check' : 'plus'}
              busy={busy === 'save'}
              disabled={busy !== null}
            >
              {editing ? 'Guardar cambios' : 'Guardar IPTV'}
            </Button>
            {editing ? (
              <Button variant="quiet" disabled={busy === 'save'} onClick={cancelEdit}>
                Cancelar
              </Button>
            ) : null}
          </div>
          <p className="dir-note">{IPTV_PRIVACY_NOTE}</p>
          <StatusLine note={note} />
        </form>
      ) : null}
    </div>
  );
}

interface IptvCardProps {
  provider: IptvProviderView;
  busy: Busy;
  armed: boolean;
  note: Note;
  onToggle(enabled: boolean): void;
  onSync(): void;
  onEdit(): void;
  onDelete(): void;
  editRef: Ref<HTMLButtonElement>;
}

function IptvCard({
  provider,
  busy,
  armed,
  note,
  onToggle,
  onSync,
  onEdit,
  onDelete,
  editRef,
}: IptvCardProps) {
  const capsule = capsuleOf(provider);
  const stale = staleLine(provider);
  const account = provider.kind === 'xtream' ? accountLine(provider.account) : null;
  const guide = guideLine(provider.guide);
  const failed = provider.status === 'error' && !stale && provider.error;
  const noteId = useId();
  /* La papelera se convierte en «¿Borrar?» (otro botón): el foco la sigue, y
     vuelve a la papelera si se desarma con el foco perdido. */
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const trashRef = useRef<HTMLButtonElement | null>(null);
  const wasArmed = useRef(armed);
  useEffect(() => {
    if (armed === wasArmed.current) return;
    wasArmed.current = armed;
    const lost = document.activeElement === document.body || document.activeElement === null;
    if (armed) confirmRef.current?.focus();
    else if (lost) trashRef.current?.focus();
  }, [armed]);
  return (
    <div className="iptv-card-wrap">
      <div className="dir-card iptv-card" data-active={provider.enabled || undefined}>
        <span className="dir-card__icon" aria-hidden="true">
          <Icon name="tv" size={20} />
        </span>
        <div className="dir-card__body">
          <div className="dir-card__head">
            <span className="dir-card__name">{provider.name}</span>
            <Capsule tone={capsule.tone} size="sm" className="dir-badge">
              {capsule.text}
            </Capsule>
          </div>
          <p className="dir-card__meta iptv-card__meta">{metaLine(provider)}</p>
          <p className="iptv-card__host">
            <span className="mono">{provider.host}</span>
            {hostLine(provider).slice(provider.host.length)}
          </p>
          {account ? (
            <p className={cx('iptv-card__line', `iptv-card__line--${account.tone}`)}>
              {account.tone !== 'plain' ? <Icon name="aviso" size={16} /> : null}
              {account.text}
            </p>
          ) : null}
          {stale ? (
            <p className="iptv-card__line iptv-card__line--err">
              <Icon name="aviso" size={16} />
              {stale.text}
            </p>
          ) : null}
          {failed ? (
            <p className="iptv-card__line iptv-card__line--err">
              <Icon name="aviso" size={16} />
              {provider.error?.message}
            </p>
          ) : null}
          {guide ? <p className="iptv-card__line iptv-card__guide">{guide}</p> : null}
        </div>
      </div>
      <Switch
        className="iptv-switch"
        label="Usar la IPTV"
        description={IPTV_PAUSE_HELP}
        checked={provider.enabled}
        /* Mientras cambia no se desactiva (perdería el foco): se ignora el toque. */
        disabled={busy !== null && busy !== 'toggle'}
        onChange={(enabled) => {
          if (busy === null) onToggle(enabled);
        }}
      />
      <div className="dir-form__acts iptv-card__acts">
        <Button
          size="sm"
          variant="quiet"
          icon="refresh"
          disabled={busy !== null || !provider.enabled}
          busy={busy === 'sync' || provider.status === 'syncing'}
          onClick={onSync}
        >
          Actualizar
        </Button>
        <Button
          ref={editRef}
          size="sm"
          variant="quiet"
          icon="pencil"
          disabled={busy !== null}
          onClick={onEdit}
        >
          Cambiar datos
        </Button>
        {armed ? (
          <Button
            ref={confirmRef}
            size="sm"
            variant="danger"
            icon="trash"
            className="dir-card__delete"
            aria-label={`Confirmar: eliminar ${provider.name} y sus datos`}
            aria-describedby={noteId}
            disabled={busy !== null}
            onClick={onDelete}
          >
            ¿Borrar?
          </Button>
        ) : (
          <IconButton
            ref={trashRef}
            icon="trash"
            className="dir-card__delete"
            label={`Eliminar ${provider.name}`}
            title="Eliminar"
            disabled={busy !== null}
            busy={busy === 'delete'}
            onClick={onDelete}
          />
        )}
      </div>
      {armed ? (
        <p id={noteId} className="dir-note iptv-card__delete-note">
          {IPTV_DELETE_NOTE}
        </p>
      ) : null}
      <StatusLine note={note} />
    </div>
  );
}

export default IptvSection;
