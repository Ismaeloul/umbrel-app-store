/* Ajustes → Listas (inventario-front §14, piel «Palco» W10): añadir una lista
   M3U o HTML por su dirección, elegir la activa, actualizarla a mano y
   borrarla con segundo toque. Hasta 8; el servidor las actualiza solas cada
   3 h. Cada lista guardada es una tarjeta con su icono y la cápsula «En uso»
   en oro.

   Cambios sobre la 0.6.59, todos a favor del usuario:
   - los botones se deshabilitan mientras se sincroniza (§29.26: antes se
     podía mandar dos veces);
   - una dirección que no empieza por http(s) se avisa antes de mandarla, y
     una de la red local lleva una pista (quien decide es el servidor, que
     puede permitirlas con ALLOW_PRIVATE_SYNC_URLS);
   - el motivo del último fallo sale corto en la tarjeta y, debajo, con el
     mensaje completo del catálogo de @ace/shared.

   0.9.7: «Subir archivo .m3u». Se elige el archivo y se pregunta de dónde
   se descargó: con el enlace, la lista se actualiza sola como las demás;
   sin él, se queda tal cual (y la tarjeta lo dice y deja ponérselo luego).

   En la demo no hay backend: guardar, activar y borrar dan el aviso de
   siempre («En modo demo no hay backend…»). */

import {
  errorMessage,
  isUploadedSourceUrl,
  MAX_UPLOADED_LIST_CHARS,
  type WebSourceSummary,
} from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api, useApiQuery } from '../../api/index.ts';
import { rememberViewParam } from '../../app/router.tsx';
import { notify } from '../../notices/index.ts';
import { cx } from '../../lib/cx.ts';
import {
  Button,
  Capsule,
  EmptyState,
  Icon,
  IconButton,
  SkeletonRows,
  TextField,
} from '../../ui/index.ts';
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

type Busy =
  | { kind: 'add' | 'upload' }
  | { kind: 'refresh' | 'activate' | 'delete' | 'link'; id: string }
  | null;

/** Archivo elegido, a la espera del enlace de origen (o de «Sin enlace»). */
type Pending = { fileName: string; content: string; sourceId?: string } | null;

type Note = { tone: 'info' | 'ok' | 'err'; text: string } | null;

function setLibraryTabParam(tab: string): void {
  // Tras guardar, la biblioteca abre en «Listas» (index.html:5773). Se deja
  // preparado para Canales: la URL de Ajustes no lleva `pestana` (routes.ts).
  rememberViewParam('biblioteca', 'pestana', tab);
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
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [originUrl, setOriginUrl] = useState('');
  const [originError, setOriginError] = useState<string | null>(null);
  /** Tarjeta de una lista subida a la que se le está poniendo el enlace. */
  const [linking, setLinking] = useState<{ id: string; url: string } | null>(null);

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

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOADED_LIST_CHARS) {
      setNote({ tone: 'err', text: 'El archivo es demasiado grande (como mucho, 1,9 MB).' });
      return;
    }
    const content = await file.text();
    setOriginUrl('');
    setOriginError(null);
    setPending({ fileName: file.name, content });
  };

  const upload = async (withLink: boolean) => {
    if (!pending) return;
    const link = withLink ? originUrl.trim() : '';
    if (withLink && !isHttpUrl(link)) {
      setOriginError(errorMessage('bad_url'));
      return;
    }
    setBusy({ kind: 'upload' });
    setNote({ tone: 'info', text: `Subiendo «${pending.fileName}»…` });
    try {
      const view = await api('directoriesUpload', {
        body: {
          content: pending.content,
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(link ? { url: link } : {}),
        },
      });
      applyDirectoryView(client, view);
      setNote({
        tone: 'ok',
        text: link
          ? `Lista subida: ${view.web.length} canales. Se actualizará sola desde su enlace cada 3 h.`
          : `Lista subida: ${view.web.length} canales. Sin enlace no se actualiza sola: vuelve a subirla o ponle el enlace.`,
      });
      notify(`Lista subida: ${view.web.length} canales`, { tone: 'ok' });
      setLibraryTabParam('listas');
      setPending(null);
      setName('');
    } catch (error) {
      setNote({ tone: 'err', text: directoryErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  /* Ponerle el enlace a una lista subida: se descarga de ahí ya (como «Actualizar»). */
  const saveLink = async (source: WebSourceSummary) => {
    const link = linking?.url.trim() ?? '';
    if (!isHttpUrl(link)) {
      notify(errorMessage('bad_url'), { tone: 'warn' });
      return;
    }
    setBusy({ kind: 'link', id: source.id });
    try {
      const view = await api('directoriesSync', {
        body: { url: link, type: source.type, name: source.name, sourceId: source.id },
      });
      applyDirectoryView(client, view);
      notify(`«${source.name}» se actualizará sola desde su enlace`, { tone: 'ok' });
      setLinking(null);
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
          <Button
            variant="quiet"
            icon="subir"
            disabled={busy !== null || full}
            onClick={() => fileInput.current?.click()}
          >
            Subir archivo .m3u
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".m3u,.m3u8,.txt,.html,.htm,audio/x-mpegurl,audio/mpegurl,text/plain"
            hidden
            data-testid="subir-lista"
            onChange={(event) => void chooseFile(event)}
          />
        </div>
        {pending ? (
          <div className="dir-upload" role="group" aria-label="Enlace de la lista subida">
            <p className="dir-upload__file">
              <Icon name="list" size={16} /> {pending.fileName}
            </p>
            <TextField
              label="¿De dónde la has descargado?"
              placeholder="https://… (el enlace de «Descargar» o «Copiar»)"
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={originUrl}
              error={originError}
              hint="Con el enlace, el Umbrel la actualizará sola cada 3 h. Sin él, se queda como está."
              onChange={(event) => {
                setOriginUrl(event.target.value);
                setOriginError(null);
              }}
            />
            <div className="dir-form__acts">
              <Button
                variant="primary"
                icon="subir"
                busy={busy?.kind === 'upload'}
                disabled={busy !== null || !originUrl.trim()}
                onClick={() => void upload(true)}
              >
                Subir con el enlace
              </Button>
              <Button variant="quiet" disabled={busy !== null} onClick={() => void upload(false)}>
                Subir sin enlace
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => setPending(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : null}
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
                  <span className="dir-card__icon" aria-hidden="true">
                    <Icon name="list" size={20} />
                  </span>
                  <div className="dir-card__body">
                    <div className="dir-card__head">
                      <span className="dir-card__name">{source.name}</span>
                      {active ? (
                        <Capsule tone="gold" size="sm" className="dir-badge">
                          En uso
                        </Capsule>
                      ) : null}
                    </div>
                    {isUploadedSourceUrl(source.url) ? (
                      <p className="dir-card__url">
                        Archivo subido · sin enlace, no se actualiza sola
                      </p>
                    ) : (
                      <p className="dir-card__url mono" title={source.url}>
                        {source.url}
                      </p>
                    )}
                    {linking?.id === source.id ? (
                      <div className="dir-upload">
                        <TextField
                          label="Enlace de la lista"
                          placeholder="https://…"
                          type="url"
                          inputMode="url"
                          autoComplete="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          value={linking.url}
                          onChange={(event) =>
                            setLinking({ id: source.id, url: event.target.value })
                          }
                        />
                        <div className="dir-form__acts">
                          <Button
                            size="sm"
                            variant="primary"
                            busy={mine === 'link'}
                            disabled={busy !== null || !linking.url.trim()}
                            onClick={() => void saveLink(source)}
                          >
                            Guardar enlace
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setLinking(null)}>
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    <p className={cx('dir-card__meta', failed && 'dir-card__meta--failed')}>
                      {sourceMeta(source)}
                    </p>
                    {failed && source.lastError ? (
                      <p className="dir-card__error">
                        <Icon name="aviso" size={16} />
                        {errorMessage(source.lastError)}
                      </p>
                    ) : null}
                  </div>
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
                    {isUploadedSourceUrl(source.url) ? (
                      <Button
                        size="sm"
                        variant="quiet"
                        icon="link"
                        disabled={busy !== null}
                        onClick={() => setLinking({ id: source.id, url: '' })}
                      >
                        Poner enlace
                      </Button>
                    ) : (
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
                    )}
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
