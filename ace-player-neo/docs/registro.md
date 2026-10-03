# Registro en disco y «Descargar logs» (0.9.0)

Lo pidió Isma: un botón en Ajustes para descargar los logs y pasárselos a quien ayude, para que **dentro de un
mes** se pueda ver dónde falló la app. Va encima de «Descargar fallos» (Salud, equipo pulido), que solo ve lo que
hay en memoria desde el último arranque.

## Dónde se ve

**Ajustes → Registro** (`?vista=ajustes/registro`): lo guardado en el Umbrel (desde cuándo, cuánto ocupa de
40 MB, que se borra solo lo de más de 45 días), cuánto hacia atrás (1, 7 o 30 días; por defecto 30) y
**Descargar logs**. Sale un `ace-player-neo-logs-AAAA-MM-DD-HHMM.zip` (hora de Madrid).

## Qué hay en el zip

| Fichero | Qué es |
|---|---|
| `LEEME.txt` | Resumen para leer de un vistazo: versión, periodo, fallos «nuestro» / «de fuera», los que más se repiten, cada arranque (y si el anterior se apagó bien o se cortó, y si cambió la versión), cuántas líneas hay y cómo leerlas. |
| `resumen.json` | Lo mismo para un programa (`LogsSummary`, `@ace/shared` `api/v1/diagnostics-log.ts`). |
| `fallos.json` | El fichero de «Descargar fallos» tal cual (estado de ahora: salud, motor, IPTV sin secretos, remux; fallos recientes clasificados; anillos del servidor y de la web). |
| `registro.jsonl` | El registro del periodo: una línea JSON por suceso, de la más vieja a la más nueva. Como mucho 48 MiB sin comprimir (si no cabe, lo más nuevo y `truncated` en el resumen). |

## Cómo leer `registro.jsonl`

La misma forma que las líneas de pino (`docker logs`):

- `time`: hora en **UTC** (la «Z»). Madrid y París: +1 h en invierno, +2 h en verano.
- `level`: `info`, `warn`, `error` o `fatal` (debug y trace nunca van al disco).
- `version`: versión de la app que escribió la línea.
- `module` (`engine`, `iptv`, `playback`, `remux`, `instant-start`…) y `msg` (qué pasó).
- Líneas especiales:
  - `"msg":"arranque"`: cada arranque, con `node`, `platform`, `registro` y `previous`
    (`{ version, stop: "limpio" | "corte", lastLineAt, downSeconds }`; `null` en el primero).
  - `"msg":"versión nueva"`: `{ from, to }` cuando cambia la versión entre arranques.
  - `"msg":"latido"`: cada 6 h, `uptimeHours`, `rssMb`, `heapMb`, `remuxSessions`, `iptvConnections`.
  - `"msg":"apagado limpio"`: la última línea de un apagado normal.
  - `"msg":"el servidor se cae: excepción sin capturar"` (`fatal`): una caída, escrita en el acto.
  - `"msg":"registro descargado"`: cuándo se bajó un zip.
  - `"module":"fallos"`: el registro de fallos (`errorCode`, `cause`, `channel`, `hash`, `sessionId`,
    `metrics`): qué canal o fuente falló (motor, fuente sin pares, relé, códec, reproductor…).
  - `"module":"web"`: errores y avisos de la página (`kind`: error, rejection, console, api, player;
    `errorCode`, `view` = lo que se estaba viendo, `detail` = pila, `webAt` = hora del navegador,
    `client` = «Safari 18 · iOS · 390x844@3 · app instalada»).
  - `"module":"registro"`: el propio registro avisa (líneas iguales omitidas, tope del día, líneas perdidas).
  - `"omitidas": N` en una línea: hubo N iguales justo antes que no se guardaron.
- Lo tapado sale como `•••` o `[redactado]`.

Para buscar: `grep '"level":"error"' registro.jsonl`, `grep '"module":"fallos"'`, `grep '"msg":"arranque"'`.

## Dónde vive y cuánto ocupa

- `<DATA_DIR>/v2/registro/` (en el Umbrel, `${APP_DATA_DIR}/data/v2/registro/`): sobrevive a reinicios y
  actualizaciones. Carpeta 0700, ficheros 0600.
- Un fichero por día de Madrid: `registro-AAAA-MM-DD.jsonl`; al cambiar de día (o al arrancar) los cerrados se
  comprimen a `.jsonl.gz` (unas 10 veces menos).
- Topes (`@ace/shared` `constants/limits.ts`): 45 días; 40 MiB en el disco en total (se borra lo más viejo,
  nunca hoy); un día con más de 8 MiB solo guarda avisos y errores y con 12 MiB no guarda nada más (una línea lo
  dice). Una línea que se repite sin parar (mismo nivel, módulo, frase, código y estado HTTP): 60 seguidas y
  luego 6 por minuto.
- Uso normal: unos cientos de KB al día sin comprimir.

## Cómo se escribe (servidor)

- `apps/server/src/core/log-store.ts`, enganchado a pino por el mismo `streamWrite` que el anillo
  (`core/logger.ts`, opción `store`; `main.ts` lo crea con el logger de la app).
- Sin bloquear: pino solo encola (mira el nivel y pasa el redactor de la IPTV); la tanda se procesa al segundo
  cediendo el hilo cada 128 líneas y se escribe con un `appendFile`. Lo pendiente, como mucho 4 MiB.
- `flushSync` en `uncaughtExceptionMonitor` y en la salida forzada del apagado.
- Si la carpeta no se puede usar, se apaga solo (`enabled: false`) y la app sigue; el zip sale con `fallos.json`.

## Redacción

Dos veces antes de llegar al disco y otra al descargar:

1. En el acto, el redactor de la IPTV de ese momento (usuario, contraseña, URLs guardadas): cambiar o borrar el
   proveedor no destapa lo escrito antes.
2. Al escribir, `redactReportValue` + `redactReportText` (`@ace/shared` `domain/faults.ts`, los de «Descargar
   fallos»): credenciales en URLs y en texto, Xtream con y sin esquema, forma corta, `?username=&password=`,
   `t=`, tickets del relé, `Authorization`/`Bearer`, cookies, JSON con secretos, JWT, correos, el usuario del
   sistema en las pilas e IPs públicas. Se quedan hashes AceStream, ids IPTV e IPs privadas/Tailscale.
3. Al descargar, el redactor de la IPTV de ahora sobre todo el registro (por si un secreto se supo después).

## Errores de la web

`apps/web/src/lib/web-log-upload.ts`: cada aviso o error NUEVO del anillo de la web (nunca las notas `info`) va a
`POST /api/v1/diagnostics/web-log` en tandas de 20 tras 4 s (50 como mucho esperando), con `fetch` directo (un
envío que falla no se apunta: sin bucles), reintentos de 10 s a 5 min, `keepalive` al ocultar la página y nada en
la demo. El servidor guarda 60 por minuto como mucho y no repite el fallo del reproductor que ya llegó con su
canal por el registro de fallos.

## Rutas (solo web, anti-CSRF)

- `GET /api/v1/diagnostics/log` → `DiagnosticsLogInfo`.
- `POST /api/v1/diagnostics/log/download` `{ period: "dia" | "semana" | "mes", web }` → el zip
  (`application/zip`, `attachment`, `no-store`).
- `POST /api/v1/diagnostics/web-log` `{ client, entries }` → `{ accepted, dropped }`.

## Vuelta atrás

No cambia ningún fichero de `data/` que ya existiera: solo añade `v2/registro/`. Volver a la 0.8.4 es seguro (la
carpeta se queda sin usar; se puede borrar a mano).
