# Ace Neo · rediseño de escritorio (web) — encargo para implementar

Vas a rediseñar la **web de Ace Player Neo para escritorio** (repo `umbrel-app-store/ace-player-neo`, app web en `apps/web`). Primero escritorio; el móvil (Android en Kotlin + Compose) irá después con el mismo diseño.

Las maquetas están en `mockups/`. La de referencia es **`01-escritorio.html`** (6 pantallas, tema claro y oscuro). Las demás son las versiones de móvil y sirven para el detalle de cada pantalla y el comportamiento. Ábrelas en el navegador antes de empezar. Son maquetas con datos falsos: **no copies su HTML**; reconstruye con los componentes y el código que ya existen.

## Reglas generales

- **Mantén la identidad actual.** Tokens de `base.css` (colores claro/oscuro, amarillo `--accent #ffd60a`, `--accent-ink`, `--live`, `--ok`, `--weak`, `--fail`, superficies `--bg`/`--surface`/`--surface-2`, radios `--r-*`, espaciado `--s-*`), Mona Sans + Martian Mono (números, horas, IDs) y el set de iconos propio (24 px, trazo 1.8).
- **Iconos nuevos de navegación**, con siluetas distintas entre sí: Agenda (calendario), Canales (antena emitiendo), Guía (parrilla de bloques), Pelis y series (bobina). El SVG de cada uno está en las maquetas.
- **Logo nuevo: «Pantalla-campo» (variante A de `logos-campo-para-todo.html`).** Pantalla redondeada amarilla sobre `#0b0d11`, línea de medio campo al 45 % y círculo central amarillo con play oscuro. Sustituye a `icon.svg`, a los PNG/maskable y al favicon.
- **Sin cristal ni desenfoque** en la navegación: superficies opacas con borde fino de 1 px.
- El marcador sigue **oculto por defecto** («Ver marcador»).
- Accesibilidad: foco visible (anillo `--accent-edge`), contraste AA en los dos temas y `prefers-reduced-motion`.

## Estructura de escritorio

- **Menú lateral fijo (232 px)**, que sustituye a la barra inferior y a la barra superior actuales.
  - Arriba: logo y «Ace Neo».
  - Después: Agenda (con contador rojo de partidos en directo), Canales, Guía, Pelis y series y Ver juntos.
  - Abajo del todo: Ajustes.
  - Elemento activo: fondo `--surface` y barrita amarilla de 3 px a la izquierda.
  - **Mini-reproductor** en la parte baja del menú cuando algo suena: miniatura, título, minuto, pausa y una línea de progreso fina.
- **Barra superior por sección**: título grande, los chips propios de la sección, un buscador con el atajo `Ctrl K` y una campana para los avisos.

## Pantallas (orden de prioridad)

1. **Agenda + ficha (dos paneles).**
   - **Panel izquierdo (unos 380 px):** tira de días, chips (Todo, Directo, por liga) y tarjetas **agrupadas por competición** con filas compactas: hora o minuto en mono con barra de progreso en directo, los dos equipos con su escudo y, a la derecha, señal o play. La fila abierta queda resaltada.
   - **Panel derecho:** la ficha con **el vídeo arriba**, que empieza a cargar la mejor fuente en silencio. Debajo, título, «Ver marcador» y «Ver juntos», y pestañas Fuentes / Datos / Sala. En Fuentes, la lista de conexiones (número, calidad, AceStream/IPTV, pares, señal) con la que suena resaltada.
2. **Reproductor (controles mínimos, «1B»).**
   - **Arriba:** atrás, nombre del partido, píldora de la fuente que suena (al tocarla abre un panel lateral con todas las fuentes) y PiP.
   - **Centro:** pausa.
   - **Abajo:** barra y una sola píldora **DIRECTO**. En directo es roja con punto; si te quedas atrás, pasa a gris con flecha y al tocarla vuelve al directo. Sin contador de segundos.
   - **Fuera de pantalla:** marcador, minuto, idioma y volumen. El idioma va dentro del panel de fuentes.
   - **Si la fuente se cae:** cambio automático a la siguiente buena, con un aviso «Deshacer».
3. **Guía:** **parrilla clásica** a lo ancho, con canales en filas, horas en columnas y una línea amarilla con la hora actual.
   - Los programas en directo van teñidos de rojo y los pasados, apagados.
   - Pulsar un programa abre un popover con el título completo, el horario, «Empieza en X min», **Te aviso** (notificación 5 min antes) y **Ver ficha** si el partido está en la Agenda.
   - Si la línea de «ahora» queda fuera de pantalla, aparece un botón flotante **«‹ Ahora 19:42»**.
4. **Canales:** pestañas Favoritos / Recientes / Todos y chips por categoría. **Tabla** con logo, nombre, «Ahora» (título y barra de progreso) y «Después» (hora y título), más una estrella de favorito. El canal que suena va resaltado con barritas animadas.
5. **Pelis y series (escaparate).**
   - **Arriba, «Seguir viendo»:** lo último que estabas viendo, en grande, con el episodio, lo que queda, la barra amarilla y los botones «Seguir · T3 E4», Mi lista y Ver juntos. **No** pongas «Nuevo en tu IPTV» ni estrenos.
   - **Debajo:** filas «También a medias» y «Mi lista».
   - **Películas / Series:** abren una cuadrícula con filtros y orden.
   - **Ficha de título:** el botón «Seguir» sabe dónde lo dejaste. Debajo, Mi lista / Ver juntos / Tráiler (icono de claqueta, no de descarga) / Compartir. En series: temporadas y episodios, con el **siguiente marcado**.
6. **Buscar (`Ctrl K`):** ventana rápida encima de todo que busca a la vez en Agenda, canales y catálogo, con resultados agrupados.
   - Se navega con las flechas, Intro abre y Ctrl+Intro abre «ver juntos».
   - Sin texto escrito: recientes, atajos (En directo ahora, Mis equipos, Mi lista, Mis avisos) y pegar `acestream://` o un Content ID.
7. **Ajustes:**
   - **Arriba:** a qué Umbrel estás conectado y por dónde (casa o Tailscale).
   - **Agenda:** Mis equipos, marcador oculto y avisos.
   - **Reproducción:** cambio automático de fuente, idioma preferido y descargas (solo en móvil).
   - **Apariencia:** tema Claro / Oscuro / Auto.
   - **Al final:** listas IPTV, motor AceStream, dispositivos y desemparejar.

## Ver juntos (cambios de comportamiento — afectan también al servidor)

**Roles**

- **Líder (corona):** controla el vídeo y tiene las pestañas Fuentes y Partidos.
- **Co-líder (nuevo):** el líder lo asigna con «Hacer co-líder» y lleva un escudo azul. Tiene el mismo control que el líder, pero **no** puede echar a nadie ni quitarle la corona.
- **Invitados:** solo ven, chatean y ven quién está. No pueden pausar, cambiar fuente ni canal ni añadir cosas, y su barra de tiempo no tiene tirador. En la pestaña Gente les sale una nota que lo explica.

**Sala de fútbol (en directo)**

- **Pestañas del líder y del co-líder:**
  - **Chat.**
  - **Fuentes:** todas las conexiones y canales alternativos que propone la app para el partido, agrupados por canal, con «Poner» y «En la sala». Arriba lleva el interruptor de cambio automático si se cae.
  - **Partidos:** en directo y más tarde, con «Poner», más «Poner un canal».
  - **Gente:** al mantener pulsado o con el menú ⋯ salen Hacer co-líder / Pasar el liderazgo / Echar.
- **Invitados:** solo Chat y Gente.
- Sin lista ni votaciones en directo.

**Sala de pelis y series (estilo Rave)**

- **Crear:** desde la ficha: quién entra (con enlace / amigos / pública), quién controla (solo yo / yo y co-líderes / todos), votar lo siguiente y chat de voz.
- **Antes de empezar:** pantalla «Esperando a todos» con quién está listo y quién cargando (%). Arranca sola cuando están todos, o el líder pulsa «Empezar para todos».
- **Vídeo sincronizado:** barra con tiempo, ±10 s y pausa para quien controla. Arriba, «Sincronizados».
- **Gente:** caras con su micro; el borde verde indica quién habla y el micro rojo, quién lo tiene apagado.
- **Siguiente:** los invitados proponen y votan. Arriba aparece «Cuando acabe», y la regla puede ser en orden, por votos o lo elige el líder. En series, el siguiente episodio va solo.
- **Chat de voz:** es nuevo y necesita WebRTC. Déjalo para una **fase 2** si complica mucho; hazlo por separado.

**En las dos salas**

- **Quitar** la bandeja de emojis, las reacciones que flotan sobre el vídeo y los contadores de reacciones en los mensajes. El chat es solo texto; se pueden escribir emojis desde el teclado.
- **Sin chat en pantalla completa** u horizontal: solo el vídeo.

## Cómo trabajar

1. Lee el código actual de `apps/web` (componentes, rutas, `theme.ts`, estado de la sala, API de fuentes) y las maquetas. Antes de tocar nada, escribe un plan corto que cubra:
   - qué componentes cambias o creas;
   - qué cambios necesita el servidor (roles de co-líder, permisos de invitado, quitar reacciones y la lista en directo, «esperando a todos»);
   - en qué orden lo harás.
2. Implementa por pantallas en el orden de arriba, con un commit por pantalla. No rompas el modo móvil de la web: por debajo de 768 px se queda como está hasta la fase de Android.
3. Después de cada pantalla, sácale capturas a 1280×800 en claro y oscuro y compáralas con `01-escritorio.html`.
4. Sube versión y notas en `CHANGELOG.md`, `umbrel-app.yml` y `releases/`, como siempre.
