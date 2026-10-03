# Pendiente

Lo que no se pudo hacer esta noche, con el detalle para retomarlo.

(vacío por ahora)

## Pedido por Isma (2-oct, tras probar la 0.8.3) — para cuando se reinicie la cuota

1. **Los controles del reproductor tardan mucho en esconderse** al quitar el ratón de encima, y también en
   pantalla completa. Tienen que irse antes.
2. **«Vas en directo» y a la vez «8 s de retraso»** (7, 8 s… todo el rato) en los controles del reproductor: si
   dice que vas en directo no puede decir que vas con retraso. Corregir el texto o el criterio.
3. **Agenda (0.8.4):** ya hecha y revisada en la rama `fix/agenda-filtrado`; falta cortar la release.
4. **Pelis y series (0.9.0):** plan en `docs/vod-estado.md` (rama `vod/1-contrato`). Pendiente de Isma: el
   Paso 0 en su Umbrel y si los títulos para adultos salen en la portada.
5. **Agenda en PC: el partido destacado en grande (hero) ya no le gusta.** En el móvil se queda como está (queda
   bien); en la versión de escritorio hay que darle una vuelta (menos protagonismo / otro diseño). Ejemplo visto:
   Elche Academy–Getafe Academy en grande (eso además lo quita la 0.8.4).
   Captura de Isma (3-oct, Brave a ~2000 px): `capturas/pendiente/agenda-hero-escritorio-2026-10-03.webp`. El
   cartel ocupa casi toda la pantalla (~550 px de alto, a todo el ancho) con dos colores planos y las siglas en
   medio; la tira de días y la lista de partidos quedan abajo, casi fuera de la vista.
6. **Animaciones al cambiar de pestaña** (barra de navegación). Unas se ven raras y otras bien:
   - se ven raras: Agenda → Canales, Canales → Buscar, Buscar → Canales, Canales → Ajustes;
   - se ven bien: Buscar → Ajustes, Agenda → Ajustes, Buscar → Agenda.
   Revisar todas las combinaciones (también las que no ha nombrado) y que todas se vean igual de bien.
7. **Pelis y series: investigar en internet** cómo lo hacen otros (apps de IPTV con VOD Xtream, catálogos tipo
   Netflix/Plex/Jellyfin) antes de seguir con la 0.9.0. Lo que quiere Isma:
   - que se parezca a los partidos: en la lista, **la carátula grande y el título** bien visibles;
   - al entrar en una **película**: carátula, toda la información que dé la IPTV (sinopsis, año, reparto, nota…)
     y un **botón de play**;
   - al entrar en una **serie**: lo mismo con la información de la serie, y elegir temporada y capítulo para ver;
   - usar toda la información que tenga la IPTV.
8. **La URL arrastra parámetros de otra vista.** Isma buscó «clan» en Canales (pestaña Recientes) y al irse a
   Ajustes la URL seguía con `?vista=ajustes&pestana=recientes&pais=ES&idioma=es&q=clan`. Al cambiar de vista,
   quitar los parámetros que son de otra vista (cada vista solo conserva los suyos; ver `app/routes.ts` y
   `useSearchParam` en `app/router.tsx`, que hoy conserva todo «el resto de parámetros»).
9. **Ajustes es una lista interminable.** Los botones de la izquierda (Listas, IPTV, Tu fútbol, Reproducción…)
   hoy solo hacen scroll a su parte. Que cada botón enseñe **solo su sección** (una sección a la vez, como
   pestañas), y no la lista entera.
10. **Logo: el mismo en todas partes.** El bueno es el del menú de Umbrel (`ismaeloul-ace-player-neo/icon.svg`,
    captura `capturas/pendiente/logo-bueno-umbrel.png`: cuadrado oscuro con el anillo azul partido y el play
    blanco). Dentro de la web sale otro «feísimo» (`capturas/pendiente/logo-feo-dentro-app.png`: el de la cabecera,
    favicon y PWA en `apps/web/public/icon*.{svg,png}`). Cambiar todos (cabecera, favicon, iconos de la PWA,
    manifiesto) por el del menú de Umbrel.
11. **Programación (EPG), experimental.** Su IPTV sí tiene guía (Ajustes → IPTV: «93 canales con programación»,
    pero eso es solo lo que guardamos hoy: canales de España, 48 h y programas que parecen partidos, docs/iptv.md
    §3.6). Isma quiere probar un **botón nuevo «Programación»** con una parrilla como la de la tele: a la
    izquierda la lista de canales con EPG y a la derecha la línea de tiempo del día con cada programa en su hueco.
    Referencia de Isma: `capturas/pendiente/programacion-referencia-kodi.webp` (estilo Kodi «TV / Línea de
    tiempo»): pestañas de grupos arriba (Documentales, Infantiles, Liga Campeones…), fila de horas cada 30 min,
    canales con número a la izquierda, bloques por programa a lo ancho de su duración (color por género), y abajo
    la ficha del programa elegido: carátula, título, temporada/episodio, año, edad, estrellas, sinopsis,
    director, hora y género.
    Segunda referencia, la que más le gusta: `capturas/pendiente/programacion-referencia-movistar.png` y
    `programacion-referencia-movistar-2.png` (Guía TV de
    Movistar+): número y nombre del canal a la izquierda, línea de horas con una raya vertical en «ahora», «Sin
    información» donde no hay EPG, y abajo el programa elegido con logo del canal, barra de progreso con hora de
    inicio y fin, y acciones (Ver, Más info). **Sin pestañas de géneros.** Por defecto, **solo sus canales
    favoritos**; propuesta: un interruptor «Favoritos | Todos» (Todos = todos los canales con EPG), arrancando en
    Favoritos y, si no tiene favoritos con guía, en Todos.
    Isma confirma: «Todos» = **todos los canales con EPG que dé su proveedor**. Plan técnico: primero medir la
    guía entera real (canales y programas); guardarla compacta en disco (no toda en memoria; el storage tiene
    768 MB), ventana de hoy a +2 días; la web pide solo el trozo visible (canales × horas) y carga al desplazarse. Implica guardar la guía completa (todos los programas, no solo partidos;
    ojo memoria) y quizá «ahora / después» en Canales. Idea aparte, para valorar: que la guía rellene partidos
    que falten en la agenda (no sustituir a futbolenlatv: la guía cubre pocos días y su texto es libre).
12. **Agenda híbrida (idea de Isma, 3-oct).** Días 1-14: futbolenlatv como ahora. Hoy y mañana (lo que cubre la
    EPG): usar la guía de la IPTV para **confirmar** el partido y su canal exacto. Ya existe en parte
    (`modules/iptv/guide-match.ts`, docs/iptv.md §4.5: la guía encuentra el canal IPTV del partido). Falta:
    - que el canal confirmado por la guía también guíe la **búsqueda de AceStream** (buscar por ese canal
      primero), no solo la de IPTV;
    - enseñarlo en la agenda y en el partido («Confirmado en tu guía: M+ LaLiga TV 2 · 21:00»);
    - si la hora o el canal de la guía no coinciden con futbolenlatv, preferir la guía para hoy/mañana;
    - y que un partido que esté en la guía pero no en futbolenlatv se añada igualmente.
    - **Sin IPTV configurada, con la IPTV en pausa o sin EPG** (o la guía caída/sin datos para ese partido):
      todo sigue exactamente como hoy, con futbolenlatv como única fuente. La guía solo suma, nunca es
      obligatoria ni deja la agenda vacía.
13. **Ideas aceptadas por Isma (3-oct):**
    - **Arranque instantáneo:** minutos antes de un partido de sus favoritos, el Umbrel deja preparada la mejor
      fuente (IPTV primero) para que «Ver» sea inmediato.
    - **Cambiar de canal rápido** entre favoritos (flechas en PC, deslizar en el móvil), como en la tele.
    - **Copia de seguridad de los ajustes:** exportar e importar listas, favoritos, IPTV y preferencias (por si
      formatea).
    Descartadas: avisos de partido (usa SofaScore), aprender qué canales fallan (los de la IPTV no cambian: si
    uno falla, se lo dice al proveedor), retroceder más tiempo, dos partidos a la vez, página de equipo con historial de fuentes,
    marcador en el reproductor, calendario exportable, grabar, perfiles, mando remoto y modo tele.
14. **App de iPhone: al final, con el Mac de su hermano** (simulador de iPhone y cambios al momento, mucho más
    práctico que compilar en GitHub y bajar la IPA). Primero pulir al máximo la web; la app irá basada en la web.
    Idea solo para la app: **descargar películas y episodios en el iPhone** para verlos sin conexión y borrarlos
    después.

Nota: la IPTV de la 0.8.3 «parece que va bien» (Isma, 2-oct).

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
