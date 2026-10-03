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
   `http://`), la forma corta `/<usuario>/<clave>/<id>.ts` de los paneles,
   cabeceras `Authorization`/`Bearer`/`Basic`, cookies, JWT, campos JSON con
   secretos, correos e IPs PÚBLICAS (las privadas y de Tailscale se quedan:
   dicen qué contenedor no responde). Los hashes AceStream y los ids IPTV NO
   se tapan: identifican la fuente y no dan acceso a nada. */

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

/* Lo que delata la decodificación en un código o una frase del reproductor (hls.js, mpegts.js, <video>). */
const DECODE_RE =
  /decod|codec|c[oó]dec|media_err_decode|buffer_?append|frag_?parsing|no se puede decodificar/i;
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
  const byCode = pieceOfCode(key);
  if (byCode) return piece(byCode);
  if (DECODE_RE.test(key)) return piece('decodificacion');
  if (cause === 'client' && DECODE_RE.test(message)) return piece('decodificacion');
  if (cause && CAUSE_PIECE[cause]) return piece(CAUSE_PIECE[cause]);
  return piece('otro');
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
  if (/\bmotor\b|engine/i.test(text)) return piece('motor');
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

/**
 * Tapa en un texto libre todo lo que parece un secreto o un dato privado
 * (ver la cabecera). No toca hashes AceStream, ids IPTV, horas ni versiones.
 */
export function redactReportText(text: string): string {
  let out = String(text ?? '');
  // Credenciales en una URL: esquema://usuario:clave@host
  out = out.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s?#@"'<>]+@/gi, '$1•••@');
  // Tramos Xtream con o sin esquema: /live/<usuario>/<clave>/<id>
  out = out.replace(
    new RegExp(`/(${XTREAM_KIND})/[^/\\s?#"'<>]+/[^/\\s?#"'<>]+(?=/)`, 'gi'),
    '/$1/•••/•••',
  );
  // Forma corta de los paneles en una URL: http(s)://host[:puerto]/<usuario>/<clave>/<número>(.ext)
  out = out.replace(
    /(\bhttps?:\/\/[^/\s?#"'<>]+)\/(?!•••)[^/\s?#"'<>]+\/(?!•••)[^/\s?#"'<>]+\/(\d+)(\.[a-z0-9]{1,5})?(?=[\s?#"'<>]|$)/gi,
    '$1/•••/•••/$2$3',
  );
  // Ticket del relé local: /r/<ticket>/
  out = out.replace(/\/r\/[A-Za-z0-9_-]{8,}(?=\/|\b)/g, '/r/•••');
  // Cabeceras: Authorization: Bearer x / Basic x, y «Bearer x» suelto
  out = out.replace(
    /\b(authorization|proxy-authorization)(["']?\s*[:=]\s*["']?)[^\s"',;}]+(?:\s+[^\s"',;}]+)?/gi,
    `$1$2${REPORT_REDACTED}`,
  );
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/g, `$1 ${REPORT_REDACTED}`);
  // Cookies
  out = out.replace(
    /\b(set-cookie|cookie)(["']?\s*[:=]\s*["']?)[^\n"'}]+/gi,
    `$1$2${REPORT_REDACTED}`,
  );
  // Campos JSON con secretos: "password":"x", "token": "y"
  out = out.replace(
    new RegExp(
      `(["'])(${SECRET_PARAM}|authorization|cookie|seed)\\1(\\s*:\\s*)(["'])(?:\\\\.|(?!\\4).)*\\4`,
      'gi',
    ),
    `$1$2$1$3$4${REPORT_REDACTED}$4`,
  );
  // nombre=valor (query de una URL o texto suelto): ?username=a&password=b, t=xyz
  out = out.replace(
    new RegExp(`(^|[?&;,\\s"'(])(${SECRET_PARAM})=([^&\\s"'<>#;,)]+)`, 'gi'),
    (_match, before: string, name: string) => `${before}${name}=${REPORT_REDACTED}`,
  );
  // JWT
  out = out.replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, '[token]');
  // Correos
  out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[correo]');
  // IPs públicas
  out = maskIpv4(out);
  out = out.replace(IPV6_GLOBAL_RE, '[ip pública]');
  return out;
}

/** Claves de un objeto cuyo valor nunca se escribe (cabeceras, secretos, usuario). */
export const REPORT_SECRET_KEY_RE =
  /^(password|passwd|pass|pwd|passphrase|secret|token|access_token|refresh_token|authorization|proxy-authorization|cookie|set-cookie|username|user|usuario|seed|api_?key|apikey|t)$/i;

/**
 * Recorre un valor JSON y devuelve una copia redactada: las claves de
 * REPORT_SECRET_KEY_RE se tapan enteras y cada texto pasa por `clean`
 * (por defecto, `redactReportText`). Cuenta los textos que cambian.
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
  if (value === null || typeof value !== 'object' || depth > 8) return value;
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
