/* Ajustes → Listas (inventario-front §14): añadir una lista M3U o HTML por su
   dirección, elegir la activa, actualizarla a mano y borrarla con segundo
   toque. Hasta 8; el servidor las actualiza solas cada 3 h.

   Cambios sobre la 0.6.59, todos a favor del usuario:
   - los botones se deshabilitan mientras se sincroniza (§29.26: antes se
     podía mandar dos veces);
   - una dirección que no empieza por http(s) se avisa antes de mandarla, y
     una de la red local lleva una pista (quien decide es el servidor, que
     puede permitirlas con ALLOW_PRIVATE_SYNC_URLS);
   - el motivo del último fallo sale corto en la tarjeta y, debajo, con el
     mensaje completo del catálogo de @ace/shared.

   En la demo no hay backend: guardar, activar y borrar dan el aviso de
   siempre («En modo demo no hay backend…»). */

import { errorMessage, type WebSourceSummary } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { api, useApiQuery } from '../../api/index.ts';
import { notify } from '../../notices/index.ts';
import { cx } from '../../lib/cx.ts';
import { Button, EmptyState, Icon, IconButton, SkeletonRows, TextField } from '../../ui/index.ts';
import { useSecondTap } from '../settings/second-tap.ts';
import {
  applyDirectoryView,
  CONFIRM_DELETE_MS,
  DEFAULT_SYNC_URL,
  DIRECTORY_NOTE,
  directoryErrorMessage,
  isHttpUrl,
  looksPrivateUrl,
  MAX_WEB_SOURCES,
  registerDirectoriesDemo,
  sourceMeta,
} from './model.ts';
import './directories.css';

registerDirectoriesDemo();

type Busy = { kind: 'add' } | { kind: 'refresh' | 'activate' | 'delete'; id: string } | null;

type Note = { tone: 'info' | 'ok' | 'err'; text: string } | null;

function setLibraryTabParam(tab: string): void {
  // Tras guardar, la biblioteca abre en «Listas» (index.html:5773).
  try {
    const params = new URLSearchParams(location.search);
    params.set('pestana', tab);
    history.replaceState(
      history.state,
      '',
      `${location.pathname}?${params.toString().replace(/%2F/gi, '/')}`,
    );
  } catch {}
}

export function DirectoriesSection() {
  const client = useQueryClient();
  const directories = useApiQuery('directoriesGet');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [urlTouched, setUrlTouched] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<Note>(null);
  const confirm = useSecondTap(CONFIRM_DELETE_MS);

  const data = directories.data;
  const sources = data?.webSources ?? [];
  const full = sources.length >= MAX_WEB_SOURCES;

  // La dirección llega rellena con la lista por defecto de la 0.6.59, salvo
  // que ya la tengas guardada (así no se duplica al darle a «Guardar»).
  useEffect(() => {
    if (!data || urlTouched) return;
    if (!data.webSources.some((source) => source.url === DEFAULT_SYNC_URL))
      setUrl(DEFAULT_SYNC_URL);
  }, [data, urlTouched]);

  const sync = async (type: 'm3u' | 'html', source: WebSourceSummary | null) => {
    const target = source?.url ?? url.trim();
    if (!target) {
      notify('Escribe la URL de la lista', { tone: 'warn' });
      return;
    }
    if (!source && !isHttpUrl(target)) {
      setUrlError(errorMessage('bad_url'));
      return;
    }
    setUrlError(null);
    setBusy(source ? { kind: 'refresh', id: source.id } : { kind: 'add' });
    setNote({
      tone: 'info',
      text: source ? `Actualizando «${source.name}»…` : 'Guardando y sincronizando la lista…',
    });
    const listName = source?.name ?? name.trim();
    try {
      const view = await api('directoriesSync', {
        body: {
          url: target,
          type: source ? source.type : type,
          ...(listName ? { name: listName } : {}),
          ...(source ? { sourceId: source.id } : {}),
        },
      });
      applyDirectoryView(client, view);
      const active = view.webSources.find((s) => s.id === view.activeWebSourceId);
      setNote({
        tone: 'ok',
        text: `«${active?.name ?? 'Lista'}»: ${view.web.length} canales. Actualización automática cada 3 h.`,
      });
      notify(`Lista guardada: ${view.web.length} canales`, { tone: 'ok' });
      setLibraryTabParam('listas');
      if (!source) {
        setName('');
        setUrl('');
        setUrlTouched(true);
      }
    } catch (error) {
      const message = directoryErrorMessage(error);
      setNote({ tone: 'err', text: message });
    } finally {
      setBusy(null);
    }
  };

  const activate = async (source: WebSourceSummary) => {
    setBusy({ kind: 'activate', id: source.id });
    try {
      const view = await api('directoriesActivate', { params: { id: source.id } });
      applyDirectoryView(client, view);
      notify(`Lista activa: ${source.name}`, { tone: 'ok' });
      setLibraryTabParam('listas');
    } catch (error) {
      const message = directoryErrorMessage(error);
      notify(message === directoryErrorMessage(null) ? 'No se pudo cambiar de lista' : message, {
        tone: 'err',
      });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (source: WebSourceSummary) => {
    setBusy({ kind: 'delete', id: source.id });
    try {
      const view = await api('directoriesDelete', { params: { id: source.id } });
      applyDirectoryView(client, view);
      notify('Lista eliminada', { tone: 'ok', icon: 'trash' });
    } catch (error) {
      notify(directoryErrorMessage(error), { tone: 'err' });
    } finally {
      setBusy(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void sync('m3u', null);
  };

  const privateHint = url && looksPrivateUrl(url);

  return (
    <div className="dirs">
      <form className="dir-form" onSubmit={submit} noValidate>
        <h3 className="dir-form__title">Guardar una lista remota</h3>
        <TextField
          label="Nombre"
          placeholder="Nombre, por ejemplo: Principal"
          value={name}
          maxLength={60}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label="Dirección de la lista"
          placeholder="https://…/lista.m3u"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          focusTarget="url-lista"
          value={url}
          error={urlError}
          hint={
            privateHint
              ? 'Parece una dirección de tu red local: por seguridad el servidor las bloquea salvo que se hayan permitido al instalar.'
              : undefined
          }
          onChange={(event) => {
            setUrl(event.target.value);
            setUrlTouched(true);
            setUrlError(null);
          }}
        />
        <div className="dir-form__acts">
          <Button
            type="submit"
            variant="primary"
            icon="plus"
            busy={busy?.kind === 'add'}
            disabled={busy !== null || full}
          >
            Guardar M3U
          </Button>
          <Button
            variant="quiet"
            icon="plus"
            disabled={busy !== null || full}
            onClick={() => void sync('html', null)}
          >
            Guardar HTML
          </Button>
        </div>
        <p className="dir-note">{full ? errorMessage('source_limit') : DIRECTORY_NOTE}</p>
        <p
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
      </form>

      <div className="dir-saved">
        <h3 className="dir-form__title">
          Listas guardadas{' '}
          <span className="dir-count">{`${sources.length} de ${MAX_WEB_SOURCES}`}</span>
        </h3>
        {!data ? (
          directories.isError ? (
            <EmptyState
              tone="error"
              title="No se pudieron cargar las listas"
              actions={
                <Button variant="quiet" icon="refresh" onClick={() => void directories.refetch()}>
                  Reintentar
                </Button>
              }
            >
              {directories.error instanceof Error ? directories.error.message : null}
            </EmptyState>
          ) : (
            <SkeletonRows rows={2} label="Cargando las listas…" />
          )
        ) : sources.length === 0 ? (
          <p className="dir-note">Todavía no hay listas guardadas.</p>
        ) : (
          <ul className="dir-list">
            {sources.map((source) => {
              const active = source.id === data.activeWebSourceId;
              const failed = Boolean(source.lastErrorAt);
              const armed = confirm.armed === source.id;
              const mine = busy && 'id' in busy && busy.id === source.id ? busy.kind : null;
              return (
                <li key={source.id} className="dir-card" data-active={active || undefined}>
                  <div className="dir-card__head">
                    <span className="dir-card__name">{source.name}</span>
                    {active ? <span className="dir-badge">En uso</span> : null}
                  </div>
                  <p className="dir-card__url mono" title={source.url}>
                    {source.url}
                  </p>
                  <p className={cx('dir-card__meta', failed && 'dir-card__meta--failed')}>
                    {sourceMeta(source)}
                  </p>
                  {failed && source.lastError ? (
                    <p className="dir-card__error">
                      <Icon name="aviso" size={16} />
                      {errorMessage(source.lastError)}
                    </p>
                  ) : null}
                  <div className="dir-card__acts">
                    <Button
                      size="sm"
                      variant={active ? 'quiet' : 'primary'}
                      disabled={active || busy !== null}
                      busy={mine === 'activate'}
                      onClick={() => void activate(source)}
                    >
                      {active ? 'Activo' : 'Usar'}
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      icon="refresh"
                      disabled={busy !== null}
                      busy={mine === 'refresh'}
                      onClick={() => void sync(source.type, source)}
                    >
                      Actualizar
                    </Button>
                    {armed ? (
                      <Button
                        size="sm"
                        variant="danger"
                        icon="trash"
                        className="dir-card__delete"
                        aria-label={`Confirmar: eliminar ${source.name} y su lista`}
                        disabled={busy !== null}
                        onClick={() => confirm.tap(source.id, () => void remove(source))}
                      >
                        ¿Borrar?
                      </Button>
                    ) : (
                      <IconButton
                        icon="trash"
                        className="dir-card__delete"
                        label={`Eliminar ${source.name}`}
                        title="Eliminar"
                        disabled={busy !== null}
                        busy={mine === 'delete'}
                        onClick={() => confirm.tap(source.id, () => void remove(source))}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
