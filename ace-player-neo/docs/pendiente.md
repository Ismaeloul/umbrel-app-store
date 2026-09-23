# Pendiente

Lo que no se pudo hacer esta noche, con el detalle para retomarlo.

(vacío por ahora)

## Resuelto

- **Claude in Chrome bloqueado por AdGuard** (22-sep, 23:50): cada
  `navigate` fallaba con "Could not verify this site's safety category".
  Isma desactivó AdGuard a las ~02:35 y la extensión ya navega (probado
  contra la 0.6.59 local en `127.0.0.1:17792`). Mientras tanto las capturas
  se hacían con Playwright sobre el Chrome instalado.

## Tests intermitentes en ESTE PC por la red de Windows

- **Qué pasa**: 1 de cada 4 ejecuciones completas del servidor, un worker de
  Vitest muere con el código `3221226505` (`0xC0000409`) en un fichero que
  abre muchas conexiones al motor falso (`engine/service.test.ts`). El
  agente del motor falso lo reprodujo con un servidor HTTP de Node vacío,
  sin nada de nuestro código, y vio además que `127.0.0.1` corta ~1 de cada
  6 conexiones con `ECONNRESET`.
- **Causa probable**: un filtro de red de Windows (NordVPN o AdGuard) que se
  mete en las conexiones locales. No es del código.
- **Qué hice**: los tests escuchan en `::1` y reutilizan conexiones; la
  batería completa pasa 1143/1143 en las ejecuciones sin ese cierre. La
  referencia es CI (Linux), que no tiene esos filtros.
- **Qué puedes hacer tú**: probar `pnpm test` con NordVPN desconectado; si
  deja de pasar, es eso.
