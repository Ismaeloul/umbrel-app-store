/* «Descargar fallos» (0.9.0): de quién es cada fallo y cómo se tapa lo
   privado del texto libre. Funciones puras: las usa el servidor al montar el
   fichero (apps/server/src/modules/diagnostics/export.ts) y la demo de la web.

   Clasificación («nuestro» / «de fuera», api/v1/diagnostics-export.ts):
   primero por el CÓDIGO (el catálogo de errores y los del registro de
   fallos), después por la causa del registro (motor, fuente, red, códec,
   cliente, datos) y, para las líneas del log del servidor, por su módulo y
   su frase. Lo que no encaja queda «sin clasificar» (pieza `otro`): mejor
   eso que adivinar.

   Redacción: `redactReportText` tapa lo que se puede reconocer SIN conocer
   el secreto (el servidor pasa antes el redactor de la IPTV, que sí conoce
   el usuario y la contraseña guardados): credenciales en URLs (`user:pass@`,
   parámetros como `password=`, `token=`, `t=`…), los tramos Xtream
   `/live|movie|series|timeshift/<usuario>/<clave>/` (también sin
   `http://`), la forma corta `/<usuario>/<clave>/<id>` de los paneles (con
   o sin esquema y con ruta detrás), cabeceras `Authorization`/`Bearer`/
   `Basic`/`X-Api-Key`…, cookies, JWT, campos JSON con secretos (también
   sin comillas en el valor), `password: x` y `clave='x'` en texto suelto,
   correos e IPs PÚBLICAS (las privadas y de Tailscale se quedan: dicen qué
   contenedor no responde). Lo mismo en una URL codificada (`%2Flive%2F…`,
   `%3Fusername%3D…`) o con las barras escapadas de JSON (`http:\/\/…`).
   Los hashes AceStream y los ids IPTV NO se tapan: identifican la fuente y
   no dan acceso a nada. Ninguna expresión es ambigua (sin retroceso
   exponencial): el informe se monta en el mismo hilo que sirve el vídeo. */

import type {
  FaultLevel,
  FaultPiece,
  FaultSide,
  WebLogEntry,
} from '../api/v1/diagnostics-export.js';

export interface FaultClass {
  readonly side: FaultSide;
  readonly piece: FaultPiece;
}

/** De qué lado cae cada pieza. */
export const FAULT_PIECE_SIDE: Readonly<Record<FaultPiece, FaultSide>> = {
  motor: 'nuestro',
  decodificacion: 'nuestro',
  rele: 'nuestro',
  remux: 'nuestro',
  reproductor: 'nuestro',
  web: 'nuestro',
  servidor: 'nuestro',
  datos: 'nuestro',
  fuente: 'de_fuera',
  proveedor: 'de_fuera',
  red: 'de_fuera',
  terceros: 'de_fuera',
  otro: 'sin_clasificar',
};

/** Nombre de cada pieza para el resumen. */
export const FAULT_PIECE_LABEL: Readonly<Record<FaultPiece, string>> = {
  motor: 'motor AceStream',
  decodificacion: 'decodificación de vídeo',
  rele: 'relé de la IPTV',
  remux: 'remux (ffmpeg)',
  reproductor: 'reproductor de la web',
  web: 'errores de la web',
  servidor: 'servidor',
  datos: 'datos guardados',
  fuente: 'fuentes que no van',
  proveedor: 'proveedor IPTV',
  red: 'red',
  terceros: 'servicios de fuera (agenda, escudos, IA)',
  otro: 'sin clasificar',
};

const piece = (name: FaultPiece): FaultClass => ({ side: FAULT_PIECE_SIDE[name], piece: name });

/* Códigos exactos (catálogo de errores, registro de fallos y reproductor). */
const CODE_PIECE: Readonly<Record<string, FaultPiece>> = {
  // Motor AceStream (y el comprobador, que es otro motor nuestro)
  engine_timeout: 'motor',
  engine_unavailable: 'motor',
  engine_bad_response: 'motor',
  ace_timeout: 'motor',
  restart_cooldown: 'motor',
  restart_failed: 'motor',
  restart_timeout: 'motor',
  engine_stalled: 'motor',
  engine_auto_restart: 'motor',
  engine_auto_restart_exhausted: 'motor',
  engine_not_ready: 'motor',
  engine_stop_failed: 'motor',
  scanner_session_leak: 'motor',
  scanner_unavailable: 'motor',
  scanner_bad_response: 'motor',
  scanner_response_too_large: 'motor',
  scanner_session_failed: 'motor',
  // Decodificación
  unsupported_codec: 'decodificacion',
  // Remux
  remux_busy: 'remux',
  remux_died: 'remux',
  remux_timeout: 'remux',
  ffmpeg_missing: 'remux',
  // Relé de la IPTV: se le cae la conexión con el proveedor y agota los reintentos
  iptv_dropped: 'rele',
  // Servidor
  internal_error: 'servidor',
  not_implemented: 'servidor',
  invalid_response: 'servidor',
  bad_response: 'servidor',
  // Datos guardados
  state_unreadable: 'datos',
  crests_index_unreadable: 'datos',
  crests_unwritable: 'datos',
  iptv_secret_unreadable: 'datos',
  // Reproductor: lo que apunta al agotar los reintentos sin un código del
  // servidor (playerFailureCode) y el trozo dañado que hls.js salta en el sitio.
  player_decode_failed: 'decodificacion',
  player_decode_skipped: 'decodificacion',
  player_stalled: 'reproductor',
  // Fuentes
  source_no_peers: 'fuente',
  player_source_failed: 'fuente',
  scanner_timeout: 'fuente',
  // Proveedor IPTV
  iptv_auth_failed: 'proveedor',
  iptv_account_expired: 'proveedor',
  iptv_unreachable: 'proveedor',
  iptv_timeout: 'proveedor',
  iptv_busy: 'proveedor',
  iptv_gone: 'proveedor',
  iptv_bad_list: 'proveedor',
  iptv_empty: 'proveedor',
  iptv_too_large: 'proveedor',
  iptv_unsupported: 'proveedor',
  // Red (también la de la web con el NAS)
  network: 'red',
  timeout: 'red',
  dns_failed: 'red',
  fetch_timeout: 'red',
  fetch_failed: 'red',
  redirect_limit: 'red',
  redirect_loop: 'red',
  response_too_large: 'red',
  unsupported_encoding: 'red',
  empty_directory: 'red',
  source_not_found: 'red',
  // Terceros
  crest_rate_limited: 'terceros',
  crest_lookup_failed: 'terceros',
  fltv_empty: 'terceros',
  football_unavailable: 'terceros',
  epg_unavailable: 'terceros',
  epg_bad_response: 'terceros',
  epg_empty: 'terceros',
  ollama_unavailable: 'terceros',
  ollama_timeout: 'terceros',
  ollama_bad_response: 'terceros',
  ollama_response_too_large: 'terceros',
};

/* Prefijos: familias enteras. */
const CODE_PREFIX: ReadonlyArray<readonly [string, FaultPiece]> = [
  ['engine_', 'motor'],
  ['remux_', 'remux'],
  ['ipfs_', 'red'],
  ['http_', 'red'],
  ['redirect_', 'red'],
  ['ollama_', 'terceros'],
  ['epg_', 'terceros'],
  ['crest_', 'terceros'],
];

/* Lo que delata la decodificación en un código o una frase del reproductor:
   hls.js (bufferAppendError, bufferAppendingError, fragParsingError,
   bufferAddCodecError…), mpegts.js (MediaMSEError, MediaFormatError,
   MediaFormatUnsupported, MediaCodecUnsupported) y el <video>
   (MEDIA_ERR_DECODE). */
const DECODE_RE =
  /decod|codec|c[oó]dec|media_err_decode|buffer_?append|frag_?parsing|mediamseerror|media_?format|no se puede decodificar/i;
/* Lo que delata el relé de la IPTV («relé» acaba en una letra que \b no ve). */
const RELAY_RE = /\brel[eé](?![a-z])|\brelay/i;

/** Pieza de un código suelto (o null si no se sabe). */
function pieceOfCode(code: string): FaultPiece | null {
  const key = code.toLowerCase();
  const exact = CODE_PIECE[key];
  if (exact) return exact;
  for (const [prefix, name] of CODE_PREFIX) if (key.startsWith(prefix)) return name;
  return null;
}

const CAUSE_PIECE: Readonly<Record<string, FaultPiece>> = {
  engine: 'motor',
  source: 'fuente',
  network: 'red',
  codec: 'decodificacion',
  client: 'reproductor',
  state: 'datos',
};

/**
 * Un fallo del registro (causa + código) o un error de la API. Las métricas
 * de fin de reproducción (`player_session`) y el arranque sin sonido que
 * bloquea el navegador (`autoplay_blocked`) no son fallos: quedan «sin
 * clasificar» para que no cuenten como nuestros.
 */
export function classifyCode(code: string, cause?: string | null, message = ''): FaultClass {
  const key = code.toLowerCase();
  if (key === 'player_session' || key === 'autoplay_blocked') return piece('otro');
  // ffmpeg que muere por el códec es decodificación; si no, el remux.
  if (key === 'remux_died') return piece(cause === 'codec' ? 'decodificacion' : 'remux');
  /* El reproductor agotó los reintentos sin un código más preciso: lo que
     guardó una web de antes de la 0.9.0 (el registro vive en disco) o la app
     de iPhone. Si la frase delata la decodificación o el relé, es nuestro;
     si no, la fuente. */
  if (key === 'player_source_failed') {
    if (DECODE_RE.test(message)) return piece('decodificacion');
    if (RELAY_RE.test(message)) return piece('rele');
    return piece('fuente');
  }
  const byCode = pieceOfCode(key);
  if (byCode) return piece(byCode);
  if (DECODE_RE.test(key)) return piece('decodificacion');
  if (cause === 'client' && DECODE_RE.test(message)) return piece('decodificacion');
  if (cause && CAUSE_PIECE[cause]) return piece(CAUSE_PIECE[cause]);
  return piece('otro');
}

/**
 * Código con el que el reproductor apunta una fuente que agota los
 * reintentos sin un código del servidor (registro de fallos, arquitectura
 * §5.14), a partir de la frase y el detalle del ÚLTIMO fallo:
 * - un código conocido en el detalle (el `stream.closed` del servidor trae
 *   `engine_unavailable`, `remux_died`, `remux_failed`…) se usa tal cual;
 * - la decodificación (hls.js que no puede añadir o leer un trozo, mpegts.js
 *   con un error de MSE o de formato, el <video> con MEDIA_ERR_DECODE) es
 *   `player_decode_failed`: nuestra, no de la fuente;
 * - si no, `player_source_failed` (la fuente no da señal).
 * La imagen parada con búfer de sobra (`player_stalled`) la decide el propio
 * reproductor, que es quien ve el búfer.
 */
export function playerFailureCode(reason: string, detail?: string | null): string {
  const extra = String(detail ?? '').trim();
  if (/^[a-z][a-z0-9_]{2,39}$/.test(extra) && pieceOfCode(extra)) return extra;
  if (DECODE_RE.test(reason) || DECODE_RE.test(extra)) return 'player_decode_failed';
  return 'player_source_failed';
}

/** Lo que tiene una línea del registro del servidor (pino) para clasificarla. */
export interface LogLineFacts {
  readonly level: FaultLevel;
  readonly module?: string | undefined;
  readonly msg?: string | undefined;
  readonly errorCode?: string | undefined;
  /** Mensaje del `err` serializado, si lo lleva. */
  readonly error?: string | undefined;
}

/** Una línea `warn`/`error` del log del servidor. */
export function classifyLogLine(line: LogLineFacts): FaultClass {
  const text = `${line.msg ?? ''} ${line.error ?? ''}`;
  if (line.errorCode) {
    if (line.errorCode === 'remux_died')
      return piece(DECODE_RE.test(text) ? 'decodificacion' : 'remux');
    const byCode = pieceOfCode(line.errorCode);
    if (byCode) return piece(byCode);
  }
  if (RELAY_RE.test(text)) return piece('rele');
  switch (line.module) {
    case 'engine':
      return piece('motor');
    case 'remux':
      return piece(DECODE_RE.test(text) ? 'decodificacion' : 'remux');
    case 'iptv':
      if (/gu[ií]a|epg|xmltv/i.test(text)) return piece('proveedor');
      if (/guardar|leer|escrib|disco|\.json|catálogo IPTV/i.test(text)) return piece('datos');
      return piece('proveedor');
    default:
      break;
  }
  // La configuración del arranque (ACE_SEED, ENGINE_CONTROL_TOKEN…) es nuestra, pero no del motor.
  if (
    /\b(?:ACE_[A-Z_]+|ENGINE_CONTROL_[A-Z_]+|ACESTREAM_[A-Z_]+|DATA_DIR|AUTO_SYNC|FOOTBALL_[A-Z_]+)\b|configuraci[oó]n|claves aleatorias/.test(
      text,
    )
  )
    return piece('servidor');
  if (/\bmotor\b|\bengine\b/i.test(text)) return piece('motor');
  if (/ffmpeg|remux/i.test(text)) return piece(DECODE_RE.test(text) ? 'decodificacion' : 'remux');
  if (
    /escudos|thesportsdb|futbolenlatv|agenda: (fuente|ninguna)|ia-programacion|ollama/i.test(text)
  )
    return piece('terceros');
  if (/directorio|auto-sync|sync-al-resolver/i.test(text)) return piece('red');
  if (/estado|state\.json|sessions\.json|\.bak|no se pudo (guardar|leer|escribir)/i.test(text))
    return piece('datos');
  return line.level === 'error' ? piece('servidor') : piece('otro');
}

/** Una línea del anillo de la web. */
export function classifyWebEntry(
  entry: Pick<WebLogEntry, 'kind' | 'code' | 'message'>,
): FaultClass {
  switch (entry.kind) {
    case 'api': {
      if (entry.code && /^http_5\d\d$/.test(entry.code)) return piece('servidor');
      if (entry.code) return classifyCode(entry.code, null, entry.message);
      return piece('red');
    }
    case 'player':
      if (entry.code) {
        const byCode = classifyCode(entry.code, null, entry.message);
        if (byCode.piece !== 'otro' || /^(player_session|autoplay_blocked)$/.test(entry.code))
          return byCode;
      }
      if (DECODE_RE.test(entry.message)) return piece('decodificacion');
      if (RELAY_RE.test(entry.message)) return piece('rele');
      return piece('reproductor');
    default:
      return piece('web');
  }
}

/**
 * Nombre del fichero: `ace-player-neo-fallos-2026-10-03-2145.json`, en hora
 * de Madrid (como la agenda). Lo usan el servidor (Content-Disposition) y la
 * web (al guardarlo).
 */
export function faultsFileName(at: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(at))
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return `ace-player-neo-fallos-${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}.json`;
}

// ---- Resumen -----------------------------------------------------------------

export interface FaultSummary {
  nuestro: number;
  deFuera: number;
  sinClasificar: number;
  byPiece: Array<{ piece: FaultPiece; side: FaultSide; count: number }>;
  lines: string[];
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Recuentos por lado y por pieza y unas frases para leer de un vistazo
 * («Nuestro: 3 (relé de la IPTV 2, motor AceStream 1)»). Lo de nivel `info`
 * (métricas, avisos) no cuenta.
 */
export function summarizeFaults(
  faults: ReadonlyArray<{ side: FaultSide; piece: FaultPiece; level: FaultLevel }>,
): FaultSummary {
  const counted = faults.filter((fault) => fault.level !== 'info');
  const byKey = new Map<FaultPiece, number>();
  for (const fault of counted) byKey.set(fault.piece, (byKey.get(fault.piece) ?? 0) + 1);
  const byPiece = [...byKey]
    .map(([name, count]) => ({ piece: name, side: FAULT_PIECE_SIDE[name], count }))
    .sort((a, b) => b.count - a.count || a.piece.localeCompare(b.piece));
  const total = (side: FaultSide) =>
    byPiece.filter((row) => row.side === side).reduce((sum, row) => sum + row.count, 0);
  const nuestro = total('nuestro');
  const deFuera = total('de_fuera');
  const sinClasificar = total('sin_clasificar');
  const detail = (side: FaultSide) =>
    byPiece
      .filter((row) => row.side === side)
      .map((row) => `${FAULT_PIECE_LABEL[row.piece]} ${row.count}`)
      .join(', ');
  const lines: string[] = [];
  if (!counted.length) lines.push('Sin fallos en lo que guardan el servidor y la web.');
  else {
    lines.push(
      `Nuestro: ${plural(nuestro, 'fallo', 'fallos')}${nuestro ? ` (${detail('nuestro')})` : ''}.`,
    );
    lines.push(
      `De fuera: ${plural(deFuera, 'fallo', 'fallos')}${deFuera ? ` (${detail('de_fuera')})` : ''}.`,
    );
    if (sinClasificar) lines.push(`Sin clasificar: ${plural(sinClasificar, 'fallo', 'fallos')}.`);
  }
  return { nuestro, deFuera, sinClasificar, byPiece, lines };
}

// ---- Redacción del texto libre -----------------------------------------------

/** Marca de lo tapado. */
export const REPORT_REDACTED = '[redactado]';
/** Parámetros de query o de texto `nombre=valor` que nunca se escriben. */
const SECRET_PARAM =
  '(?:username|user|usuario|password|passwd|pass|pwd|clave|token|access_token|refresh_token|auth|key|api_?key|apikey|secret|passphrase|signature|sig|t)';
const XTREAM_KIND = '(?:live|movie|series|timeshift)';

/** Rangos IPv4 que NO son públicos (se dejan: dicen qué contenedor o equipo de casa). */
function isPrivateIpv4(parts: readonly number[]): boolean {
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT y Tailscale
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multidifusión y reservadas
  );
}

function maskIpv4(text: string): string {
  /* Ni dentro de un número más largo ni detrás de «Palabra/» (versiones del
     navegador: «Chrome/120.0.0.0»); sí detrás de «//» (una URL). */
  const re = /(?<![\w.])(?<![A-Za-z]\/)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\w.]*\d)/g;
  return text.replace(re, (match) => {
    const parts = match.split('.').map(Number);
    if (parts.some((part) => part > 255)) return match;
    return isPrivateIpv4(parts) ? match : '[ip pública]';
  });
}

/* IPv6 global (2000::/3): empieza por 2xxx o 3xxx. Las locales (fe80::,
   fc00::/7) y ::1 se quedan. Un grupo de 4 hex delante de «:» no sale en
   horas («15:42:10») ni en hashes. */
const IPV6_GLOBAL_RE = /(?<![\w:])[23][0-9a-f]{3}:(?:[0-9a-f]{0,4}:){1,6}[0-9a-f]{0,4}(?![\w:])/gi;

/** Ruta de una URL: un tramo entre barras. */
const SEGMENT = `[^/\\s?#"'<>]+`;
/* La forma corta de los paneles, `/<usuario>/<clave>/<número>(.ext)`, al
   final de la URL o con más ruta detrás (`/12345/index.m3u8`). */
const SHORT_FORM_TAIL = `\\/(?!•••)${SEGMENT}\\/(?!•••)${SEGMENT}\\/(\\d+)(\\.[a-z0-9]{1,5})?(?=[\\s?#"'<>/),;]|$)`;
const SHORT_FORM_URL_RE = new RegExp(`(\\bhttps?:\\/\\/[^/\\s?#"'<>]+)${SHORT_FORM_TAIL}`, 'gi');
/* Sin esquema: `prov.example.com:8080/…`, `81.45.1.9/…` o `prov:8080/…`, al
   principio de una palabra (no dentro de una ruta ni de una URL). */
const SHORT_FORM_BARE_RE = new RegExp(
  `(?<![\\w.@/:%\\\\-])((?:[a-z0-9-]+\\.)+[a-z][a-z0-9-]*(?::\\d{1,5})?|\\d{1,3}(?:\\.\\d{1,3}){3}(?::\\d{1,5})?|[a-z][a-z0-9-]*:\\d{1,5})${SHORT_FORM_TAIL}`,
  'gi',
);
/* Campos JSON (o de un objeto escrito) con secretos: `"password":"x"`,
   `'token': 'y'`, `"pin": 1234`. El valor entre comillas acaba en su comilla
   o, si está cortado, al final de la línea (mejor tapar de más). Sin
   ambigüedad: una barra invertida solo la come `\\[\s\S]`. */
const JSON_SECRET_RE = new RegExp(
  `(["'])(${SECRET_PARAM}|authorization|cookie|seed)\\1(\\s*:\\s*)` +
    `("(?:[^"\\\\\\n]|\\\\[\\s\\S])*\\\\?(?:"|(?=\\n)|$)` +
    `|'(?:[^'\\\\\\n]|\\\\[\\s\\S])*\\\\?(?:'|(?=\\n)|$)` +
    `|(?![{\\[])[^\\s"',}\\]]+)`,
  'gi',
);
/* nombre=valor (query de una URL o texto suelto), con o sin comillas. */
const PARAM_SECRET_RE = new RegExp(
  `(^|[?&;,\\s"'(])(${SECRET_PARAM})=(["']?)(?!\\[redactado\\])([^&\\s"'<>#;,)]+)`,
  'gi',
);
/* «password: x», «contraseña = x», «clave='x'» en texto suelto (solo los
   nombres que no dejan dudas: `t:` o `key:` en una frase pueden ser otra cosa). */
const SECRET_LABEL =
  '(?:password|passwd|pwd|passphrase|contrase(?:ñ|n)a|clave|secret|token|access_token|refresh_token|api_?key|apikey|username|usuario|user)';
const LABEL_SECRET_RE = new RegExp(
  `(^|[^A-Za-z0-9ñ-])(${SECRET_LABEL})(\\s*[:=]\\s*)(["']?)(?!\\[redactado\\]|•••)([^\\s"'<>&#;,)}\\]]+)`,
  'gi',
);
/* Cabeceras con claves (`X-Api-Key`, `X-Auth-Token`, `X-Engine-Token`…); el
   nombre, acotado (una tira de «x-a-x-a…» no se vuelve cuadrática). */
const KEY_HEADER_RE =
  /\b(x-[a-z0-9-]{0,40}?(?:key|token|secret|auth[a-z]*|signature|password|pass)|api-key)(["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi;

/* Lo que se reconoce en el texto tal cual (redactReportText añade lo codificado). */
function redactPlain(text: string): string {
  let out = text;
  // Credenciales en una URL: esquema://usuario:clave@host
  out = out.replace(/(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^/\s?#@"'<>]+@/gi, '$1•••@');
  // Tramos Xtream con o sin esquema: /live/<usuario>/<clave>/<id>
  out = out.replace(
    new RegExp(`/(${XTREAM_KIND})/${SEGMENT}/${SEGMENT}(?=/)`, 'gi'),
    '/$1/•••/•••',
  );
  // Forma corta de los paneles: [http(s)://]host[:puerto]/<usuario>/<clave>/<número>(.ext)[/…]
  out = out.replace(SHORT_FORM_URL_RE, '$1/•••/•••/$2$3');
  out = out.replace(SHORT_FORM_BARE_RE, '$1/•••/•••/$2$3');
  // Ticket del relé local: /r/<ticket>/
  out = out.replace(/\/r\/[A-Za-z0-9_-]{8,}(?=\/|\b)/g, '/r/•••');
  // La clave de TheSportsDB va en la ruta (/api/v1/json/<clave>/…); la pública (123, 3) se ve.
  out = out.replace(/(\/api\/v\d+\/json\/)(?!(?:3|123)\/|•••)[^/\s?#"'<>]+(?=\/)/gi, '$1•••');
  // Cabeceras: Authorization: Bearer x / Basic x, y «Bearer x» suelto
  out = out.replace(
    /\b(authorization|proxy-authorization)(["']?\s*[:=]\s*["']?)[^\s"',;}]+(?:\s+[^\s"',;}]+)?/gi,
    `$1$2${REPORT_REDACTED}`,
  );
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/g, `$1 ${REPORT_REDACTED}`);
  out = out.replace(KEY_HEADER_RE, `$1$2${REPORT_REDACTED}`);
  // Cookies
  out = out.replace(
    /\b(set-cookie|cookie)(["']?\s*[:=]\s*["']?)[^\n"'}]+/gi,
    `$1$2${REPORT_REDACTED}`,
  );
  // Campos JSON con secretos: "password":"x", "token": "y", "pin": 1234
  out = out.replace(
    JSON_SECRET_RE,
    (_match, quote: string, name: string, colon: string, value: string) => {
      const around = value.startsWith('"') || value.startsWith("'") ? value.charAt(0) : '';
      return `${quote}${name}${quote}${colon}${around}${REPORT_REDACTED}${around}`;
    },
  );
  // nombre=valor: ?username=a&password=b, t=xyz, password='x'
  out = out.replace(
    PARAM_SECRET_RE,
    (_match, before: string, name: string, quote: string) =>
      `${before}${name}=${quote}${REPORT_REDACTED}`,
  );
  // nombre: valor en texto suelto
  out = out.replace(
    LABEL_SECRET_RE,
    (_match, before: string, name: string, separator: string, quote: string) =>
      `${before}${name}${separator}${quote}${REPORT_REDACTED}`,
  );
  // JWT
  out = out.replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, '[token]');
  // Correos (desde el principio de la palabra: sin volver a empezar en cada letra)
  out = out.replace(
    /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
    '[correo]',
  );
  // El usuario del sistema en una ruta de las pilas (C:\Users\<nombre>\…, /home/<nombre>/…)
  out = out.replace(/([\\/](?:Users|home)[\\/])[^\\/\s"'<>:]+(?=[\\/])/g, '$1•••');
  // IPs públicas
  out = maskIpv4(out);
  out = out.replace(IPV6_GLOBAL_RE, '[ip pública]');
  return out;
}

/* Una palabra con algo codificado (`%2F`, `%3D`…) o con las barras escapadas
   de JSON (`http:\/\/…`): se mira también descodificada y, si así se ve un
   secreto, sale descodificada y tapada. Si no, se queda como estaba. */
function redactEncoded(text: string): string {
  return text.replace(/[^\s"'<>]+/g, (word) => {
    if (!word.includes('%') && !word.includes('\\/')) return word;
    let plain = word.replace(/\\\//g, '/');
    for (let round = 0; round < 2 && /%[0-9a-f]{2}/i.test(plain); round += 1) {
      plain = plain.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
        try {
          return decodeURIComponent(run);
        } catch {
          return run;
        }
      });
    }
    if (plain === word) return word;
    const cleaned = redactPlain(plain);
    return cleaned === plain ? word : cleaned;
  });
}

/**
 * Tapa en un texto libre todo lo que parece un secreto o un dato privado
 * (ver la cabecera). No toca hashes AceStream, ids IPTV, horas ni versiones.
 */
export function redactReportText(text: string): string {
  return redactPlain(redactEncoded(String(text ?? '')));
}

/** Claves de un objeto cuyo valor nunca se escribe (cabeceras, secretos, usuario). */
export const REPORT_SECRET_KEY_RE =
  /^(password|passwd|pass|pwd|passphrase|secret|token|access_token|refresh_token|authorization|proxy-authorization|cookie|set-cookie|username|user|usuario|seed|api_?key|apikey|t)$/i;

/** Hasta dónde se baja en un valor anidado; más hondo, el valor entero se tapa. */
export const REPORT_MAX_DEPTH = 32;
/** Marca de un objeto o una lista demasiado anidados para recorrerlos. */
export const REPORT_TOO_DEEP = '[redactado: demasiado anidado]';

/**
 * Recorre un valor JSON y devuelve una copia redactada: las claves de
 * REPORT_SECRET_KEY_RE se tapan enteras y cada texto pasa por `clean`
 * (por defecto, `redactReportText`). Cuenta los textos que cambian. Falla
 * CERRADO: un objeto o una lista a más de REPORT_MAX_DEPTH niveles no sale
 * tal cual, sale REPORT_TOO_DEEP.
 */
export function redactReportValue(
  value: unknown,
  clean: (text: string) => string = redactReportText,
  counter: { replaced: number } = { replaced: 0 },
  depth = 0,
): unknown {
  if (typeof value === 'string') {
    const cleaned = clean(value);
    if (cleaned !== value) counter.replaced += 1;
    return cleaned;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth > REPORT_MAX_DEPTH) {
    counter.replaced += 1;
    return REPORT_TOO_DEEP;
  }
  if (Array.isArray(value))
    return value.map((item) => redactReportValue(item, clean, counter, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (REPORT_SECRET_KEY_RE.test(key) && field !== null && field !== undefined && field !== '') {
      out[key] = REPORT_REDACTED;
      counter.replaced += 1;
      continue;
    }
    out[key] = redactReportValue(field, clean, counter, depth + 1);
  }
  return out;
}
