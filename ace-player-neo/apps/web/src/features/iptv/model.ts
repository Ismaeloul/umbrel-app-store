/* Ajustes → IPTV (docs/iptv.md §1): textos, validación y el cuerpo que se
   manda al servidor. Funciones puras, sin React: las prueba model.test.ts.

   Reglas que cuida:
   - Los textos entre «comillas» del diseño van LITERALES (la app nativa los
     genera desde aquí con generar-textos.mjs y los compara en TextosTests).
   - Un campo secreto vacío NO se manda: para el servidor, ausente es «el
     guardado» (§1.4). Así «Cambiar datos» no obliga a reescribir la
     contraseña, y el navegador nunca la recibe de vuelta.
   - Los errores salen del catálogo único de @ace/shared (§5.6), como en
     «Listas»; en demo, el aviso de siempre. */

import {
  errorMessage,
  IPTV_DEFAULT_NAME,
  IPTV_NAME_MAX,
  IPTV_SECRET_MAX,
  IPTV_URL_MAX,
  isAnyErrorCode,
  type IptvProviderView,
  type IptvSaveBody,
  type IptvStatus,
  type IptvView,
} from '@ace/shared';
import { isApiError } from '../../api/index.ts';
import { isHttpUrl, sourceDate } from '../directories/model.ts';

export { IPTV_NAME_MAX, IPTV_SECRET_MAX, IPTV_URL_MAX };

export type IptvKind = 'm3u' | 'xtream';

// ---- Textos (literales del diseño, §1) ---------------------------------------

export const IPTV_SECTION_DESCRIPTION =
  'Si un canal o un partido está en tu IPTV, sale el primero. Si se cae, se pasa sola a la mejor fuente de AceStream.';
export const IPTV_FORM_TITLE = 'Conectar tu IPTV';
export const IPTV_EDIT_TITLE = 'Cambiar los datos de tu IPTV';
export const IPTV_KIND_LABEL = 'Tipo de IPTV';
export const IPTV_NAME_PLACEHOLDER = 'Nombre, por ejemplo: Casa';
export const IPTV_URL_PLACEHOLDER = 'https://…/lista.m3u';
export const IPTV_SERVER_PLACEHOLDER = 'http://proveedor.example:8080';
export const IPTV_SAVED_USERNAME = 'Guardado · escríbelo solo para cambiarlo';
export const IPTV_SAVED_PASSWORD = 'Guardada · escríbela solo para cambiarla';
export const IPTV_SAVED_URL = 'Guardada · escríbela solo para cambiarla';
export const IPTV_PRIVACY_NOTE =
  'Tus credenciales se guardan cifradas en tu Umbrel y no salen de él: ni al navegador, ni al iPhone, ni a los registros.';
export const IPTV_PRIVATE_HINT =
  'Parece una dirección de tu red local: por seguridad el servidor las bloquea salvo que se hayan permitido al instalar.';
export const IPTV_PAUSE_HELP = 'En pausa se guarda, pero no se usa: todo sale de AceStream.';
export const IPTV_DELETE_NOTE = 'Eliminar la IPTV borra sus datos de tu Umbrel.';
export const IPTV_SAVING = 'Guardando y sincronizando la lista…';
export const IPTV_DEMO_MESSAGE =
  'En modo demo no hay backend: esta acción funcionará en el Umbrel.';
/**
 * Se añade al mensaje cuando el servidor ya lo intentó dos veces con un fallo
 * pasajero (docs/iptv.md §16.8): el panel no respondió bien ni a la segunda.
 */
export const IPTV_SAVE_RETRIED_HINT = ' Lo he intentado dos veces: prueba otra vez en un momento.';
/** Los fallos pasajeros con los que el servidor reintenta la prueba rápida. */
const RETRIED_HINT_CODES: ReadonlySet<string> = new Set([
  'iptv_unreachable',
  'iptv_busy',
  'dns_failed',
]);
export const IPTV_FALLBACK_ERROR = 'No se pudo guardar la IPTV. Inténtalo de nuevo.';
export const IPTV_URL_USERINFO =
  'Esa dirección lleva el usuario y la contraseña delante del servidor (usuario:contraseña@) y así no se puede usar. Si tu proveedor te los da aparte, elige Xtream.';
export const IPTV_TOO_LARGE_HINT =
  'Si tu proveedor te da servidor, usuario y contraseña, conéctala como Xtream: solo trae los canales en directo.';

export const IPTV_EMPTY_FIELD = {
  url: 'Escribe la dirección de la lista',
  server: 'Escribe el servidor',
  username: 'Escribe el usuario',
  password: 'Escribe la contraseña',
} as const;

export function isEmptyFieldMessage(message: string): boolean {
  return (Object.values(IPTV_EMPTY_FIELD) as string[]).includes(message);
}

/** «Conexión correcta. Descargando los canales de «Casa»…» */
export function syncingText(name: string): string {
  return `Conexión correcta. Descargando los canales de «${name}»…`;
}

/** «Actualizando la lista de «Casa»…» (tarjeta y botón «Actualizar»). */
export function refreshingText(name: string): string {
  return `Actualizando la lista de «${name}»…`;
}

/** ««Casa»: 812 canales. Se actualiza sola cada 6 h.» */
export function syncedText(name: string, channels: number, refreshHours: number): string {
  return `«${name}»: ${channelsText(channels)}. Se actualiza sola cada ${refreshHours} h.`;
}

export function channelsText(count: number): string {
  return `${count.toLocaleString('es-ES')} ${count === 1 ? 'canal' : 'canales'}`;
}

export const IPTV_TOASTS = {
  saved: (channels: number) => `IPTV guardada: ${channelsText(channels)}`,
  saveFailed: (reason: string) => `No se pudo guardar la IPTV. ${reason}`,
  synced: (channels: number) => `Lista de la IPTV actualizada: ${channelsText(channels)}`,
  enabled: 'IPTV activada',
  paused: 'IPTV en pausa: todo sale de AceStream',
  deleted: 'IPTV eliminada',
} as const;

// ---- Formulario ----------------------------------------------------------------

export interface IptvForm {
  kind: IptvKind;
  name: string;
  url: string;
  server: string;
  username: string;
  password: string;
}

export const EMPTY_FORM: IptvForm = {
  kind: 'm3u',
  name: '',
  url: '',
  server: '',
  username: '',
  password: '',
};

/** El formulario para «Cambiar datos»: nombre y servidor rellenos, los secretos VACÍOS (§1.4). */
export function editForm(provider: Pick<IptvProviderView, 'kind' | 'name' | 'origin'>): IptvForm {
  return {
    ...EMPTY_FORM,
    kind: provider.kind,
    name: provider.name,
    server: provider.kind === 'xtream' ? (provider.origin ?? '') : '',
  };
}

export type IptvField = 'url' | 'server' | 'username' | 'password';
export type IptvFieldErrors = Partial<Record<IptvField, string>>;

/** ¿La URL lleva `usuario:contraseña@` delante del host? El servidor no la acepta. */
export function hasUserinfo(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return Boolean(url.username || url.password);
  } catch {
    return false;
  }
}

/** Origen `esquema://host[:puerto]` de una URL, en minúsculas; null si no es http(s). */
export function originOf(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * ¿Hay que volver a escribir los secretos? Al crear, al cambiar de tipo y al
 * cambiar el origen del servidor Xtream (la regla de seguridad de §1.4: el
 * servidor respondería `iptv_credentials_required`). Se avisa antes de mandar.
 */
export function needsSecrets(
  form: Pick<IptvForm, 'kind' | 'server'>,
  saved: Pick<IptvProviderView, 'kind' | 'origin'> | null,
): boolean {
  if (!saved || saved.kind !== form.kind) return true;
  if (form.kind === 'xtream') {
    const next = originOf(form.server);
    return !next || next !== (saved.origin ?? '').toLowerCase();
  }
  return false;
}

export type IptvValidation =
  { ok: true; body: IptvSaveBody } | { ok: false; errors: IptvFieldErrors; first: IptvField };

/**
 * Valida el formulario y arma el cuerpo de `iptvSave`. Los secretos vacíos
 * no van (ausente = el guardado); solo son obligatorios si `needsSecrets`.
 * Una URL que no es http(s) da el mensaje de `bad_url` del catálogo.
 */
export function validateForm(
  form: IptvForm,
  saved: Pick<IptvProviderView, 'kind' | 'origin'> | null,
): IptvValidation {
  const errors: IptvFieldErrors = {};
  const required = needsSecrets(form, saved);
  const name = form.name.trim().slice(0, IPTV_NAME_MAX);
  if (form.kind === 'm3u') {
    const url = form.url.trim();
    if (!url) {
      if (required) errors.url = IPTV_EMPTY_FIELD.url;
    } else if (!isHttpUrl(url)) errors.url = errorMessage('bad_url');
    else if (hasUserinfo(url)) errors.url = IPTV_URL_USERINFO;
    const first = firstError(errors);
    if (first) return { ok: false, errors, first };
    return {
      ok: true,
      body: {
        kind: 'm3u',
        ...(name ? { name } : {}),
        ...(url ? { url: url.slice(0, IPTV_URL_MAX) } : {}),
      },
    };
  }
  const server = form.server.trim();
  if (!server) errors.server = IPTV_EMPTY_FIELD.server;
  else if (!isHttpUrl(server)) errors.server = errorMessage('bad_url');
  else if (hasUserinfo(server)) errors.server = IPTV_URL_USERINFO;
  // El usuario y la contraseña NO se recortan: pueden llevar espacios a propósito.
  if (!form.username && required) errors.username = IPTV_EMPTY_FIELD.username;
  if (!form.password && required) errors.password = IPTV_EMPTY_FIELD.password;
  const first = firstError(errors);
  if (first) return { ok: false, errors, first };
  /* «Cambiar datos» rellena el servidor con el origen guardado, sin la ruta
     base (`http://host:8080/panel`): si no se ha tocado, no se manda y el
     servidor conserva el guardado entero. */
  const untouched =
    saved?.kind === 'xtream' &&
    Boolean(saved.origin) &&
    server.replace(/\/+$/, '').toLowerCase() === (saved.origin ?? '').toLowerCase();
  return {
    ok: true,
    body: {
      kind: 'xtream',
      ...(name ? { name } : {}),
      ...(untouched ? {} : { server: server.slice(0, IPTV_URL_MAX) }),
      ...(form.username ? { username: form.username.slice(0, IPTV_SECRET_MAX) } : {}),
      ...(form.password ? { password: form.password.slice(0, IPTV_SECRET_MAX) } : {}),
    },
  };
}

const FIELD_ORDER: readonly IptvField[] = ['url', 'server', 'username', 'password'];

function firstError(errors: IptvFieldErrors): IptvField | null {
  return FIELD_ORDER.find((field) => errors[field]) ?? null;
}

/** Mensaje de un fallo de las rutas IPTV (el `message` del catálogo, §5.6). */
export function iptvErrorMessage(error: unknown, kind?: IptvKind): string {
  if (!isApiError(error)) return IPTV_FALLBACK_ERROR;
  if (error.code === 'demo_unsupported') return IPTV_DEMO_MESSAGE;
  // Sin red o plazo agotado: el mensaje del cliente ya dice qué pasa.
  if (error.isClientSide) return error.message;
  // Una get.php enorme (con películas y series) sí cabe como Xtream, que solo pide el directo.
  if (error.code === 'iptv_too_large' && kind === 'm3u')
    return `${errorMessage('iptv_too_large')} ${IPTV_TOO_LARGE_HINT}`;
  if (isAnyErrorCode(error.code) && error.code !== 'internal_error') {
    const retried = error.data?.attempts === 2 && RETRIED_HINT_CODES.has(error.code);
    return retried
      ? `${errorMessage(error.code)}${IPTV_SAVE_RETRIED_HINT}`
      : errorMessage(error.code);
  }
  return IPTV_FALLBACK_ERROR;
}

// ---- Tarjeta (§1.3) ---------------------------------------------------------------

export type IptvCapsule = {
  tone: 'ok' | 'neutral' | 'weak';
  text: 'Activa' | 'En pausa' | 'Con fallos';
};

export function capsuleOf(
  provider: Pick<IptvProviderView, 'enabled' | 'status' | 'staleSince'>,
): IptvCapsule {
  if (!provider.enabled || provider.status === 'disabled')
    return { tone: 'neutral', text: 'En pausa' };
  if (provider.status === 'error' || provider.staleSince)
    return { tone: 'weak', text: 'Con fallos' };
  return { tone: 'ok', text: 'Activa' };
}

export function kindLabel(kind: IptvKind): string {
  return kind === 'xtream' ? 'Xtream' : 'M3U';
}

/** «Xtream · 812 canales · actualizada 26 sept, 20:30» (formato de sourceMeta de «Listas»). */
export function metaLine(
  provider: Pick<IptvProviderView, 'kind' | 'channels' | 'updatedAt'>,
): string {
  const head = `${kindLabel(provider.kind)} · ${channelsText(provider.channels)}`;
  return provider.updatedAt
    ? `${head} · actualizada ${sourceDate(provider.updatedAt)}`
    : `${head} · sin sincronizar`;
}

/** «proveedor.example:8080 · usuario y contraseña guardados» o «proveedor.example · dirección guardada». */
export function hostLine(
  provider: Pick<IptvProviderView, 'kind' | 'host' | 'hasUrl' | 'hasUsername' | 'hasPassword'>,
): string {
  if (provider.kind === 'xtream') {
    const saved =
      provider.hasUsername && provider.hasPassword
        ? 'usuario y contraseña guardados'
        : provider.hasUsername
          ? 'usuario guardado'
          : provider.hasPassword
            ? 'contraseña guardada'
            : 'sin credenciales';
    return `${provider.host} · ${saved}`;
  }
  return `${provider.host} · ${provider.hasUrl ? 'dirección guardada' : 'sin dirección'}`;
}

export interface CardLine {
  text: string;
  tone: 'plain' | 'weak' | 'err';
}

function shortDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

/**
 * Línea de la cuenta (solo Xtream), por prioridad: caducada o desactivada;
 * todas sus conexiones en uso fuera de Ace Player (sin contar las nuestras);
 * y si no, hasta cuándo dura y cuántas conexiones admite.
 */
export function accountLine(account: IptvStatus['account']): CardLine | null {
  if (!account) return null;
  if (account.status === 'expired' || account.status === 'banned' || account.status === 'disabled')
    return { text: 'La cuenta de tu IPTV ha caducado o está desactivada.', tone: 'err' };
  const max = account.maxConnections;
  const active = account.activeConnections;
  if (max !== null && max > 0 && active !== null && active - account.ours >= max)
    return {
      text: 'Tu cuenta tiene todas sus conexiones en uso fuera de Ace Player.',
      tone: 'weak',
    };
  const parts: string[] = [];
  if (account.status === 'active')
    parts.push(
      account.expiresAt && shortDay(account.expiresAt)
        ? `Cuenta activa hasta el ${shortDay(account.expiresAt)}`
        : 'Cuenta activa',
    );
  if (max !== null && max > 0)
    parts.push(max === 1 ? '1 conexión a la vez' : `${max} conexiones a la vez`);
  return parts.length ? { text: parts.join(' · '), tone: 'plain' } : null;
}

/** Sin la mayúscula ni el punto final: «Tu proveedor no responde.» → «tu proveedor no responde». */
function asClause(message: string): string {
  const text = message.trim().replace(/[.。]+$/, '');
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** «No se pudo actualizar: {motivo}. Se conserva la copia del {26 sept, 20:30}.» (como DIRECTORY_NOTE). */
export function staleLine(
  provider: Pick<IptvProviderView, 'staleSince' | 'error' | 'updatedAt'>,
): CardLine | null {
  if (!provider.staleSince) return null;
  const reason = provider.error ? asClause(provider.error.message) : 'no respondió';
  return {
    text: `No se pudo actualizar: ${reason}. Se conserva la copia del ${sourceDate(provider.staleSince)}.`,
    tone: 'err',
  };
}

/**
 * La línea de la guía, lo único visible de la guía (§1.3 y §3.6). Sin guía,
 * no sale nada: todo funciona igual.
 */
export function guideLine(guide: IptvStatus['guide']): string | null {
  const failedLater =
    guide.failedAt !== null &&
    (guide.updatedAt === null || Date.parse(guide.failedAt) > Date.parse(guide.updatedAt));
  if (guide.updatedAt && failedLater)
    return `Guía: no se pudo actualizar; se usa la del ${sourceDate(guide.updatedAt)}`;
  if (guide.available && guide.updatedAt)
    return `Guía: ${guide.channelsWithGuide.toLocaleString('es-ES')} canales con programación · actualizada ${sourceDate(guide.updatedAt)}`;
  return null;
}

/** El nombre que se enseña: el guardado o, si falta, el que pone el servidor. */
export function providerName(view: IptvView | undefined, fallback = IPTV_DEFAULT_NAME): string {
  return view?.provider?.name || fallback;
}
