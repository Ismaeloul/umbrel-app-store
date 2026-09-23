# Pendiente

Lo que no se pudo hacer esta noche, con el detalle para retomarlo.

## Pruebas en tu navegador con Claude in Chrome: bloqueadas por AdGuard

- **Qué pasa**: la extensión está conectada ("Browser 1", Windows), pero cada
  `navigate` falla con *"Could not verify this site's safety category.
  Blocking as a precaution"*, también con `https://www.google.com`. Es el
  mismo bloqueo de AdGuard de otras veces: filtra la comprobación de
  seguridad que hace la extensión contra `api.anthropic.com`.
- **Por qué no lo arreglé**: pausar AdGuard es tocar tu software de
  seguridad, y eso no lo hago sin ti.
- **Qué hice en su lugar**: las capturas, las pruebas visuales en todos los
  tamaños, los GIF y las pruebas contra el motor real las hago con
  **Playwright sobre tu Chrome y tu Edge instalados** (`channel: chrome` y
  `msedge`), no con un Chromium aparte. Leo igualmente la consola y la red de
  cada prueba.
- **Qué tienes que hacer**: pausar AdGuard (o añadir una excepción para
  `api.anthropic.com`) y pedirme que repita la ronda con la extensión. El
  guion de esa ronda queda en `docs/pruebas-chrome.md` cuando exista.
