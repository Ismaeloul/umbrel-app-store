/* Ajustes → Copia de seguridad (decisiones.md D25). Va en su propio trozo
   de JS (React.lazy en SettingsView): solo se descarga al abrir la sección.

   - «Descargar copia»: GET /api/v1/backup o, con «Incluir la contraseña de
     la IPTV», POST /api/v1/backup/export con una clave escrita dos veces.
     La web le añade lo de este navegador y la descarga como fichero.
   - «Restaurar copia»: se elige el fichero, se pide la clave si la copia la
     necesita, se enseña qué trae (vista previa del servidor) y, tras
     confirmar en una hoja de la propia página, se aplica. Si la IPTV quedó
     sin contraseña, se pide aquí mismo y se guarda con «Guardar IPTV». */

import {
  BACKUP_PASSPHRASE_MAX,
  BACKUP_PASSPHRASE_MIN,
  IPTV_SECRET_MAX,
  IPTV_URL_MAX,
  type BackupImportMode,
  type BackupImportResponse,
} from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent } from 'react';
import { api, describeFailure, invalidateRoute, useApiQuery } from '../../api/index.ts';
import { haptic } from '../../lib/haptics.ts';
import { notify } from '../../notices/index.ts';
import { Button, Segmented, Sheet, Switch, TextField } from '../../ui/index.ts';
import {
  BACKUP_EXCLUDED,
  BACKUP_MERGE_HELP,
  BACKUP_NO_SECRET_HELP,
  BACKUP_REPLACE_WARNING,
  BACKUP_SECRET_HELP,
  BACKUP_SECRET_LABEL,
  BackupFileError,
  applyBrowserPrefs,
  backupFileName,
  backupText,
  createdLine,
  doneMessage,
  downloadText,
  iptvLine,
  isProtected,
  readBackupFile,
  settingsLine,
  summaryRows,
} from './model.ts';
import './backup.css';

/* ---- Descargar ------------------------------------------------------------ */

function ExportPart() {
  const iptv = useApiQuery('iptvGet');
  const hasIptv = Boolean(iptv.data?.provider);
  const [withSecret, setWithSecret] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = passphrase.length < BACKUP_PASSPHRASE_MIN;
  const mismatch = again !== passphrase;
  const passError =
    withSecret && tried && tooShort ? `Al menos ${BACKUP_PASSPHRASE_MIN} caracteres.` : null;
  const againError =
    withSecret && tried && !tooShort && mismatch ? 'Las dos claves no coinciden.' : null;

  const download = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    setError(null);
    if (withSecret && (tooShort || mismatch)) return;
    setBusy(true);
    try {
      const file =
        withSecret && hasIptv
          ? await api('backupExportSecret', { body: { passphrase } })
          : await api('backupExport');
      const name = backupFileName();
      downloadText(backupText(file), name);
      haptic('success');
      notify(`Copia descargada: ${name}`, { tone: 'ok', icon: 'descargar' });
      setPassphrase('');
      setAgain('');
      setTried(false);
    } catch (failure) {
      setError(`No se pudo hacer la copia. ${describeFailure(failure)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="set-stack bk-part"
      onSubmit={download}
      noValidate
      aria-labelledby="bk-export-t"
    >
      <h3 id="bk-export-t" className="bk-part__title">
        Descargar copia
      </h3>
      <p className="set-help">{BACKUP_EXCLUDED}</p>
      {hasIptv ? (
        <Switch
          label={BACKUP_SECRET_LABEL}
          description={withSecret ? BACKUP_SECRET_HELP : BACKUP_NO_SECRET_HELP}
          checked={withSecret}
          onChange={(checked) => {
            setWithSecret(checked);
            setTried(false);
          }}
        />
      ) : null}
      {withSecret && hasIptv ? (
        <div className="bk-fields">
          <TextField
            label="Clave para proteger la contraseña"
            type="password"
            autoComplete="new-password"
            maxLength={BACKUP_PASSPHRASE_MAX}
            value={passphrase}
            error={passError}
            hint={`Mínimo ${BACKUP_PASSPHRASE_MIN} caracteres. No se guarda en ningún sitio.`}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <TextField
            label="Repite la clave"
            type="password"
            autoComplete="new-password"
            maxLength={BACKUP_PASSPHRASE_MAX}
            value={again}
            error={againError}
            onChange={(event) => setAgain(event.target.value)}
          />
        </div>
      ) : null}
      <div className="set-row">
        <Button type="submit" variant="primary" icon="descargar" busy={busy}>
          Descargar copia
        </Button>
      </div>
      {error ? (
        <p className="set-help set-help--err" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/* ---- IPTV pendiente tras restaurar ----------------------------------------- */

function IptvSecretForm({
  outcome,
  onDone,
}: {
  outcome: BackupImportResponse['iptv'];
  onDone(): void;
}) {
  const client = useQueryClient();
  const [value, setValue] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userError, setUserError] = useState<string | null>(null);
  const m3u = outcome.kind === 'm3u';

  const save = async (event: FormEvent) => {
    event.preventDefault();
    /* El usuario Xtream no viaja en claro en la copia (es tan secreto como la
       contraseña, docs/iptv.md §1.4): se pide junto a ella. */
    const missingUser = !m3u && !username.trim();
    const missingValue = !value.trim();
    setUserError(missingUser ? 'Escribe el usuario.' : null);
    setError(
      missingValue ? (m3u ? 'Escribe la dirección de la lista.' : 'Escribe la contraseña.') : null,
    );
    if (missingUser || missingValue) return;
    setBusy(true);
    try {
      const name = outcome.name ?? undefined;
      await api('iptvSave', {
        body: m3u
          ? { kind: 'm3u', url: value.trim(), ...(name ? { name } : {}) }
          : {
              kind: 'xtream',
              server: outcome.server ?? '',
              username: username.trim(),
              password: value,
              ...(name ? { name } : {}),
            },
      });
      void invalidateRoute('iptvGet', client);
      notify('IPTV guardada: descargando la lista de canales…', { tone: 'ok', icon: 'tv' });
      onDone();
    } catch (failure) {
      setError(`No se pudo guardar la IPTV. ${describeFailure(failure)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="set-stack bk-iptv" onSubmit={save} noValidate aria-labelledby="bk-iptv-t">
      <h3 id="bk-iptv-t" className="bk-part__title">
        Falta {m3u ? 'la dirección de la lista' : 'el usuario y la contraseña'} de tu IPTV
      </h3>
      <p className="set-help">
        {m3u
          ? `La copia trae «${outcome.name ?? 'IPTV'}» (${outcome.host ?? 'sin host'}) sin su dirección, porque lleva la contraseña dentro.`
          : `Servidor ${outcome.server ?? '?'}. El usuario y la contraseña no venían en la copia.`}
      </p>
      {m3u ? null : (
        <TextField
          label="Usuario de la IPTV"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={IPTV_SECRET_MAX}
          value={username}
          error={userError}
          onChange={(event) => setUsername(event.target.value)}
        />
      )}
      <TextField
        label={m3u ? 'Dirección de la lista' : 'Contraseña de la IPTV'}
        type={m3u ? 'url' : 'password'}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={m3u ? IPTV_URL_MAX : IPTV_SECRET_MAX}
        value={value}
        error={error}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="set-row">
        <Button type="submit" variant="primary" icon="tv" busy={busy}>
          Guardar IPTV
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Más tarde
        </Button>
      </div>
    </form>
  );
}

/* ---- Restaurar ------------------------------------------------------------ */

interface Picked {
  readonly name: string;
  readonly backup: Record<string, unknown>;
  readonly protected: boolean;
}

function ImportPart() {
  const client = useQueryClient();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [mode, setMode] = useState<BackupImportMode>('replace');
  const [preview, setPreview] = useState<BackupImportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<BackupImportResponse['iptv'] | null>(null);

  const reset = () => {
    setPicked(null);
    setPreview(null);
    setPassphrase('');
    setError(null);
    setConfirming(false);
    if (input.current) input.current.value = '';
  };

  const run = async (
    target: Picked,
    options: { dryRun: boolean; mode: BackupImportMode; passphrase: string },
  ): Promise<BackupImportResponse> =>
    api('backupImport', {
      body: {
        backup: target.backup,
        mode: options.mode,
        dryRun: options.dryRun,
        ...(options.passphrase ? { passphrase: options.passphrase } : {}),
      },
      timeoutMs: 30_000,
    });

  const look = async (target: Picked, nextMode: BackupImportMode = mode) => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await run(target, { dryRun: true, mode: nextMode, passphrase }));
    } catch (failure) {
      setPreview(null);
      setError(describeFailure(failure));
    } finally {
      setBusy(false);
    }
  };

  const choose = async (file: File | undefined) => {
    setPreview(null);
    setError(null);
    setPending(null);
    if (!file) return;
    try {
      const backup = await readBackupFile(file);
      const next: Picked = { name: file.name, backup, protected: isProtected(backup) };
      setPicked(next);
      if (!next.protected) await look(next);
    } catch (failure) {
      setPicked(null);
      setError(failure instanceof BackupFileError ? failure.message : describeFailure(failure));
    }
  };

  const apply = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const result = await run(picked, { dryRun: false, mode, passphrase });
      setConfirming(false);
      applyBrowserPrefs(result.browser);
      for (const id of [
        'bootstrap',
        'libraryGet',
        'preferencesGet',
        'settingsGet',
        'directoriesGet',
        'iptvGet',
      ] as const) {
        void invalidateRoute(id, client);
      }
      haptic('success');
      notify(doneMessage(result), { tone: 'ok', icon: 'copia' });
      setPending(result.iptv.action === 'needs_secret' ? result.iptv : null);
      reset();
    } catch (failure) {
      setConfirming(false);
      setError(`No se pudo restaurar la copia. ${describeFailure(failure)}`);
    } finally {
      setBusy(false);
    }
  };

  const rows = preview ? summaryRows(preview) : [];
  const extra = preview ? settingsLine(preview) : null;

  return (
    <div className="set-stack bk-part" role="group" aria-labelledby="bk-import-t">
      <h3 id="bk-import-t" className="bk-part__title">
        Restaurar copia
      </h3>
      <div className="bk-file">
        <label htmlFor={inputId} className="set-label">
          Fichero de la copia (.json)
        </label>
        <input
          ref={input}
          id={inputId}
          className="bk-file__input"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void choose(event.target.files?.[0])}
        />
      </div>

      {picked?.protected && !preview ? (
        <form
          className="set-stack"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void look(picked);
          }}
        >
          <TextField
            label="Clave de la copia"
            type="password"
            autoComplete="off"
            maxLength={BACKUP_PASSPHRASE_MAX}
            value={passphrase}
            hint="La que elegiste al descargarla. Déjala vacía para restaurar sin la contraseña de la IPTV."
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <div className="set-row">
            <Button type="submit" variant="quiet" icon="eye" busy={busy}>
              Ver qué contiene
            </Button>
          </div>
        </form>
      ) : null}

      {preview && picked ? (
        <section className="bk-preview" aria-labelledby="bk-preview-t" aria-live="polite">
          <h4 id="bk-preview-t" className="bk-preview__title">
            Copia del {createdLine(preview.source.createdAt)} · versión {preview.source.appVersion}
          </h4>
          <ul className="bk-preview__list">
            {rows.map((row) => (
              <li key={row.key}>
                <span>{row.label}</span>
                <span className="bk-preview__now">{row.now}</span>
              </li>
            ))}
          </ul>
          <p className="set-text">{iptvLine(preview.iptv)}</p>
          {extra ? <p className="set-help">{extra}</p> : null}
          <div className="set-field">
            <p className="set-label" id="bk-mode">
              Cómo restaurar
            </p>
            <Segmented
              label="Cómo restaurar"
              block
              value={mode}
              onChange={(next: BackupImportMode) => {
                setMode(next);
                void look(picked, next);
              }}
              items={[
                { value: 'replace', label: 'Reemplazar' },
                { value: 'merge', label: 'Combinar' },
              ]}
            />
            <p className={mode === 'replace' ? 'bk-warn' : 'set-help'} role="note">
              {mode === 'replace' ? BACKUP_REPLACE_WARNING : BACKUP_MERGE_HELP}
            </p>
          </div>
          <div className="set-row">
            <Button
              variant={mode === 'replace' ? 'danger' : 'primary'}
              icon="copia"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              {mode === 'replace' ? 'Restaurar y reemplazar…' : 'Restaurar y combinar…'}
            </Button>
            <Button variant="ghost" onClick={reset}>
              Cancelar
            </Button>
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="set-help set-help--err" role="alert">
          {error}
        </p>
      ) : null}

      {pending ? <IptvSecretForm outcome={pending} onDone={() => setPending(null)} /> : null}

      <Sheet
        open={confirming}
        onClose={() => (busy ? undefined : setConfirming(false))}
        dismissible={!busy}
        size="sm"
        title={mode === 'replace' ? '¿Reemplazar con la copia?' : '¿Combinar con la copia?'}
        description={mode === 'replace' ? BACKUP_REPLACE_WARNING : BACKUP_MERGE_HELP}
        footer={
          <div className="set-row">
            <Button
              variant={mode === 'replace' ? 'danger' : 'primary'}
              icon="check"
              busy={busy}
              onClick={() => void apply()}
            >
              {mode === 'replace' ? 'Sí, reemplazar' : 'Sí, combinar'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </div>
        }
      >
        {picked ? <p className="set-help">Fichero: {picked.name}</p> : null}
      </Sheet>
    </div>
  );
}

export default function BackupSection() {
  return (
    <div className="set-stack bk">
      <ExportPart />
      <ImportPart />
    </div>
  );
}
