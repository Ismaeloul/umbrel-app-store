# Inventario funcional del front 0.6.59

> FASE 0 · análisis. Solo funcionalidad: el aspecto se rehace entero.
> Fuentes leídas enteras: `ismaeloul-ace-player-neo/releases/0.6.59/index.html` (6173 líneas: HTML + CSS + JS en un solo fichero), `sw.js` (72) y `manifest.webmanifest` (24).
> **Convención de citas:** un número suelto (`4866`) o un rango (`4866-4946`) es una línea de `index.html`. Los demás ficheros se citan con su nombre (`sw.js:38`, `manifest:16`, `server.js:70`). El CSS solo se cita cuando decide un comportamiento (qué se ve, dónde y cuándo).
> **Términos:** «inicio» y «viendo» son los dos valores de `data-modo` en `<main class="console">` (1940). «Escritorio NEO» es la media query `(hover:hover) and (pointer:fine) and (min-width:901px)` (5169). «Táctil» es `(hover:none) and (pointer:coarse)` (6048). «Móvil» es la maquetación de ≤1100 px (1201-1297).

---

## 0. Mapa general de la página

- Una sola página. Cambiar de pantalla o de vista solo cambia un atributo: no se repinta nada y se conservan el scroll, los acordeones y el día elegido (1138-1143, 3042-3047).
- Bloques: cabecera (1909-1928) · barra «Sigue sonando» (1932-1938) · `<main class="console">` con `#hero` (reproductor y todo lo que cuelga de él, 1943-2055) y `#sidePanel` (conmutador, agenda y biblioteca, 2059-2118) · 8 modales (2125-2286) · contenedor de toasts (2288).
- Modales: Ajustes (`veilSettings`), Preferencias (`veilOnboarding`), Encontrar canal (`veilResolve`), Reproducir otro hash (`veilExternalHash`), Guardar favorito (`veilSave`), Renombrar canal (`veilEdit`), Salud del sistema (`veilHealth`) y Reportar fuente (`veilReport`).

### 0.1 Las dos pantallas

| Modo | Escritorio (>1100 px) | Móvil (≤1100 px) |
|---|---|---|
| `inicio` (portada) | Agenda y biblioteca en dos columnas, sin reproductor (`#hero` con `display:none`) y sin conmutador. Cada columna tiene su propio scroll (1146-1164, 1494-1520). | Agenda arriba y biblioteca debajo en una sola página. Cada lista mide como máximo 70dvh y tiene scroll propio (1255-1267). |
| `viendo` | Reproductor a la izquierda y panel a la derecha con el conmutador Agenda/Biblioteca (171-217). | Vídeo fijo arriba, pegado bajo la cabecera (`--header-h` medido por JS), y el panel debajo con alto `calc(100dvh - 380px)` y mínimo de 320 px (1219-1229, 3050-3055). |

Transiciones:
- `playChannel` pasa a `viendo` (4876). `esperarFuenteVerificada` también (3608).
- `‹ INICIO` pasa a `inicio` sin detener el canal (3087). `Volver al vídeo` vuelve a `viendo` (3088).
- `setModo` (3067-3082) oculta la línea de estado al salir de `viendo` (3071), actualiza la barra «Sigue sonando», vuelve a medir la cabecera y recalcula las flechas de la tira de días (3080-3081).
- Se arranca siempre en `inicio` (1940, 3086).

---

## 1. Cabecera (estado del motor y accesos)

| Elemento | Qué hace | Cuándo aparece | Microcopy | Líneas |
|---|---|---|---|---|
| Marca | Solo decorativa. | Siempre. El lema se oculta en móvil. | `ACE PLAYER NEO` · `ACESTREAM EN TU UMBREL` | 1910-1916, 1236 |
| Bandera demo | Avisa del modo demo y parpadea. | Solo en demo. | `MODO DEMO` | 1917, 135-141, 6129 |
| `‹ INICIO` (`btnHome`) | Vuelve a la portada sin detener el canal. | Solo en `viendo` (lleva `hidden` en `inicio`; `[hidden]` manda sobre `display:grid`: 1184-1186). | title `Volver a la portada (sigue sonando)`; aria `Volver a la portada sin detener la reproducción` | 1919, 3076-3077, 3083-3090 |
| Píldora del motor | Punto de color y texto. Verde con pulso = en línea; amarillo parpadeante = arrancando; rojo = apagado. | Siempre. En móvil solo se ve el punto. | Arranque: `Motor: comprobando…`. Después: `Motor: en línea` / `Motor: arrancando…` / `Motor: apagado`. title `Estado del motor AceStream` | 1920-1923, 148-154, 933, 1237, 4232-4237 |
| Pegar hash (`btnPaste`) | Abre el modal «Reproducir otro hash» (§7.5). | Siempre. | title `Reproducir un Content ID o enlace acestream://` | 1924, 5964 |
| Salud (`btnHealth`) | Abre el panel de salud (§12). | Siempre. | title `Salud del sistema` | 1925, 5900 |
| Ajustes (`btnSettings`) | Abre Ajustes y refresca el estado del directorio (`GET /api/state`). | Siempre. | title `Ajustes` | 1926, 5899 |

Lógica del estado del motor:
- `checkEngine` hace `GET /api/engine/status` al arrancar y luego cada 20 s (6160-6162). No se ejecuta en demo, donde el motor siempre está «en línea» (4247).
- Si el motor no responde mientras se ve algo, hacen falta **dos fallos seguidos** para pintarlo como apagado. Sin reproducción basta uno (4238-4245).
- Reanudación automática: si un stream muere con el motor caído, se guarda `pendingResume` (4671). Cuando el motor vuelve y no hay nada sonando, se reconecta solo con el toast `Motor de vuelta: reconectando «{título}»…` (4252-4256). Detener borra `pendingResume` (4982-4987).
- Al arrancar un canal con éxito se fuerza `setEngine('online')` (4681, 4704, 4761, 4795).

---

## 2. Barra «Sigue sonando» (el «mini-reproductor»)

- **Qué es:** una barra, no un reproductor con imagen. El vídeo sigue en el DOM, pero `#hero` queda con `display:none` en la portada (1149), así que solo se oye.
- **Cuándo aparece:** en `inicio`, si hay `currentId` y se está reproduciendo o conectando (3060-3066).
- **Textos:** `Sigue sonando` + título del canal + `Volver al vídeo` + `Detener` (aria `Detener la reproducción`) (1932-1938).
- **Acciones:** `Volver al vídeo` llama a `setModo('viendo')` y `Detener` llama a `stopPlayback()` (3088-3089).
- **Móvil:** se parte en dos líneas y el título ocupa todo el ancho (1409-1412).

---

## 3. Agenda de fútbol

### 3.1 Cabecera de la agenda

- Rótulos: `AGENDA EN ESPAÑA` · `El fútbol que viene` · `Partidos, horarios y el canal donde puedes verlos.` (2068-2070). La descripción se oculta en la portada (1528-1529).
- **Conmutador `Para ti` / `Todos`** (2073-2076, 2972-2981, 5910-5913):
  - `Para ti` está deshabilitado si no hay gustos guardados; en ese caso se fuerza `Todos` (2975, 2979).
  - Por defecto se usa `Para ti` si hay gustos, salvo que el usuario ya haya tocado el conmutador (`footballModeTouched`) (2611).
  - Al guardar las preferencias se reevalúa el modo (2895-2896).
- **Botón `Actualizar`** (2077-2079, 5909): vuelve a cargar la agenda. Mientras carga, el icono gira y el botón queda deshabilitado (3315). En estrecho se queda solo el icono (601-602, 948-949). aria `Actualizar agenda de fútbol`.
- **No hay refresco periódico de la agenda.** Solo se carga al arrancar (6135), con `Actualizar` y con `Reintentar` (3323).

### 3.2 Tarjeta de primer uso («personaliza tu agenda»)

- Sustituye al antiguo modal bloqueante (6136-6138). Se ve mientras `preferences.onboardingComplete !== true` (2861-2864).
- Texto: `Dinos tus ligas y equipos y la agenda pondrá primero lo tuyo. Mientras tanto ves todos los partidos.` (2084).
- Botones:
  - `Ahora no` oculta la tarjeta y guarda `onboardingComplete:true` con `POST /api/preferences` (5916). Muestra el toast `Puedes personalizar tu agenda cuando quieras`, o `Tu agenda ya está personalizada` si ya había gustos.
  - `Personalizar` abre las preferencias (5915).

### 3.3 Tira de días

- Un botón por día que llega de `/api/football`. Primera línea: `Hoy`, `Mañana` o el día de la semana abreviado con mayúscula. Segunda línea: `{d} {mes corto} · {n}`, donde `n` cuenta los partidos **visibles con el filtro actual** (3009-3022).
- Pulsar un día fija `footballDate` y repinta la agenda (3032).
- Solo se reconstruye si cambia el contenido (firma en `data-firma`) y conserva el scroll horizontal (3023-3033).
- Solo se centra sola al cambiar de día o la primera vez, nunca en cada repintado (3034-3039).
- Flechas `‹` `›` (aria `Días anteriores` / `Días siguientes`) (2090-2092, 3127-3143):
  - desplazan un 80 % del ancho visible, con un mínimo de 120 px;
  - se deshabilitan en los extremos;
  - se ocultan si no hay desbordamiento.
- La rueda vertical del ratón desplaza la tira en horizontal (3145-3150). Tocar la tira cancela el auto-centrado en curso (3151-3152). Las flechas se recalculan con `resize` (3153).
- Si no hay días, la tira queda vacía (3018).

### 3.4 Fila de partido

Se genera en `renderFootball` (3313-3363). Contenido:

- **Hora.** `match.time`, o `Por confirmar` con estilo reducido (3347).
- **Liga.** `match.competition`, o `Fútbol` si falta.
- **Insignia de estado.** Se calcula con la hora de Madrid, no la del dispositivo (2982-3008):
  - `EN DIRECTO` desde la hora de inicio hasta 120 min después;
  - `TERMINADO` pasados 120 min (la fila baja al 42 % de opacidad: 1329);
  - `EN {n} MIN` si faltan 60 min o menos;
  - `EN {h} H {m} MIN` si faltan 6 h o menos;
  - nada en los demás casos.
  - Un partido en directo lleva fondo propio y la insignia late (1325-1327).
- **Hueco del marcador** (`data-score-for`). Se explica en §3.6.
- **Equipos.** `{local} vs {visitante}`, o `match.title` si no hay visitante.
- **Resaltado «mine».** Si juega uno de tus equipos, la fila se marca **sin cambiar de sitio**: el orden sigue siendo cronológico (541-547, 2963-2968).
- **Rótulos de canal.** Uno por nombre de canal:
  - Si el canal se encuentra en la biblioteca local (puntuación ≥70, ver `findFootballChannel` 2920-2932), el rótulo se destaca con el title `Disponible en tu biblioteca`. Si no, lleva el title `Se buscará al reproducir` (3336-3339).
  - Sin canales se muestra `Canal por confirmar` (3339).
  - El front pinta **todos** los rótulos que recibe. El tope de 8 por partido lo pone el backend (`server.js:64`, `server.js:4181`).
- **Botón de acción** (3341-3344):
  - `Ver canal` (icono play) si hay coincidencia local, `Buscar canal` (icono lupa) si no;
  - aria `{etiqueta} para {partido}`;
  - sin canales, en su lugar aparece `Canal por confirmar`;
  - mientras se resuelve, solo **ese** botón cambia a `Buscando` con icono girando y queda deshabilitado (3297-3311);
  - en estrecho se oculta el texto del botón (591).
- La lista entera solo se reescribe si cambia la firma del HTML; así no se relanza la animación de entrada (3349-3352).
- La agenda se vuelve a pintar cuando cambia el **contenido** de la biblioteca (firma con hash de id, título y alias), no cuando cambias de pestaña o escribes en el buscador (5515-5537).

### 3.5 Estados de la lista y pie

| Estado | Lista | Pie | Líneas |
|---|---|---|---|
| Cargando | Esqueleto de 3 barras (aria `Cargando partidos`). | `Consultando horarios y canales…` | 3317-3320 |
| Error | `No pudimos cargar la agenda` · `La fuente de partidos no respondió. Puedes volver a intentarlo.` + botón `Reintentar` | `La biblioteca y el reproductor siguen disponibles.` | 3321-3324 |
| Vacío con «Para ti» | `Nada de los tuyos este día` · `No hay partidos de tus ligas, equipos o selecciones favoritas. Puedes cambiar tus gustos o ver todos.` + botón `Editar mis gustos` | normal | 3328-3330 |
| Vacío con «Todos» | `Sin partidos anunciados` · `No hay emisiones de fútbol registradas para este día. Prueba otra fecha.` | normal | 3331 |
| Normal | Filas | `Datos: {attribution}` (o `Datos de muestra` en demo; `agenda externa` si falta) · `horario peninsular`. A la derecha: `Última copia disponible` (stale), `Cobertura parcial` (partial), `Cobertura gratuita limitada` (limited) o `Actualizado`. | 3360-3362 |

Carga: `GET /api/football` con un límite de 14 s (3364-3377). Si el día elegido ya no existe, se elige el primero (3373).

### 3.6 Marcadores en vivo

- Datos: `GET /api/scores` (3197-3206). El servidor los saca de ESPN (3166-3167).
- Solo se consulta si el **día que estás mirando** tiene algún partido entre 15 min antes de su inicio (`match.start`) y 3,5 h después (3190-3195).
- Cadencia: cada 8 s si hay algo en juego (`state==='in'`) y cada 45 s si no; la reprogramación es automática (3181-3182, 3208-3215).
- `arrancarMarcadores` se llama en cada `renderFootball`, así que cada repintado lanza una consulta inmediata (3358).
- Se rellenan solo los huecos, sin repintar la agenda (3171-3174, 3229-3249).
- Estado `pre`: no se pinta, porque siempre llega 0-0 (3232-3233).
- Estados `in` y `post`: `{local}-{visitante}` y a continuación el reloj (`clock` o `detail`) o `FINAL` (3223-3246).
- **El partido que estás viendo sale tapado.** En su lugar hay un botón `Ver marcador` con el title `Tu emisión va por detrás del directo`. Se destapa con un toque y sigue destapado hasta cambiar de canal o detener (3176-3179, 3235-3239, 3287-3295, 4891-4894, 4993-4999).

### 3.7 Reglas de «Para ti» (hay que llevarlas tal cual)

- «Para ti» es la **unión** de ligas, equipos y nacionalidades (2933-2936, 2942-2962).
- **Ligas.** Se comparan por igualdad de clave, sin espacios ni signos, usando alias (`LEAGUE_ALIASES`, 2683-2708). Hay una guarda para que Hypermotion o Segunda no cuenten como LaLiga; se detecta mirando también el título y los canales (2709-2728).
- **Equipos.** Se comparan por clave exacta con alias (Barça/FC Barcelona, Atlético, Inter), ignorando FC y CF. Nunca por «incluye»: Barcelona no debe traer a Barcelona SC (2745-2763).
- **Nacionalidades.** Cuentan la selección por nombre o alias en local, visitante o título, y las competiciones domésticas del país (`NATIONALITY_RULES`, 2729-2744). Hypermotion no entra nunca por nacionalidad (2952-2959).
- Límites al limpiar: 12 ligas, 24 equipos y 24 nacionalidades; se deduplica por clave normalizada y cada texto se corta a 80 caracteres (2588-2607).

### 3.8 Agenda en modo demo

Hay 11 partidos repartidos en 5 días (2442-2464), con atribución `Datos de muestra`.

---

## 4. Preferencias («Tu agenda»)

Modal `veilOnboarding` (2167-2204). Se abre con `openPreferences(false)` desde Ajustes (`Editar mis gustos`, 5914), desde la tarjeta (`Personalizar`, 5915) y desde la agenda vacía (3330).

- **Cabecera:** `TU AGENDA` · `¿Qué fútbol te mueve?` · `Elige tus competiciones, equipos y nacionalidades. Los usaremos para ordenar la agenda; siempre podrás ver todos los partidos.`
- **01 Tus ligas** (`Selecciona todas las que sigues.`). Chips fijos: LaLiga, LaLiga Hypermotion, Champions League, Premier League, Europa League, Copa del Rey, Serie A, Bundesliga y Ligue 1 (2675).
- **02 Tus equipos** (`Marca los tuyos o añade otro.`):
  - 12 fijos (2676) más los personalizados, que se añaden como chips;
  - campo `Añadir otro equipo…` (máximo 80) con botón `Añadir`; Enter también añade;
  - se ignoran textos de menos de 2 caracteres (2877-2881, 5917-5918).
- **03 Nacionalidades** (`Selecciones y fútbol de los países que sigues.`):
  - 14 países fijos, cada uno con su bandera en emoji (2677-2682); los personalizados llevan el globo terráqueo (2848);
  - campo `Añadir otro país…` (máximo 60) con botón `Añadir` (2882-2886, 5919-5920).
- Cada chip conmuta su selección sobre un borrador (`preferenceDraft`) con `aria-pressed` (2841-2860).
- **Nota:** `Tus gustos se guardan en Ace Player Neo y se comparten entre tus dispositivos.` En demo: `En la demo se guardan únicamente en este navegador.` (2868-2869).
- **Botones:** `Cancelar` (`Ahora no` en el primer uso) y `Guardar y ver mi agenda` (2198-2201, 2873).
- **Guardar:** `POST /api/preferences` con `{onboardingComplete:true, country, leagues, teams, nationalities}` (5921-5925, 2887-2911).
  - Mientras guarda, los dos botones quedan deshabilitados.
  - Si sale bien: se cierra el modal, se repinta la agenda y aparece el toast `Tu agenda ya está personalizada` (o `Puedes personalizar tu agenda cuando quieras` si se guardó sin nada).
  - Si falla: `No pudimos guardar tus gustos. Puedes cerrar y reintentarlo luego.`, y el modal se desbloquea (2899-2907).
- **Resumen en Ajustes:** `Tu agenda prioriza {n} ligas, {n} equipos y {n} nacionalidades.` o `Personaliza la agenda con tus ligas, equipos y nacionalidades.` (2832-2840).
- El bloqueo de primer uso (X oculta, Escape y clic en el velo sin efecto) está programado (2872, 5845, 6086), pero **nunca se activa**: nadie llama a `openPreferences(true)`. Ver §29.

---

## 5. Resolución de canal desde la agenda

### 5.1 Flujo al pulsar `Ver canal` / `Buscar canal`

Funciones `resolveFootballMatch` (4136-4157) y `requestFootballResolution` (4066-4084).

1. Sin canales anunciados se muestra el toast `El canal todavía no está anunciado` (4138).
2. `GET /api/football/resolve?channel=…&channel=…&match={id}&client={DEV_ID}` con un límite de 20 s.
3. Si `status==='found'` y hay candidato:
   - se guarda el partido (`partidoActual`, `partidoViendo`) y el precalentado (`preheat`);
   - `setFuentes(todas las candidatas, mismoPartido=true, scan)`;
   - con comprobador se llama a `esperarFuenteVerificada` (§7.3); sin comprobador se reproduce directamente la mejor colocada.
4. Con cualquier otro estado se abre el modal «Encontrar canal».
5. Si hay error de red se abre el mismo modal como `not_found` y `engineAvailable:false` (4154-4155).

### 5.2 Modal «Encontrar canal»

Modal `veilResolve` (2206-2211). Lo pinta `renderResolver` (3412-3427).

- **Título:** `Encontrar canal`.
- **Titular y texto:**
  - Sin resultados: `No hemos encontrado el canal`. Si el buscador no estaba disponible: `Revisamos tus listas, pero el buscador AceStream no estaba disponible. Puedes introducirlo manualmente.` Si sí lo estaba: `No aparece en tus listas ni en el buscador AceStream. Puedes buscarlo fuera y pegarlo aquí.`
  - Con candidatos: `Elige la señal que quieres usar` · `Hay varias coincidencias posibles. No reproduciremos ninguna sin que la confirmes.`
- **Lo que se ha revisado:** chips `{fuente} ✓` con las etiquetas `Vínculos`, `Favoritos`, `M3U`, `Biblioteca`, `AceStream` e `IA` (3408).
- **Candidatos:** un botón por señal con título, origen y `· {availability} fuentes`. Orígenes: `Asociación guardada`, `Directorio M3U`, `Favoritos`, `Recientes`, `Buscador AceStream`, o `Fuente disponible` si no se reconoce (3407, 3420).
- **Casilla `Recordar mi elección para {canal}`**, marcada por defecto (3420). Si está marcada, al elegir se hace `POST /api/football/bind` (3428-3434). Si ese guardado falla, se reproduce igualmente con el toast `El canal se reproduce, pero no pudimos recordar la asociación` (4047-4060).
- **Vincular a mano** (siempre visible en este modal) (3409-3411, 4061-4065):
  - `¿Lo has encontrado por tu cuenta?` · `Pega el Content ID o enlace AceStream. Lo vincularemos a este canal para la próxima vez.`;
  - el nombre del canal con un botón para copiarlo (aria `Copiar nombre del canal`), que da el toast `Nombre del canal copiado` o `No se pudo copiar el nombre` (3424);
  - campo `acestream://…` (Enter lo envía) y botón `Vincular y reproducir`;
  - error: `Introduce un Content ID o enlace AceStream válido de 40 caracteres.`;
  - siempre recuerda la asociación, con `ih:false` y `source:'saved'`.
- Al elegir un candidato se fija el partido y se reproduce la señal elegida **directamente**, sin esperar al comprobador (4054-4058).
- La señal elegida se guarda en `searchResults` para que quede localizable (`rememberPlayable`, 4043-4046).

---

## 6. Centro de partido

Sección `#matchCenter` (2014-2018). La pinta `renderMatchCenter` (3251-3285).

- **Cuándo se ve:** solo mientras hay `partidoActual`, es decir, al entrar desde la agenda (3254). Se quita al reproducir un canal que no está en la lista del partido (4887-4896) y al detener (4995-5000).
- **Antetítulo:** `CENTRO DE PARTIDO`, o `EN DIRECTO · CENTRO DE PARTIDO` si el partido está en directo.
- **Equipos:** `{local} VS {visitante}`.
- **Meta:** `competición · hora · canales` separados por ` · `.
- **Caja del marcador:**
  - Al cargar: `Marcador oculto` (2016).
  - Con marcador `in` o `post` sin destapar: botón `Ver marcador`, que lo destapa.
  - Destapado: `{L}-{V} · {reloj|LIVE}`, o `{L}-{V} · FINAL`.
  - Sin marcador: el texto de la insignia de estado, la hora o `Programado`.
- **Progreso del comprobador.** La barra va de `checked` a `total`, con un mínimo visible del 4 %. El texto cambia según el estado:
  - terminado: `{n} verificadas · {total} comprobadas`;
  - en espera: `{n} verificadas · fallidas en reposo`;
  - comprobando: `{checked}/{total} · buscando señales vivas`;
  - precalentado: `{n} fuentes precalentadas`;
  - en otro caso: `{n} fuentes disponibles`.
  - Texto inicial: `Preparando fuentes` (2017).
- Accesibilidad: `aria-live="polite"`.
- En escritorio NEO dentro de `viendo`, la caja se compacta (1685).

---

## 7. Selector de fuentes

### 7.1 Barra «Emitiendo» y chips

- La barra `#nowBar` (2021-2025) muestra `Emitiendo` + el título del canal (con el nombre completo en el title) + el selector. Aparece en cuanto hay `currentId` y título, **también mientras conecta** (4413-4424).
- El selector `#sourcesBar`, pintado por `renderFuentes` (3740-3846):
  - lleva el rótulo `Fuentes` y un carril con scroll horizontal;
  - se oculta si no hay fuentes (3746).
- **Cada chip muestra** (3749-3777, 1805-1824):
  - el número (1…N);
  - un nombre corto: el proveedor que va tras la flecha `→`, `-->` o `=>`; si no hay, el nombre de la lista sin «Directorio (de)»; si tampoco, el tipo (`Guardada`, `M3U`, `Favorito`, `Reciente`, `AceStream`, `Externa` o `Fuente`) (3501-3516);
  - el estado en una palabra.
- **Title y aria** del chip (`Fuente {n}: …`), con estos datos unidos por ` · `: título · tipo y detalle · `Lista {x}` · `Hash {id}` · detalle de la prueba · `{n} pares en la prueba` · `{x} Mbit/s del enjambre para un canal de {y}` · `{n}% disponible` o `Disponibilidad sin medir`, estos dos últimos solo sin comprobador (3769-3772).
- **Pulsar un chip** (3821-3833):
  - apaga todo el automatismo (`sourceAutoSwitchArmed/Done` y `autoPlayVerified`);
  - reproduce esa fuente conservando la lista;
  - muestra el toast `{tipo · detalle} · {primeros 10 del hash}`;
  - pulsar la fuente activa no hace nada.
- **Qué fuentes forman la lista:**
  - Desde la agenda, **todas** las candidatas del partido (3468-3473).
  - Desde la biblioteca, solo las «hermanas» del **mismo canal** (puntuación ≥92 por nombre normalizado) (3474-3481, 3494-3500). Si no hay hermanas, la lista queda vacía y el selector oculto (4898-4900).
  - Las fuentes reportadas y aún en cuarentena salen ya marcadas como reportadas. Una fuente reportada como `wrong_channel` solo cuenta como reportada para el canal del reporte (3446-3448).

### 7.2 Estados y colores

| Estado interno | Palabra en el chip | Color del punto | Líneas |
|---|---|---|---|
| `working` (clase `probada`) | `verificada` | verde `--ok` #4AF626 | 1822, 1830, 3753, 3766 |
| `weak` (clase `floja`) | `floja` | amarillo-ámbar `--warn` #E8C33A | 1823, 1831 |
| `checking` (clase `comprobando`) | `comprobando` | verde latiendo (la regla 1829 pisa a la 1626, que era «ámbar») | 1626, 1829 |
| `queued` / vacío | `pendiente` | gris (`--muted`) | 1825-1828 |
| `failed` (clase `fallida`) | `sin señal` | rojo `--live` #E61919 | 1824, 1832 |
| reportada | `reportada` | rojo | 1824, 1832 |
| sin comprobador, con disponibilidad | `{n}% disponible`; clase `viva` si ≥60 % y `floja` si >0 | verde o amarillo | 3767, 3775 |
| activa (clase `on`) | la suya | borde y fondo rojos | 1833-1836 |

Detalles de la prueba que se leen en el title (3754-3764): `reproduciendo ahora`, `comprobando en pantalla`, `vídeo no compatible`, `sin pista de vídeo`, `señal detectada · vídeo sin confirmar`, `no arrancó en el reproductor`, `se cortó en el reproductor`, `funcionó en el reproductor`, `intermitente: falló la última prueba`, `llega menos señal de la que el canal necesita` y `reintentando`. En otro caso, la palabra del estado largo: `verificada`, `señal sin confirmar`, `comprobando`, `pendiente` o `sin señal`.

### 7.3 Comprobador («segundo motor») y arranque automático

- **Arranque** (`configureSourceScan`, 3548-3568). Si la resolución trae `scan.id`:
  - se consulta `statusUrl`, o por defecto `/api/football/scan?id=…`, cada 1,5 s con un límite de 5 s;
  - todas las fuentes arrancan como `queued`;
  - las primeras `initialCount` (3 por defecto) quedan marcadas como «iniciales».
- **Consulta** (`pollSourceScan`, 3660-3725):
  - copia a cada fuente estado, motivo, pares, velocidad, bytes, duración, códec, entrada, bitrate, intentos y `retryAt`;
  - lee `total`, `checked`, `playable`, `status` (`complete`, `waiting` o `cancelled`) y `retryAt`;
  - solo deja de consultar con `complete`; en `waiting` sigue cada 1,5 s;
  - tras 3 fallos seguidos abandona con el toast `El comprobador no responde; se muestran todas las fuentes` (3713-3720).
- **Prioridades del reproductor:**
  - Si la fuente activa está reproduciéndose, cuenta como verificada aunque el comprobador diga otra cosa (3674-3676).
  - Si está conectando, cuenta como `comprobando` (3681-3688).
  - Durante 3 min, el veredicto del propio reproductor manda sobre el del comprobador (`PLAYER_VERDICT_MS`, 4473-4481).
- **Qué fuentes se ven durante el escaneo:** la activa, las verificadas o flojas, y las iniciales que aún no se han probado. Las caídas desaparecen (3727-3738).
- **Esperar a la primera verificada** (`esperarFuenteVerificada`, 3603-3613, y `arrancarPrimeraVerificada`, 3614-3644):
  - El reproductor pasa a `viendo` con el mensaje `Comprobando {n} fuentes: arranca la primera que funcione…`.
  - Arranca la primera `working` con el toast `Fuente {n} verificada: arrancando`. Si el escaneo ya terminó y no hay ninguna, prueba la primera `weak` con el toast `Ninguna verificada del todo; probamos la fuente {n}, que da señal floja`.
  - En `waiting` sin ninguna viva: `Ninguna de las {n} fuentes da señal todavía. Las vuelvo a probar a las {HH:MM} y arranco la primera que responda.` (o `…Las vuelvo a probar en unos minutos…`).
  - Al terminar sin ninguna: `Ninguna de las {n} fuentes da señal ahora mismo. Prueba "Rebuscar" o pega un Content ID.`, o `Este partido no tiene fuentes ahora mismo.` (error).
  - Mientras tanto: `Comprobando fuentes… {checked}/{total}`.
  - Si la fuente arrancada se cae, pasa a la siguiente verificada, porque `failCurrentSourcePlayback` vuelve a llamar a `arrancarPrimeraVerificada` (4971).
- **Salto automático de entrada** (`maybeAutoPlayFirstVerifiedSource`, 3645-3658). Solo en la primera entrada a un partido: si la fuente inicial resulta `failed`, se salta a la primera viva con el toast `La señal inicial no responde; probamos automáticamente la fuente {n}`. En cuanto algo se reproduce o el usuario elige, se apaga (3484-3488, 4490-4493).
- **Demo:** simula el escaneo con un paso cada 1,35 s (3570-3597).

### 7.4 Inspector de la fuente activa

Lo pinta `renderSourceInspector` (3872-3914), bajo la barra «Emitiendo».

- **Sin fuente activa:**
  - dentro de un partido solo se ve `Pegar hash`, justo para el caso en que no aparece ninguna señal (3875-3886);
  - fuera de un partido, el inspector se oculta. Esto incluye un canal de biblioteca sin hermanas.
- **Con fuente activa, estas acciones:**
  - `Favorito` / `En favoritos` (conmuta el favorito, §13.4);
  - `Rebuscar` / `Rebuscando…`, solo dentro de un partido (§7.6);
  - `Pegar hash` (§7.5);
  - `Copiar hash` (§13.5);
  - `Es el canal correcto` / `✓ Canal aprendido`, solo dentro de un partido (§7.8);
  - `Reportar` (§7.7).
- Solo se repinta si cambian la fuente o las acciones. Así no vuelve al principio el scroll horizontal en móvil (3897-3903).
- En ≤720 px, las acciones se deslizan en horizontal empezando por la izquierda (1894-1901).

### 7.5 Pegar Content ID o hash externo

Modal `veilExternalHash` (2213-2230), con la lógica en 3919-3964. Se abre desde el botón de la cabecera (5964) y desde el `Pegar hash` del inspector.

- **Textos:** `Reproducir otro hash` · `Fuente externa` · `Añádela solo a esta sesión` · etiqueta `Content ID o enlace AceStream` · placeholder `acestream://…` · ayuda `Acepta un hash de 40 caracteres, un enlace acestream:// o una URL con el ID. No se vinculará automáticamente al canal ni se guardará en favoritos.` · botón `Reproducir hash`.
- El botón está deshabilitado mientras el valor no es válido; se valida a cada tecla (5905). Error: `Introduce un Content ID o enlace AceStream válido de 40 caracteres.` Enter reproduce (5906-5908).
- Formatos aceptados (`normalizeAceId`, 2469-2474): `acestream://{40hex}`, una URL con `?id=` o `?content_id=`, o cualquier grupo de 40 hexadecimales dentro del texto.
- **Al reproducir:**
  - si el hash ya estaba en la lista, solo cambia a él;
  - si no, se añade como fuente `manual` con `ih:null` («no se sabe si es Content ID o infohash»);
  - no se guarda en el historial (`recordHistory=false`);
  - toast `Reproduciendo el hash seleccionado` o `Hash externo añadido y reproduciendo` (3947-3964).
- Título que se le da: el primer canal del partido, si no el título que sonaba, si no `Stream {8}` (3949).
- **Reintento como infohash** (`reintentarComoInfohash`, 4854-4864): para `ih:null` se prueba primero como `?id=` y, si falla, una vez como `?infohash=`, con el toast `La señal no arranca de la forma habitual: probando de otra manera…`. Ver la duda en §29.

### 7.6 Rebuscar

Función `researchFootballSources` (4085-4135).

1. Sin partido o sin canales: toast `Este partido todavía no tiene canales anunciados`.
2. `GET /api/football/resolve?…&research=1&current={id}&current_ih=0|1` con un límite de 30 s. Mientras tanto el botón muestra `Rebuscando…` y queda deshabilitado.
3. Sin candidatos nuevos: `No han aparecido fuentes nuevas para este partido`.
4. Con candidatos:
   - se combinan con la activa y se reinicia el comprobador;
   - la activa sigue marcada como verificada si está sonando;
   - toast `Rebúsqueda: {n} señales reunidas, {m} sin probar antes · comprobándolas…` (con ` · revisadas por la IA` si el servidor usó la IA).
5. Veredicto cuando termina el comprobador (`anunciarRebusqueda`, 3525-3532): `Rebúsqueda terminada · {n} fuente(s) nueva(s) que funciona(n)` o `Rebúsqueda terminada · ninguna fuente nueva funciona` (más el sufijo de la IA si aplica).
6. Errores: `La rebúsqueda está tardando demasiado; vuelve a intentarlo` (si se agota el tiempo) o `No se pudo completar la rebúsqueda ahora mismo`.

### 7.7 Reportar con motivos

Modal `veilReport` (2270-2286), con la lógica en 3978-4042.

- **Textos:** `Reportar fuente` · `¿Qué ocurre con esta señal?` · `Fuente {n} · {título} · {12 del hash}`.
- **Motivos** (radios): `No arranca` (`not_starting`, marcado por defecto) · `Se corta` (`stuttering`) · `Canal incorrecto` (`wrong_channel`) · `Mala calidad` (`bad_quality`) · `Problema de audio` (`audio`).
- Nota: `La fuente se apartará temporalmente y el segundo motor la comprobará en segundo plano.` Botón: `Reportar y comprobar`.
- **Envío:** `POST /api/sources/report` con `{id, title, ih, source, channel, matchId, reason, client}`.
  - La fuente se marca como reportada y fallida. Si el servidor no devuelve el reporte, se usa una cuarentena local de 30 min (4035).
  - Toast `Fuente apartada; el segundo motor ya la está comprobando`. Si falla: `No se pudo enviar el reporte`.
  - Reportar **no cambia de fuente sola**.
- **Seguimiento** (`pollReportedSource`, 3987-4022):
  - consulta el escaneo cada 1,5 s hasta 32 veces; si llega `waiting` con `retryAt`, espera hasta esa hora (máximo 31 min);
  - si la señal está viva y el motivo era `not_starting`, la fuente vuelve con el toast `El segundo motor confirma que la fuente vuelve a funcionar`;
  - con `wrong_channel`, `stuttering`, `bad_quality` o `audio` queda apartada aunque esté viva: `La señal está viva, pero queda apartada por tu reporte`;
  - si está muerta: `El segundo motor confirma que esta fuente no entrega señal`.

### 7.8 «Es el canal correcto» (aprendizaje)

- `POST /api/sources/feedback` con `{id, title, channel, verdict:'correct', reason:'not_starting'}` (3965-3976).
- La fuente queda marcada con `learned` y el botón pasa a `✓ Canal aprendido`. Toast: `La asociación queda aprendida en el NAS`. Si falla: `No se pudo guardar esta corrección`.
- La rama `incorrect` (`La asociación se descartará la próxima vez`) existe, pero ningún botón la usa (§29).

### 7.9 Recordar la fuente resuelta y aprendizaje automático

- **Vínculos canal → hash.** `POST /api/football/bind` desde «Recordar mi elección» o «Vincular y reproducir» (3428-3434). Se guardan en `channelBindings` (el cliente limita a 120, 2608). En demo se sustituye el vínculo con la misma clave normalizada (3431).
- **Telemetría de resultado** (4426-4472): un solo veredicto por intento con `POST /api/sources/outcome`.
  - `arranco` cuando empieza a reproducir (4455-4461).
  - `fallo` si nunca arrancó; `cayo` con los segundos vistos si arrancó y se cortó (4947-4951).
  - `sigue` cada 2 min mientras avanza (4462-4472, llamado desde el vigilante en 5252).
- Una fuente que se ha visto 60 s o más y luego se corta queda **floja y visible**, no «sin señal» (4956-4963).

---

## 8. Reproductor

### 8.1 Zona de vídeo, reposo y errores

- `<video playsinline controlslist="nodownload noplaybackrate">` (1945).
- **Panel de reposo** (1956-1961; `showIdle` en 4318-4328):
  - titular `Sin señal` (reposo), `Conectando` (girando) o `No se pudo abrir` (error), con icono según el modo;
  - bajo el mensaje, tres datos: `Motor listo|apagado`, `Canales {web+favoritos}` y `Hoy {n} partidos` (4329-4341).
- Mensajes del panel:

| Situación | Texto | Modo | Línea |
|---|---|---|---|
| Arranque | `Elige un partido en la agenda o un canal de la biblioteca. Con un Content ID, usa el botón de la cabecera.` | reposo | 6126 (el HTML trae una versión corta: 1959) |
| Conectando | `Conectando con AceStream…` | girando | 4925 |
| Buffer inicial | `Señal encontrada: cargando los primeros segundos…` | girando | 4368 |
| Esperando al comprobador | ver §7.3 | girando o error | 3610, 3635, 3639, 3642 |
| Fallo de mpegts | `No se pudo cargar el stream. Comprueba el ID o espera a que AceStream encuentre pares.` | error | 4672 |
| Fallo del adaptador en iOS | `No se pudo preparar el canal para este dispositivo. Prueba de nuevo o mira si emite (a veces tarda en encontrar pares).` | error | 4727 |
| Códec no soportado en HLS nativo | `Este canal usa códecs que este dispositivo no puede reproducir, y la adaptación tampoco pudo con él.` | error | 4820 |
| Sin HLS | `Este navegador no soporta HLS.` | error | 4830 |
| La fuente no arranca | `El reproductor no pudo iniciar esta fuente. Prueba la siguiente.` | error | 4861, 4943 |
| Reintentos agotados | `Esta señal no responde. Tienes {n} fuentes para este canal: prueba otra en el selector.` / `Este canal no tiene pares ahora mismo. Puede que no esté emitiendo todavía.` | error | 5221-5223 |
| Demo con fuente caída | `La señal de muestra no responde; buscando una alternativa.` | error | 4837 |
| Detenido | `Reproducción detenida. Elige otro partido o canal.` | reposo | 5004 |

- **Capa demo** (1947-1954): `SEÑAL DEMO` sustituido por el título en mayúsculas · `reproducción simulada — en el Umbrel verías el stream real`.
- **Capa `Toca para reproducir`** (2008-2011): aparece solo si el navegador bloquea el autoplay (`NotAllowedError` o `onAutoplayBlocked`). Desaparece con el evento `playing` (4512-4520, 6001, 5268). Pulsarla pide play (6003).

### 8.2 Controles propios NEO (solo escritorio)

Bloque `#neoControls` (1982-1997), activo con `configureNeoPlayer` (5168-5175). En móvil y táctil se usan los **controles nativos** (`video.controls=true`), porque integran mejor el volumen, AirPlay y la pantalla completa del sistema (5087-5088, 5137-5143).

| Control | Qué hace | Estados y textos | Líneas |
|---|---|---|---|
| Barra de directo | No es una línea de tiempo: no se navega ni se rellena. Se atenúa si vas por detrás del directo. | clase `behind` | 1709-1719, 5110 |
| Play/Pausa (`neoPlay`) | `toggle` del controlador. | aria `Reproducir`/`Pausar` y `aria-pressed` | 1985, 5096-5098, 5163-5167, 6004 |
| Detener (`neoStop`) | `stopPlayback()` | deshabilitado sin canal; title `Detener` | 1986, 5124, 6010 |
| `−30` (`neoBack`) | Retrocede 30 s dentro de la ventana guardada. | deshabilitado sin canal, en demo o sin reproducir; title `Retroceder 30 s (J)` | 1987, 5061-5074, 5123, 6011 |
| Silencio (`neoMute`) | Conmuta `muted`. | aria `Silenciar`/`Activar sonido` | 1988, 5099-5101, 6005 |
| Volumen | Rango 0-1 en pasos de 0,05. A 0 queda silenciado. | aria `Volumen` | 1989, 5102, 6006 |
| Tiempo | Sin canal `—`; en demo `DEMO`; en directo vacío; por detrás `−{n} s`. | | 1990, 5111 |
| Estado | `PREPARANDO`, `SIN SEÑAL`, `PAUSADO`, `REPRODUCIENDO`, `INICIANDO`, `CARGANDO`, `SALTANDO` o `PULSA PLAY`. | `aria-live` | 1991, 5075-5081 |
| Botón de directo (`neoLive`) | `goLive()` salta al borde reproducible, dejando un colchón de seguridad. | `DIRECTO` / `REANUDAR` (en pausa o bloqueado) / `IR AL DIRECTO` (por detrás). aria `Ya en directo` / `Reanudar en directo` / `Ir al directo` | 1993, 5009-5056, 5113-5119 |
| PiP / Pantalla completa | Delegan en `btnPip` y `btnFull`. | | 1994-1995, 6008-6009 |

- «En directo» significa `followingLiveEdge` o ir menos de 1,25 s por detrás (5109, 5999).
- Colchón del borde: `min(PB.rebuild, max(1,2 s, 25 % de la ventana))` (5030).
- **Toasts de `goLive`** (5038-5056): `Ya estás en el directo (en demo no hay retardo)`, `Ya estabas en el directo`, `Directo reanudado`, `De vuelta al directo`, `La señal no deja saltar más adelante`.
- **Toasts de retroceder** (5061-5074): `En la demo no hay imagen guardada que repetir`, `Todavía no hay imagen guardada para retroceder`, `No hay más imagen guardada hacia atrás`, `Retrocedido {n} s · pulsa DIRECTO para volver`.
- **Ocultación automática:** los controles se esconden a los 3,2 s sin mover el ratón, **solo si se está reproduciendo de verdad**, y el cursor se oculta con ellos (5129-5136, 1680, 1687-1689). Se despiertan con `pointermove` y `pointerdown` (6014-6015).
- **Clic y doble clic:** un clic en el vídeo pausa o reanuda con 190 ms de espera, para distinguirlo del doble clic, que pone pantalla completa (6016-6024).
- **Bloqueo de los controles nativos en escritorio:** se ocultan por CSS y un `MutationObserver` quita el atributo `controls` si alguien lo vuelve a poner (1670-1679, 6039-6041).
- Los controles se repintan en cada evento del vídeo y además cada 500 ms (6042-6044).

### 8.3 Menú contextual propio

Menú `#neoPlayerMenu` (1999-2006), con la lógica en 5144-5162 y 6025-6038.

- Se abre con clic derecho sobre el reproductor, solo en escritorio NEO. Se coloca junto al puntero sin salirse del reproductor y enfoca el primer botón.
- **Cabecera:** `ACE PLAYER NEO` · `PROPIO`.
- **Opciones:**
  - `Reproducir`/`Pausar` (K);
  - `Retroceder 30 s` (J);
  - `Detener`;
  - `Copiar hash` (deshabilitada sin un hash válido: 5125-5126);
  - `Pantalla completa` (F).
- **Se cierra** con un clic fuera, con cualquier scroll, al cambiar de pantalla completa y con Escape (que devuelve el foco al reproductor) (6034-6038, 6085).

### 8.4 Fila superior del vídeo (título y botones)

- `#phTop` (1963-1971) lleva el título del canal y cuatro botones:
  - `btnFav`: estrella (title `Favorito (G)`; aria `Añadir a favoritos`/`Quitar de favoritos`) (4521-4528, 5970);
  - `btnNerd`: estadísticas (title `Estadísticas (S)`), abre o cierra el panel nerd (5969);
  - `btnPip`: title `Picture-in-Picture (P)`;
  - `btnFull`: title `Pantalla completa (F)`.
- Solo se ve **mientras se reproduce**; conectando no aparece (4502).
- En escritorio va sobre el vídeo y aparece al pasar el ratón (307-313). En escritorio NEO se ocultan su PiP y su pantalla completa, porque ya están en los controles (1669).
- En táctil, el JS la **saca debajo del vídeo**, porque los controles nativos de iOS ocupan las esquinas (915-922, 6046-6055).

### 8.5 Pantalla completa y PiP

- **Pantalla completa** (5971-5986):
  - si ya está en pantalla completa, sale;
  - si puede, pone a pantalla completa el contenedor del reproductor (escritorio y Android);
  - en iPhone usa `video.webkitEnterFullscreen()`, y si aún no hay imagen avisa con `La pantalla completa estará disponible cuando arranque la imagen`;
  - sin ninguna de las dos API: `Este navegador no permite la pantalla completa aquí`, y además se ocultan los dos botones.
- **PiP** (5987-5994): entra o sale. Mensajes: `PiP necesita un vídeo real (en demo no hay señal)`, `PiP no disponible` y `PiP no disponible en este navegador`.

### 8.6 Barra de estadísticas y zapping

- `.statsbar` (2028-2037) tiene cuatro datos:
  - `Pares {n}`, `Bajada {x KB/s|MB/s}`, `Subida {…}`;
  - estado: `rellenando · {s} s`, `reproduciendo · {s} s`, `preparando señal` o `inactivo` (4567-4576).
- **Botones de zapping:** `Anterior` (title `Canal anterior (←)`) y `Siguiente` (title `Canal siguiente (→)`) (2034-2035, 5872-5873, 5967-5968).
- **Visibilidad real:** la barra se oculta en ≤860 px (938) y en `viendo` con escritorio NEO (1682). En `inicio` todo `#hero` está oculto. En la práctica solo se ve entre 861 y 1100 px, o en tabletas anchas.
- **Lista de zapping** (5323-5339): favoritos seguidos del directorio activo, agrupado por categoría en el orden en que llegan las categorías, sin repetidos. Los recientes no entran. Si el canal actual no está en la lista, empieza por el primero. Toast `Zapping: {título}`.

### 8.7 Barra de comando (Content ID)

- Campo `#aceInput` (2039-2045): placeholder `Content ID · acestream://… · URL con ?id=…`; aria `Content ID o enlace AceStream`; icono delante y botón para borrar (aria `Borrar Content ID`).
- Botón `Reproducir` (deshabilitado con el campo vacío) que cambia a `Detener` mientras se reproduce (4505-4507, 6061-6068). Enter reproduce.
- Al reproducir cualquier canal, el campo se rellena con su hash (4923).
- **Visibilidad:** oculta en `inicio` (junto con todo `#hero`) y en `viendo` con escritorio NEO (1682-1684). Solo se ve en móvil o táctil dentro de `viendo`. Por eso el mensaje de arranque manda al botón de la cabecera (6126).
- Un hash no válido da el toast `Pega un ID AceStream válido de 40 caracteres o un enlace acestream://` (4869).

### 8.8 Pistas de teclado

`.kbd-hints` (2047-2054): `Espacio pausa` · `F pantalla completa` · `P PiP` · `← → zapping` · `G favorito` · `/ buscar`.

Visibilidad: se ocultan en ≤1100 px (1231) y en `viendo` con escritorio NEO (1684), y en `inicio` no hay `#hero`. En la práctica **no se ven nunca**.

### 8.9 Modos de reproducción (en Ajustes)

- Botones `Estable`, `Equilibrado` y `Baja latencia` con `role="radio"` (2149-2155, 5930-5953). Por defecto, `balanced`.
- Se guarda en `localStorage['aceneo-pb']` (2360, 5941).
- Explicación: `«Equilibrado» mantiene un colchón moderado y es el modo recomendado. «Estable» prioriza la continuidad en canales con pocos pares. «Baja latencia» se acerca más al directo y asume mayor riesgo de cortes. El botón LIVE siempre permite volver al borde manualmente.`
- Al cambiar: toast `Modo «{nombre}» activado`. Si se está viendo algo, se reengancha el canal con el perfil nuevo (5943-5948).
- Perfiles (`PB`, 2387-2402):

| Modo | stash mpegts | buffer inicial | buffer tras un corte | mpegts liveSync | hls.js |
|---|---|---|---|---|---|
| Estable | 2 MB | 10 s | 12 s | desactivado | syncCount 7 · maxLatency 14 · maxBuffer 90 s · rate 1 |
| Equilibrado | 1 MB | 6 s | 8 s | sí, objetivo 6 s, máximo 14 s, velocidad 1,03 | 5 · 10 · 60 s · 1,03 |
| Baja latencia | 512 KB | 3 s | 4 s | sí, objetivo 3 s, máximo 7 s, velocidad 1,05 | 3 · 7 · 30 s · 1,05 |

`liveBufferLatencyChasing` va siempre desactivado, porque salta `currentTime` y vacía el colchón (2384-2386).

### 8.10 Motores de reproducción

- **Escritorio y Android con MSE:** mpegts.js en un Worker. Primero se piden los metadatos de la sesión con `GET /ace/getstream?id|infohash={h}&format=json` y luego se reproduce `playback_url`. A mpegts siempre se le pasa una URL absoluta, porque desde el Worker las relativas fallan (4641-4691, 4590-4595).
- **Sin mpegts:** hls.js con los metadatos de `/ace/manifest.m3u8?…&format=json` (4733-4790).
  - Error de red: hasta 3 reintentos con espera de 750 ms × 2ⁿ y el toast `HLS perdió la señal: reintentando sin reiniciar el canal`.
  - Error de medios: 2 recuperaciones, cambiando el códec de audio en la segunda.
  - Si nada funciona: reintento completo con `HLS no pudo recuperarse ({detalle})`.
- **HLS nativo** (navegadores que no son iOS y no tienen hls.js): si da error o a los 15 s no arranca, se pide `/api/remux`, con el toast `Adaptando el canal para este dispositivo…` (4792-4828).
- **iOS:** siempre `GET /api/remux?…&dev=` (fMP4 hecho con ffmpeg `-c copy`), con un límite de 55 s (4697-4731).
- Tras 20 s basta con 1,5 s de buffer inicial (2 s en rebuffer) para arrancar (4379-4380).

### 8.11 Recuperación, reintentos y vigilante

Los tiempos concretos están en §24.

- Rebuffer sin saltar nunca al directo solo (`startRebuffer`, 5177-5206):
  - espera hasta tener `PB.rebuild` segundos de buffer, como máximo 45 s;
  - el toast `Señal irregular: recuperando la imagen…` sale como mucho una vez por canal cada 60 s;
  - no se aplica en iOS.
- **Reintentos** (5208-5230): el toast es `{motivo} ({n}/{máx})…`.
  - Máximo 3, o 1 si estamos en automático y la fuente aún no había arrancado.
  - Al agotarlos, `failCurrentSourcePlayback`.
  - Motivos posibles: `La señal se ha cortado: reconectando`, `La señal no termina de arrancar: reconectando`, `La señal no llega con fluidez: reconectando`, `La señal no se recupera: reconectando`, `Sin señal suficiente: reintentando`, `La imagen se ha quedado parada: reconectando` y `Reconectando al volver a la app`.
- **Vigilante** (se ejecuta cada 1,5 s: 5231-5266):
  - Conectando: reintenta a los 30 s; a los 60 s si ya descarga a más de 50 KB/s; a los 54 s en iOS.
  - Imagen parada 4,5 s: rebuffer (no en iOS).
  - iOS parado 6 s y 6 s o más por detrás del directo: empuja al directo (5283-5292).
  - Parado 30 s (24 s en iOS): reintento.
- Una recuperación no renueva la reclamación de la reproducción, para no robársela a otro dispositivo (4927-4929).

### 8.12 Traspaso entre dispositivos (tipo Spotify Connect)

Lógica en 4159-4229.

- Al reproducir: `POST /api/playback/claim` con `{id, title, dev, token}`. Las reclamaciones van en cola, así que un zapping rápido no deja peticiones desordenadas. Si falla: toast `No se pudo sincronizar el mando con otros dispositivos`.
- Cada 5 s, mientras se reproduce o conecta: `GET /api/playback`. Si otro `dev` tiene un `at` posterior, este dispositivo se detiene con el toast `La reproducción ha pasado a otro dispositivo`. Si es el mismo canal, no se manda el stop al motor.
- Al detener y al cerrar la página: `POST /api/playback/release` (con `keepalive` al cerrar) (4195-4205, 4638).
- El identificador de dispositivo sale de `sessionStorage['aceneo-dev']` (2345-2347), así que **cada pestaña cuenta como un dispositivo distinto**.

### 8.13 Detener y cerrar la página

- **`stopPlayback`** (4975-5006) suelta todo:
  - la reclamación y la sesión del motor (`command_url&method=stop`) y la del remux;
  - `pendingResume`, el comprobador, las fuentes, el partido y los marcadores destapados;
  - la capa de toque.
- **`pagehide`** (4636-4639): para la sesión del motor, suelta el remux con `keepAlive`, libera la reclamación con `keepalive` y corta el comprobador.

### 8.14 Reproductor externo y copiar canal

- **Reproductor externo:** no existe en 0.6.59. No hay VLC, `intent:` ni «abrir con…». La clase `.si-btn.external` es el botón «Pegar hash» (1858, 3893). Ver §27.
- **Copias disponibles:**
  - `Copiar hash` en el menú (2004) y en el inspector (3894). Toasts: `Hash copiado`, `No se pudo copiar el hash` y `No hay un hash válido para copiar` (5452-5460).
  - `Copiar enlace` (`acestream://{hash}`) en las tarjetas de la biblioteca. Toasts: `Enlace acestream:// copiado` y `No se pudo copiar` (5461-5470).
  - `Copiar nombre del canal` en el modal «Encontrar canal» (3424).

---

## 9. Línea de estado bajo el vídeo

- Elemento `#playerNotice` (2020) con `role="status"` y `aria-live="polite"`. Lógica en 2493-2525.
- **Qué recibe:** todo lo que la app pasaría a `toast()` con tipo `info`, o con icono `radio`, `refresh`, `tv` o `search`, **siempre que se esté en `viendo`** y el aviso no lleve acción (2497-2502, 2530). En la portada, esos mismos avisos salen como toast normal.
- Una sola línea con icono y texto recortado. El borde izquierdo lleva color según el tipo: ok, warn, err o info.
- Un mensaje repetido no se duplica: se le añade `×{n}` y se renueva el tiempo.
- Dura 4,5 s y luego se desvanece en 320 ms.
- Se oculta al salir de `viendo` (3071).

---

## 10. Toasts

### 10.1 Reglas

- **Para qué:** solo acciones tuyas (favorito, copiar, guardar…) y errores que piden atención. Pequeños y en una esquina: **nunca encima del vídeo** (876-880).
- Duración 2,8 s, o la que se pase en `ms` (2490, 2533).
- **Nunca más de 2 a la vez:** el más viejo cede su sitio (2491, 2569-2570).
- Un mensaje repetido no se apila: renueva su tiempo y muestra `×{n}` (2485-2489, 2543-2552).
- Pueden llevar un botón de acción (`Deshacer`), que cierra el toast al pulsarlo (2527-2528, 2562-2567, 1442-1448).
- **Posición:** abajo a la derecha en escritorio; abajo y centrado en móvil, respetando la zona segura (880, 1269).
- Accesibilidad: el contenedor tiene `aria-live="polite"` (2288).

### 10.2 Catálogo del resto de toasts

Los de fuentes, directo, retroceso, iOS y reintentos ya están en §7 y §8.

| Texto | Tipo | Línea |
|---|---|---|
| `No se pudo cargar la biblioteca del backend; se reintentará` | err | 2638 |
| `Modo demo: sin backend, canales de muestra cargados` | info | 6168 |
| `Backend no disponible; la app seguirá reintentando` | warn | 6169 |
| `Tu agenda ya está personalizada` / `Puedes personalizar tu agenda cuando quieras` | ok | 2898 |
| `Reiniciando el motor AceStream…` / `Motor en línea (demo)` / `No se pudo reiniciar el motor` | info/ok/err | 4262-4268 |
| `No se pudo guardar el historial` | warn | 4936 |
| `«{t}» quitado de favoritos` / `No se pudo quitar el favorito` | warn/err | 5351, 5354 |
| `«{t}» guardado en favoritos` / `No se pudo guardar el favorito` | ok/err | 5375, 5378 |
| `Canal renombrado` / `No se pudo renombrar el canal` | ok/err | 5403, 5406 |
| `«{t}» eliminado` + botón `Deshacer` (6 s) / `No se pudo eliminar el canal` | warn/err | 5430, 5437 |
| `La búsqueda falló. ¿Está el motor AceStream en línea?` | err | 5688 |
| `Escribe la URL del directorio` | warn | 5760 |
| `Directorio guardado: {n} canales` | ok | 5776 |
| `Directorio activo: {nombre}` / `No se pudo cambiar de directorio` | ok/err | 5789-5790 |
| `Directorio eliminado` / texto de `directoryError` | ok/err | 5812-5813 |
| `Modo «{x}» activado` | ok | 5943 |

---

## 11. Panel nerd

- Recuadro `#nerdPanel` (1973-1980) sobre el vídeo, titulado `Motor AceStream`. Muestra:
  - `Estado`, que es el estado del **motor** (`online`/`offline`), no el `status` de las estadísticas;
  - `Pares`, `Bajada` y `Subida`;
  - el hash completo (4577-4581).
- Se abre y se cierra con `btnNerd` o con la tecla S (esta solo si se está reproduciendo) (5969, 6096). Se cierra solo cada vez que cambia el estado de reproducción (4508).
- **Datos:** `GET {stat_url}` cada 2 s con un límite de 4,5 s y sin solapar peticiones (4529-4557). `stat_url` sale de los metadatos de la sesión (4612-4618). En demo son números aleatorios cada 1,5 s (4558-4566).

---

## 12. Panel de salud y reinicio del motor

### 12.1 Panel «Salud del sistema»

Modal `veilHealth` (2259-2268), con la lógica en 4271-4315. Se abre desde la cabecera y desde Ajustes (`Ver salud de todos los servicios`).

- **Resumen:** mientras carga, `Comprobando el NAS y los servicios…`. Después: `{n} fuentes en cuarentena · {n} correcciones aprendidas · comprobado {HH:MM}`.
- **Cuadrícula por servicio** (no por fuente). Cada fila lleva un punto de estado, el nombre, la etiqueta del estado y un detalle:

| Servicio | Detalle |
|---|---|
| `Backend` | `v{versión} · {min} min activo` |
| `Motor principal` | `Aceptando reproducción` / `No responde` |
| `Segundo motor` | `{n} trabajos · {n} en cola` |
| `IA local` | modelo, `Sin configurar` o `Modelo no disponible` |
| `Agenda` | `{n} partidos · {n} preparados` |
| `Directorios M3U` | `{n} canales · {n} listas` |

- **Etiquetas de estado:** `Listo`, `Preparando`, `Preparado`, `Comprobando`, `Con avisos`, `Copia anterior`, `Falta el modelo`, `Sin conexión`, `Desactivado` y `Vacío`.
- **Color del punto:** verde para `ready`; amarillo para `degraded`, `warming` y `model_missing`; rojo para `offline`, `failed` y `empty`; gris para el resto (1880-1883).
- **Estados de la cuadrícula:** esqueleto mientras carga. Si falla: `No se pudo leer la salud` · `Vuelve a comprobar cuando el NAS esté accesible.`
- Botón `Volver a comprobar`.
- **Datos:** `GET /api/health`. No hay sondeo: solo se consulta al abrir el panel o al pulsar el botón.

### 12.2 Reinicio del motor (en Ajustes, no en Salud)

- Sección `Motor AceStream` de Ajustes (2157-2162) con el aviso `Reiniciarlo corta la reproducción en todos los dispositivos. Úsalo solo si el motor no responde.`
- **Doble toque:** el primero cambia el botón a `¿Seguro? Pulsa otra vez para reiniciar` durante 6 s; el segundo cierra el modal y reinicia (5954-5963).
- `restartEngine` (4259-4269): detiene la reproducción, pone el motor en «arrancando», hace `POST /api/restart-engine` y vuelve a comprobar el motor a los 2,5 s.

---

## 13. Biblioteca

### 13.1 Cabecera, pestañas y buscador

- Rótulos: `Biblioteca` · `favoritos, recientes, directorio y búsqueda en el motor` (2102-2103). La descripción se oculta en la portada (1528-1529).
- **Pestañas** (5473-5486), cada una con su contador:
  - `Favs` (estrella);
  - `Recientes` (reloj);
  - `Directorio` (globo), que muestra solo la lista **activa**;
  - `Buscar` (lupa), que cuenta los resultados del motor.
- **Pestaña inicial:** Favs si hay favoritos; si no, Recientes si hay historial; si no, Directorio (6131-6132).
- Al pasar a `Buscar` con 2 o más letras escritas se lanza la búsqueda en el motor y se enfoca el campo (5479-5485).
- **Buscador** (2107-2110): placeholder `Buscar canal…`, o `Buscar en el motor AceStream…` en la pestaña Buscar (5644-5646).
  - Filtra en local por título o categoría (5549-5550), con 140 ms de espera tras cada tecla (6069-6076).
  - En la pestaña Buscar también consulta el motor (§15).
- **Botón `Buscar «{q}» en el motor AceStream`:** aparece al final de cualquier pestaña cuando hay 2 o más letras y algún resultado local (5578-5582).
- **Pie:** `{n} canales en biblioteca · directorio sincronizado {d mes}`, más `· demo` en demo (5617-5622).

### 13.2 Tarjetas de canal

Plantilla `chRow` (5487-5513).

- **Contenido:**
  - inicial del título sobre un tono derivado del hash;
  - nombre;
  - subtítulo: la categoría en el directorio, `{categoría} · disp. {n}%` en búsqueda, o `{14 del hash}…` en el resto.
- **Canal caído:** un favorito que venía de la sincronización y ya no aparece en el directorio lleva un punto con el title `Este canal ya no aparece en la última sincronización` (5489, 5509).
- **En pantalla:** el canal que suena lleva la marca `EN PANTALLA` y un icono de ondas. Solo se cambia una clase, sin repintar (5497-5500, 5538-5546, 1598-1609).
- **Clic en la tarjeta:** reproduce el canal (5613).
- **Acciones** (5501-5506, 5604-5616):
  - `Favorito` (conmuta);
  - `Copiar enlace`;
  - `Renombrar` y `Eliminar`, que no aparecen en los resultados de búsqueda.
- En escritorio las acciones aparecen al pasar el ratón; en táctil están siempre visibles y con más área de toque (681-685, 907-914).
- **Directorio:** agrupado por categorías ordenadas alfabéticamente, como acordeones.
  - Abrir o cerrar solo cambia una clase y `aria-expanded`; el estado vive en `openCats`.
  - Con texto en el buscador, todas las categorías salen abiertas (5562-5573, 5586-5598).
- Solo se reescribe el cuerpo si cambia la firma del HTML (5583).

### 13.3 Estados vacíos (cada uno con su salida)

Función `emptyLib` (5623-5640).

| Caso | Texto | Botón |
|---|---|---|
| Búsqueda local sin resultados (2 letras o más) | `Nada en esta pestaña con «{q}».` | `Buscar «{q}» en el motor` (pasa a Buscar y lanza la búsqueda) |
| Directorio vacío | `Aún no hay ningún directorio cargado.` | `Añadir una lista` (abre Ajustes, refresca y enfoca la URL) |
| Favs vacío | `Guarda un canal con la estrella y aparecerá aquí.` | `Ver el directorio` (si hay directorio) |
| Recientes vacío | `Lo que reproduzcas irá quedando aquí.` | `Ver el directorio` (si hay directorio) |

### 13.4 Favoritos

Lógica en 5342-5380.

- **Quitar** (estrella en un favorito, o `btnFav`, o la tecla G):
  - es inmediato y **no se puede deshacer**;
  - se quita primero en pantalla y luego se hace `POST /api/library` con `delete` y `favorites`;
  - si falla, se restaura.
- **Añadir** abre el modal `Guardar favorito` (2232-2244):
  - campo `Nombre del canal` (placeholder `Ej: DAZN LaLiga`) y el hash en una caja;
  - botón `Guardar en favoritos`;
  - sin nombre se usa `Canal {6 del hash}`;
  - `POST /api/library` con `favorite-upsert`, conservando `ih` y `fromWebSync`;
  - al terminar se pasa a la pestaña Favs.

### 13.5 Editar título y borrar con deshacer

- **Renombrar** (5383-5408): modal `Renombrar canal` con el campo `Nuevo nombre` y el botón `Guardar cambios`. Un nombre vacío se ignora. `POST /api/library` con `rename`, la colección, el id, el título y el `sourceId` del directorio activo. Si falla, se deshace.
- **Borrar** (5409-5439):
  - la tarjeta desaparece al momento;
  - el toast ofrece `Deshacer` durante **6 s** (`DESHACER_MS`);
  - pasado ese tiempo, `POST /api/library` con `delete`;
  - si falla, se restaura en su posición original con `No se pudo eliminar el canal`.
- **Copiar:** usa `navigator.clipboard` solo en contexto seguro. En HTTP recurre a `execCommand('copy')` con un textarea oculto (5440-5470).

### 13.6 Historial

- Cada reproducción que no es una recuperación añade el canal a `Recientes`: queda el primero, sin duplicados y hasta 60 en local.
- Se guarda con `POST /api/library` y `history-upsert` (4931-4937).
- El hash pegado a mano no entra (3962).

---

## 14. Ajustes: directorios y listas

Modal `veilSettings` (2125-2165). Al abrirlo se refresca `GET /api/state` (5899).

### 14.1 Añadir una lista

- Campos: `Guardar un directorio remoto` con el nombre (placeholder `Nombre, por ejemplo: Principal`) y la URL (placeholder `https://…/lista.m3u`). La URL llega **rellena con `DEFAULT_SYNC`**, una ruta IPNS en ipfs.io (2348, 5897).
- Botones: `Guardar M3U` y `Guardar HTML` (2134-2135, 5965-5966).
- Nota fija: `Hasta 8 listas públicas; cada una conserva sus canales y se actualiza sola cada 3 h. Las direcciones de tu red local están bloqueadas por seguridad.` (2137).
- **Envío** (`syncDirectory`, 5756-5780): `POST /api/streams/sync` con `{sourceId?, name, url, type}`.
  - Mientras tanto: `Guardando y sincronizando el directorio…`, o `Actualizando «{nombre}»…`.
  - Si sale bien: `«{activo}»: {n} canales. Actualización automática cada 3 h.`, el toast y el paso a la pestaña Directorio.
  - En demo: `En modo demo no hay backend: esta acción funcionará en el Umbrel.`
  - Los botones no se deshabilitan mientras sincroniza.

Mensajes de error al importar (`directoryError`, 5738-5751):

| Código | Texto |
|---|---|
| `source_limit` | `Ya tienes 8 directorios. Elimina uno antes de añadir otro.` |
| `empty_directory` | `La fuente respondió, pero no contenía enlaces AceStream válidos.` |
| `last_source` | `Debe quedar al menos un directorio guardado.` |
| `private_url` | `Por seguridad, las direcciones de tu red local están bloqueadas. Usa una lista publicada en internet.` |
| `redirect_limit` / `redirect_loop` | `La fuente entra en un bucle o encadena demasiadas redirecciones.` |
| `dns_failed` | `No se pudo resolver el dominio de esa fuente.` |
| `http_429` | `Ese servidor limita las descargas (429). Vuelve a intentarlo en unos minutos.` |
| `http_{n}` | `El servidor respondió con un error {n}.` |
| `fetch_timeout` | `La fuente no respondió a tiempo.` |
| `ipfs_not_found` | `Esa ruta ya no existe en IPFS.` |
| `ipfs_*` | `La red IPFS no entregó la lista. Vuelve a intentarlo en un rato.` |
| otro | `No se pudo importar esa URL. La lista anterior no se ha modificado.` |

### 14.2 Directorios guardados

- Tarjetas pintadas por `renderDirectorySources` (5707-5737). Sin ninguna: `Todavía no hay directorios guardados.`
- Cada tarjeta muestra el nombre, la insignia `EN USO` si es el activo y la URL (entera en el title).
- **Meta:**
  - normal: `{TIPO} · {n} canales · {fecha}`, o `sin sincronizar`;
  - si falló la última actualización: `{TIPO} · {n} canales · {motivo} · se conserva la copia de {fecha}`.
- Motivos del fallo (`motivoSync`, 5697-5706): `el servidor limita las descargas (429)`, `el servidor respondió {n}`, `el servidor no respondió a tiempo`, `la lista llegó vacía`, `no se resolvió el dominio`, `la lista ya no está en esa dirección de IPFS`, `la red IPFS no entregó la lista` y `no se pudo descargar la lista`.
- **Acciones:**
  - `Usar`: `POST /api/streams/activate`. En el activo el botón pone `Activo` y está deshabilitado.
  - `Actualizar`: vuelve a sincronizar esa lista.
  - Papelera: el primer toque la arma como `¿Borrar?` durante 5 s (aria `Confirmar: eliminar {nombre} y su lista`) y el segundo borra con `POST /api/streams/delete`. No usa `confirm()` nativo; es el mismo patrón que el resto de la app (5792-5814).
- Si el backend no devuelve fuentes, se da por hecha una llamada `Directorio principal` con `DEFAULT_SYNC` (2578-2581).

### 14.3 Otras secciones de Ajustes

- `Tu fútbol`: el resumen y el botón `Editar mis gustos` (2143-2147).
- `Modo de reproducción` (§8.9) y `Motor AceStream` (§12.2).

### 14.4 Direcciones privadas e IPFS

- El front no sabe nada de `ALLOW_PRIVATE_SYNC_URLS`. Solo muestra el error `private_url` y la nota fija. La excepción vive en el backend (`server.js:70`, `server.js:1312`).
- IPFS: el front solo traduce los errores `ipfs_*`. La resolución sin pasarela también es del backend (`server.js:1441-1450`).

---

## 15. Búsqueda en el motor

Lógica en 5642-5690.

- Solo en la pestaña `Buscar`. Hacen falta 2 letras como mínimo.
- Espera 450 ms tras la última tecla; Enter lanza la búsqueda al momento (6077-6079).
- Un número de secuencia descarta las respuestas atrasadas.
- `GET /api/search?q=` devuelve `results[]` (`id`, `title`, `category`, `availability` entre 0 y 1, `ih`).
- **Estados:**
  - `Busca canales publicados en el motor AceStream.` · `Escribe al menos 2 letras.`;
  - `Buscando «{q}» en el motor…`;
  - `Sin resultados para «{q}».` · `Prueba con otro nombre o menos palabras.`;
  - error en toast: `La búsqueda falló. ¿Está el motor AceStream en línea?`.
- Los resultados son infohashes y viajan con su marca `ih`, así que se reproducen con `?infohash=` (2475-2480, 4906-4907).

---

## 16. PWA y service worker

- **Manifest** (`manifest:1-24`):
  - nombre `Ace Player Neo`, nombre corto `Ace Neo`, descripción `Agenda de fútbol con el canal de cada partido y reproducción AceStream desde el navegador.`;
  - `display: standalone`, orientación libre, fondo y tema `#0A0A0A`, categorías `entertainment` y `sports`;
  - iconos: 192, 512 y 512 *maskable*.
- **Accesos directos del icono:**
  - `Agenda de fútbol` apunta a `/?vista=agenda` (`manifest:16`). El JS no lo trata aparte: funciona porque la agenda es la vista por defecto (2059).
  - `Biblioteca` apunta a `/?vista=biblioteca` (`manifest:17`). Selecciona la biblioteca y, a los 200 ms, la trae a la vista (6155-6159).
- **Parámetros de URL:** `?demo=1` fuerza la demo (6112).
- **Etiquetas en el HTML:**
  - `manifest`, `theme-color` y `color-scheme: dark`;
  - para iOS: `apple-mobile-web-app-capable`, `status-bar-style black-translucent`, título `Ace Player` y `apple-touch-icon` de 180 px (10-18);
  - `viewport-fit=cover` (5).
- **Registro del service worker:**
  - solo si existe `serviceWorker` **y el contexto es seguro** (HTTPS o localhost);
  - se registra al momento si el documento ya cargó (6141-6151);
  - si falla no pasa nada.
- **`sw.js`:**
  - Caché `aceneo-0.6.59` con el armazón: `/`, hls, mpegts, player-controller, las 3 fuentes, los iconos 192 y 512 y el manifest. Cada recurso se añade por separado con `allSettled`, así que uno roto no tumba al resto (`sw.js:7-28`).
  - `skipWaiting` al instalar; al activar borra las cachés de otras versiones y hace `clients.claim` (`sw.js:21-36`).
  - Nunca toca `/api/`, `/ace/`, `/content/` ni `/remux/`, ni peticiones que no sean GET o que vayan a otro origen (`sw.js:38-45`).
  - Las navegaciones van primero a la red y guardan copia en `/`; sin red, se sirve `/` desde la caché (`sw.js:49-60`).
  - Los estáticos se sirven desde la caché y, si no están, de la red; las respuestas buenas se guardan (`sw.js:62-71`).

---

## 17. Media Session

- `anunciarEnPantallaDeBloqueo` (5308-5317) se llama al empezar a reproducir (4504).
- Solo publica metadatos: título del canal (o `Ace Player Neo`), artista `Ace Player Neo` y portada `/icon-512.png`.
- No registra acciones (`setActionHandler`), así que no hay play, pausa ni siguiente o anterior desde la pantalla de bloqueo.

---

## 18. Atajos de teclado

Manejador en 6081-6108. Se ignoran todos (salvo Escape) mientras se escribe en un campo.

| Tecla | Acción | Condición |
|---|---|---|
| `Escape` | Cierra el menú del reproductor (devolviendo el foco) o, si no está abierto, los modales. | El bloqueo de primer uso lo impediría, pero está inactivo. |
| `Espacio` / `K` | Pausa o reanuda. | Solo si se está reproduciendo. |
| `M` | Silencio. | Solo si se está reproduciendo. |
| `F` | Pantalla completa. | Siempre. |
| `P` | PiP. | Siempre. |
| `G` | Favorito del canal actual. | Si hay canal, aunque la fila superior esté oculta (5970). |
| `S` | Panel nerd. | Solo si se está reproduciendo. |
| `J` | Retroceder 30 s. | Solo si se está reproduciendo. |
| `←` / `→` | Canal anterior o siguiente. | Solo si hay canal, **estamos en `viendo`** y el foco no está en pestañas, días, flechas, campos, controles NEO, carril de fuentes ni conmutador de la agenda (6098-6106). |
| `/` | Abre la biblioteca y enfoca el buscador. | Siempre. |
| `Tab` | Trampa de foco dentro del modal abierto. | Con un modal abierto (5848-5858). |
| `Enter` | Envía el campo en el que se escribe: Content ID, hash externo, vincular a mano, equipo o país personalizado, búsqueda en el motor. | En el campo correspondiente. |

---

## 19. Gestos y ratón

- **Vídeo en escritorio NEO:** un clic pausa o reanuda (espera 190 ms), doble clic pone pantalla completa, clic derecho abre el menú propio, y mover el ratón o pulsar despierta los controles (6012-6024).
- **Tira de días:** la rueda vertical la desplaza en horizontal y tocarla cancela el auto-centrado (3145-3152).
- Scroll horizontal táctil en el carril de fuentes y en las acciones del inspector (1798, 1901).
- Clic en el velo de un modal para cerrarlo (5844-5846).
- **No hay** gestos de deslizar para zapear, ni doble toque en móvil, ni pulsación larga.

---

## 20. Móvil y escritorio

| Aspecto | Escritorio | Móvil o táctil | Líneas |
|---|---|---|---|
| Controles de vídeo | Propios (NEO) con menú contextual | Nativos del navegador | 5087-5088, 5168-5175 |
| Fila título, Fav, Stats | Sobre el vídeo, al pasar el ratón | Debajo del vídeo, siempre visible | 313, 917-922, 6048-6055 |
| Portada | Dos columnas | Agenda y luego biblioteca, cada una hasta 70dvh | 1146-1164, 1255-1267 |
| Visionado | Vídeo más panel lateral | Vídeo fijo arriba bajo la cabecera y panel debajo | 1219-1229 |
| Barra de estadísticas y zapping | Oculta en `viendo` NEO | Oculta en ≤860 px | 938, 1682 |
| Barra de comando | Oculta en `viendo` NEO | Visible en `viendo` | 1682-1684, 939-941 |
| Texto del motor en la cabecera | Visible | Solo el punto | 933, 1237 |
| Toasts | Abajo a la derecha | Abajo y centrados, con zona segura | 880, 1269 |
| Acciones de las tarjetas | Al pasar el ratón | Siempre visibles, 33 a 40 px | 681-685, 910-914, 1246 |
| Modales de preferencias y resolución | Centrados | Anclados abajo; en preferencias la botonera queda fija abajo | 971-986 |
| Agenda estrecha | — | *Container queries* según su propio ancho: en ≤860 px la fila pasa a 2 líneas; en ≤640 px se compactan cabecera y pie | 575-607 |
| Centro de partido e inspector | En fila | En columna, con acciones deslizables (≤720 px) | 1894-1903 |
| Cabecera muy estrecha (≤365 px) | — | Iconos de 30 px y la píldora del motor reducida a un punto | 988-997 |

- Los umbrales de escritorio NEO (901 px) y de maquetación (1100 px) no coinciden. Entre 901 y 1100 px con ratón hay controles NEO **y además** barra de estadísticas y barra de comando (1681-1686).
- Se respeta `prefers-reduced-motion` (106-108).

---

## 21. iOS (iPhone y iPad)

- **Detección:** el UA dice iPad, iPhone o iPod, o bien `MacIntel` con pantalla táctil para iPadOS (2340-2343).
- **Reproducción:** siempre por `/api/remux` (fMP4 limpio), nunca mpegts ni el HLS del motor (4643, 4697-4731).
- **Sin rebuffer propio.** El vigilante da 54 s para conectar, empuja al directo a los 6 s de atasco y reintenta a los 24 s (5182, 5238, 5256-5264).
- **Cortes del reproductor nativo:** con `error` o `ended` se reconecta al momento (5270-5281).
- **Al volver a la app** (`visibilitychange`): si el vídeo está en error, terminado o sin datos, se reconecta con `Reconectando al volver a la app` (5294-5306).
- **Pantalla completa** con `webkitEnterFullscreen` (5977-5980). `playsinline` en el vídeo.
- **Zona segura:** notch arriba y márgenes laterales (1374-1392). Las capas de textura se quitaron porque pintaban rayas sobre el vídeo (1369-1372).
- **Portapapeles:** respaldo por HTTP (5440-5451).
- **Service worker:** en `http://` de la LAN no se registra (§16). La PWA se instala, pero sin caché.

---

## 22. Modo demo

- **Cuándo se activa** (6111-6124):
  - con `?demo=1`;
  - con el protocolo `file:`;
  - o si `GET /api/state` falla en 2,5 s **y** el host es localhost, 127.0.0.1 o ::1.
  - En un Umbrel real, un fallo pasajero nunca activa la demo.
- **Datos:** 18 canales de muestra; 3 favoritos, uno de ellos `Canal caído (ejemplo)`; 2 recientes; el directorio `Directorio de muestra`; la agenda de muestra; una resolución simulada (Champions con 4 o 5 señales y escaneo simulado; DAZN); salud simulada y estadísticas aleatorias (2404-2464, 3379-3406, 4300-4306).
- **Persistencia:** todo el estado se guarda en `localStorage['aceneo-demo']` (2642-2647).
- **Reproducción:** capa «SEÑAL DEMO» tras 1,8 s (4832-4847).
- Acciones que no funcionan en demo: sincronizar, activar y borrar directorios (5763-5766, 5782, 5805).

---

## 23. Llamadas a la API y al motor

| Ruta | Método | Cuándo | Parámetros o cuerpo | Qué hace con la respuesta | Línea |
|---|---|---|---|---|---|
| `/api/state` | GET | Al arrancar, dos veces: detección de demo (2,5 s) y carga. También al abrir Ajustes, desde «Añadir una lista», cada 5 min y 5 s después de un fallo de carga. | — | `favorites`, `history`, `web`/`streams`, `webSyncedAt`, `webSources`, `activeWebSourceId`, `preferences`, `channelBindings`, `sourceReports` y `learningCount` pasan al estado y se repinta. | 6117, 2632, 5818 |
| `/api/library` | POST | Historial, favoritos, renombrar y borrar. | `{action:'history-upsert'\|'favorite-upsert'\|'delete'\|'rename', item \| collection, id, title, sourceId}` | Sustituye `favorites`, `history` y el directorio si vienen en la respuesta. | 2665-2672 |
| `/api/preferences` | POST | Guardar gustos o «Ahora no». | `{onboardingComplete, country, leagues, teams, nationalities}` | `preferences` | 2892 |
| `/api/football` | GET | Al arrancar, con Actualizar y con Reintentar (14 s). | — | `days[{date, matches[{id, date, time, title, home, away, competition, country, channels[{id,name}], start}]}]` más `attribution`, `stale`, `partial`, `limited` y `demo`. | 3369 |
| `/api/scores` | GET | Sondeo condicional (§24). | — | `scores{[matchId]:{state:'pre'\|'in'\|'post', home, away, clock, detail}}` | 3200 |
| `/api/football/resolve` | GET | Ver o Buscar canal (20 s) y Rebuscar (30 s). | `channel` repetido, `match`, `client`; en rebúsqueda además `research=1`, `current` y `current_ih` | `status`, `channels`, `checked[]`, `candidate`, `candidates[{id, title, ih, source, listaId, score, availability, alias, bitrate, learned, matchedChannel}]`, `engineAvailable`, `scan{id, statusUrl, total, initialCount}`, `preheat{status, candidateCount}` y `ai{enabled, used, model}`. | 4066-4084 |
| `/api/football/scan?id=` (o `statusUrl`) | GET | Cada 1,5 s durante el escaneo (5 s de límite) y en el seguimiento de un reporte. | `id` | `status` (`complete`, `waiting`, `cancelled`…), `total`, `checked`, `playable`, `retryAt` y `candidates[{id, state, reason, peers, speedDown, bytes, durationMs, videoCodec, intakeKbps, streamKbps, attempts, retryAt}]`. | 3552-3554, 3666, 3994 |
| `/api/football/bind` | POST | Recordar elección y vincular a mano. | `{channel, id, title, ih, updatedAt}` | `binding` y `channelBindings` | 3433 |
| `/api/sources/feedback` | POST | «Es el canal correcto». | `{id, title, channel, verdict, reason}` | Se ignora (solo cuenta si hay error). | 3968 |
| `/api/sources/report` | POST | Reportar y comprobar. | `{id, title, ih, source, channel, matchId, reason, client}` | `report` (cuarentena) y `scan` para el seguimiento. | 4030 |
| `/api/sources/outcome` | POST | Arrancó, falló o cayó; y «sigue» cada 2 min. | `{id, title, listaId, source, resultado, segundos}` / `{id, resultado:'sigue'}` | Nada: se envía sin esperar respuesta. | 4453, 4470 |
| `/api/playback/claim` | POST | Cada reproducción que no es una recuperación. | `{id, title, dev, token}` | `nowPlaying{id, title, dev, token, at}` | 4181 |
| `/api/playback/release` | POST | Detener, fallo y `pagehide` (con `keepalive`). | `{id, dev, token}` | — | 4199, 4203 |
| `/api/playback` | GET | Cada 5 s mientras se reproduce o conecta. | — | `nowPlaying`: si es de otro dispositivo y más reciente, se detiene. | 4214 |
| `/api/engine/status` | GET | Al arrancar, cada 20 s y 2,5 s después de reiniciar. | — | `online` | 4249 |
| `/api/restart-engine` | POST | Reiniciar el motor (doble toque). | — | Solo mira `ok`. | 4265 |
| `/api/health` | GET | Al abrir Salud y con «Volver a comprobar». | — | `version`, `checkedAt`, `uptimeSeconds`, `reports{quarantined, learningCount}` y `components{backend, engine, scanner, ai, agenda, directories}`. | 4308 |
| `/api/search?q=` | GET | Búsqueda en el motor (450 ms de espera). | `q` | `results[]` | 5675 |
| `/api/streams/sync` | POST | Guardar M3U o HTML y Actualizar una lista. | `{sourceId?, name, url, type:'m3u'\|'html'}` | Estado del directorio o `error`. | 5768 |
| `/api/streams/activate` | POST | Usar una lista. | `{sourceId}` | Estado del directorio. | 5784 |
| `/api/streams/delete` | POST | Borrar una lista (segundo toque). | `{sourceId}` | Estado del directorio o `error`. | 5807 |
| `/api/remux` | GET | iOS siempre (55 s); HLS nativo como plan B. | `id` o `infohash`, `dev` | `{url, token}`: la URL se pone en `video.src`. | 4712, 4809 |
| `/api/remux/stop` | POST | Al destruir el reproductor y en `pagehide` (`keepAlive:true`). | `{id, dev, keepAlive, token}` | — | 4633 |
| `/ace/getstream?{id\|infohash}=…&format=json&_=` | GET | Metadatos de la sesión (mpegts, 12 s). | | `response.playback_url`, `stat_url` y `command_url` | 4599-4611 |
| `/ace/manifest.m3u8?…&format=json&_=` | GET | Metadatos de la sesión HLS fuera de iOS. | | Igual que la anterior. | 4601 |
| `playback_url`, o si falta `/ace/getstream?…&_=` o `/ace/manifest.m3u8?…&_=` | GET | La reproducción en sí (mpegts.js, hls.js o nativo). | | Flujo de vídeo. | 4646, 4736 |
| `stat_url` (`/ace/…`) | GET | Cada 2 s (4,5 s de límite). | | `response{peers, speed_down, speed_up, status}` | 4529-4552 |
| `command_url&method=stop` | GET | Al destruir el reproductor y en `pagehide` (`keepalive`). | | — | 4621-4626 |

Notas de la tabla:
- Todas las peticiones POST de JSON pasan por `postJson`, con 12 s de límite y aborto encadenado. Si la respuesta no es `ok`, se lanza `error`, o `request_failed` si no viene (2648-2664).
- Todas las peticiones GET de datos van con `cache:'no-store'`.

---

## 24. Sondeos, intervalos y temporizadores

### 24.1 Sondeos

| Qué | Intervalo | Condición | Línea |
|---|---|---|---|
| Estado del motor | 20 s | Siempre, salvo en demo. | 6162 |
| Estado completo (`/api/state`) | 5 min | Siempre, salvo en demo. | 6163 |
| Traspaso (`/api/playback`) | 5 s | El temporizador siempre corre, pero solo consulta si se reproduce o conecta y no es demo. | 4229 |
| Estadísticas (`stat_url`) | 2 s | Mientras hay sesión con `stat_url`. | 4556 |
| Comprobador | 1,5 s (demo 1,35 s) | Mientras hay escaneo y no está `complete`. | 3563, 3567 |
| Seguimiento de un reporte | 1,5 s × 32, o hasta `retryAt` (máximo 31 min) | Tras reportar, mientras la fuente siga en la lista. | 3990-4009 |
| Marcadores | 8 s si hay algo en juego, 45 s si no | Solo si el día visible tiene un partido en su ventana. | 3181-3182, 3210-3215 |
| Vigilante de reproducción | 1,5 s | Siempre (no hace nada en demo). | 5231-5266 |
| Espera de buffer | 250 ms | Durante el arranque o un rebuffer. | 4390 |
| Repintado de controles NEO | 500 ms | Siempre. | 6044 |
| Aviso «sigue» | cada 2 min (llamado desde el vigilante) | Si la fuente arrancó y la imagen avanza. | 4466-4472, 5252 |
| Estadísticas de demo | 1,5 s | En demo, al reproducir. | 4561-4565 |

### 24.2 Temporizadores y límites

| Qué | Valor | Línea |
|---|---|---|
| Toast | 2,8 s (máximo 2 visibles) | 2490-2491 |
| Línea de estado | 4,5 s más 320 ms de fundido | 2492, 2516-2519 |
| Deshacer al borrar | 6 s | 5413 |
| Confirmar borrado de lista | 5 s | 5802 |
| Confirmar reinicio del motor | 6 s | 5962 |
| Ocultar controles NEO | 3,2 s | 5133-5135 |
| Separar clic y doble clic | 190 ms | 6019 |
| Filtro local de la biblioteca | 140 ms | 6075 |
| Búsqueda en el motor | 450 ms | 5659 |
| Aviso de rebuffer | como mucho uno por canal cada 60 s | 5180 |
| Veredicto del reproductor | 3 min | 4477 |
| Cuarentena local de un reporte (si no hay respuesta) | 30 min | 4035 |
| Límites de petición | POST 12 s · agenda 14 s · resolver 20 s / 30 s · comprobador 5 s · estadísticas 4,5 s · traspaso 4,5 s · metadatos de sesión 12 s · remux 55 s · detección de demo 2,5 s | 2653, 3368, 4077, 3663, 4533, 4209, 4604, 4711, 6115 |
| Buffer inicial | máximo 55 s (mpegts) / 50 s (hls.js) | 4678, 4758 |
| Rebuffer | máximo 45 s | 5195 |
| Plan B del remux en HLS nativo | 15 s | 4824 |
| Reinicio del motor | nueva comprobación a los 2,5 s | 4267 |

---

## 25. Almacenamiento en el navegador

| Clave | Dónde | Qué guarda | Línea |
|---|---|---|---|
| `aceneo-pb` | `localStorage` | Modo de reproducción: `low`, `balanced` o `stable`. Se valida al leer. | 2360, 5941 |
| `aceneo-demo` | `localStorage` | Solo en demo: el estado entero (favoritos, historial, directorio, fuentes, preferencias, vínculos, reportes y `learningCount`) en JSON. | 2623, 2643-2646 |
| `aceneo-dev` | `sessionStorage` | Identificador aleatorio de 8 caracteres de esta pestaña, usado como «dispositivo» en el traspaso, los reportes, la resolución y el remux. | 2345-2347 |
| Caché `aceneo-0.6.59` | Cache Storage (SW) | El armazón estático. | `sw.js:7-19` |

Todo lo demás (favoritos, historial, preferencias, vínculos y reportes) vive en el backend y se comparte entre dispositivos (2197). No hay IndexedDB. Ninguna lectura de `localStorage` o `sessionStorage` va dentro de `try/catch` salvo la del estado de demo (2345, 2360); en v2 conviene protegerlas.

---

## 26. Detalles de comportamiento que hay que conservar

**Repintados y carruseles**
1. Ningún carrusel se recoloca solo al repintar:
   - la tira de días conserva su scroll y solo se centra al cambiar de día o la primera vez (3023-3039);
   - el carril de fuentes se actualiza en su sitio sin rehacerse (3781-3809) y, si se rehace, conserva la posición (3811-3820);
   - el carril solo se mueve para enseñar la fuente activa, la primera vez o al cambiar de activa, y nunca con `scrollIntoView`, que movería la página en vertical (3836-3856);
   - las acciones del inspector no se rehacen si no cambian (3897-3903).
2. Las listas no se vuelven a pintar si el HTML no cambia, comparando firmas: agenda (3352), días (3028), biblioteca (5555, 5583). Así no se relanzan las animaciones de entrada.
3. Los cambios de estado en listas son clases, no repintados: canal «en pantalla» (5541-5546), partido «buscando» (3299-3311), acordeones (5591-5596), marcadores (3171-3174).
4. Cambiar entre inicio y viendo, o entre agenda y biblioteca, solo toca un atributo y conserva el scroll y el estado (1138-1143, 3042-3047).
5. La agenda se vuelve a pintar por cambios de contenido de la biblioteca (con huella que detecta renombres), no por cambiar de pestaña (5515-5537).

**Avisos**

6. Como máximo 2 toasts. El más viejo cede el sitio y los repetidos se agrupan con `×n` (2485-2491, 2543-2570).
7. Los toasts nunca van encima del vídeo. Lo que le pasa a la señal va en la línea de estado bajo el vídeo mientras se ve algo (876-880, 2493-2502).
8. El aviso de rebuffer sale como mucho una vez por canal cada 60 s (5186-5193).

**Reproducción y navegación**

9. `←` y `→` solo zapean si hay canal, estamos en `viendo` y el foco no está en un control de navegación (6098-6106).
10. `‹ INICIO` no detiene nada. La barra «Sigue sonando» permite volver o detener (3056-3066).
11. En móvil, el vídeo se pega justo bajo la cabecera medida en vivo (1219-1225, 3048-3055).
12. Nunca se salta al directo automáticamente para recuperarse: primero se rellena el buffer, y reiniciar la sesión es lo último (5177-5179). El «directo» deja un colchón de seguridad (5009-5011, 5030).
13. La barra de directo no es una línea de tiempo navegable (1709-1713).
14. Los controles NEO solo se esconden si se está reproduciendo de verdad (5134). En escritorio hay un único reproductor visible: se bloquean los controles nativos y el menú multimedia de Chrome (1670-1679, 1734-1735, 6039-6041).
15. La pantalla completa del contenedor se usa donde se puede; en iPhone, la del propio vídeo. Los botones se ocultan si no hay ninguna API (5971-5986).
16. Una recuperación no renueva la reclamación de reproducción, y las reclamaciones van en cola (4174-4176, 4927-4929).
17. Detener suelta todo el rastro: `pendingResume`, fuentes, partido, destapados y atajos del canal (4982-5000).
18. Los reintentos son 3, o 1 en automático antes del primer arranque. El motor solo se da por «apagado» tras 2 fallos seguidos si se está viendo algo (5214-5217, 4238-4245).

**Fuentes**

19. Solo arranca sola la entrada al partido. En cuanto el usuario elige una fuente, todo es manual (3484-3488, 3599-3602, 3821-3828).
20. La fuente que se está conectando en pantalla sale como «comprobando» aunque el comprobador la dé por caída. El veredicto del reproductor manda durante 3 min (3681-3688, 4473-4481).
21. Una fuente que se vio 60 s o más y luego se cortó queda floja y visible, no oculta (4956-4963).
22. Mientras se escanea solo se ven la activa, las vivas y las 3 iniciales sin probar. Las caídas no ocupan sitio (3727-3738).
23. Desde la agenda se ofrecen todas las señales del partido. Desde la biblioteca, solo las del mismo canal (≥92) (3462-3481).
24. En la resolución no se reproduce nada ambiguo sin confirmación. `Recordar mi elección` viene marcado (3419-3420).
25. El telemétrico apunta un solo resultado por intento de fuente (4426-4454).
26. Con la agenda abierta y sin fuente activa, se conserva `Pegar hash` (3875-3886).

**Agenda y marcadores**

27. La agenda mantiene el orden cronológico. Tus equipos se resaltan sin reordenar (2968, 541-547).
28. Los estados de los partidos se calculan con la hora de Madrid (2982-2999). Las ligas y los equipos se comparan por clave exacta con alias, con la guarda de Hypermotion (2683-2763).
29. El marcador del partido que ves sale tapado hasta que lo pides. `pre` nunca se pinta. Solo se consulta si el día visible tiene partidos en su ventana (3176-3195, 3232-3239).
30. Máximo de 8 rótulos de canal por partido: lo aplica el backend (`server.js:64`, `server.js:4181`). El front los pinta todos.

**Biblioteca y edición**

31. Borrar se hace con deshacer de 6 s, y el borrado real va después. Borrar una lista y reiniciar el motor piden un segundo toque, sin `confirm()` nativo (5409-5439, 5792-5803, 5954-5963).
32. La biblioteca abre en la pestaña que tiene contenido. Cada estado vacío lleva un botón que lo resuelve. Desde cualquier pestaña se puede saltar a buscar en el motor (6131-6132, 5623-5640, 5578-5582).
33. Las búsquedas tienen espera y descartan respuestas atrasadas (6069-6079, 5654-5690).
34. Copiar funciona también por HTTP en la LAN (5440-5451).

**Preferencias y accesibilidad**

35. Las preferencias no bloquean la entrada: hay una tarjeta en lugar del modal. Si guardar falla, nada queda bloqueado (6136-6138, 2900-2907).
36. Accesibilidad:
    - modales con trampa de foco y devolución del foco (5825-5858);
    - `aria-live` en la agenda, el centro de partido, la línea de estado, el estado del reproductor y los toasts;
    - roles `tablist`, `radiogroup` y `menu`;
    - `aria-pressed` en chips y botones.
37. Cifras tabulares en horas, contadores y velocidades (86-89). Se respeta `prefers-reduced-motion` (106-108).
38. Al cerrar la página se sueltan la sesión del motor, el remux, el mando y el comprobador (4636-4639).

---

## 27. Cruce con el inventario mínimo del prompt

| Punto del prompt | Estado | Dónde |
|---|---|---|
| Agenda de fútbol | Encontrado | 2065-2097, 3313-3377 |
| Preferencias | Encontrado | 2167-2204, 2832-2911 |
| Centro de partido | Encontrado | 2014-2018, 3251-3285 |
| Selector: verde verificada | Encontrado | 1822, 1830, 3753 |
| Selector: ámbar floja | Encontrado (es `--warn` #E8C33A, amarillo) | 1823, 1831, 1017 |
| Selector: rojo fallida | Encontrado | 1824, 1832 |
| Selector: comprobando | Encontrado (punto verde latiendo) | 1829 |
| Inspector | Encontrado | 3872-3914 |
| Vincular a mano | Encontrado (solo en el modal «Encontrar canal») | 3409-3411, 4061-4065 |
| Pegar Content ID o hash | Encontrado | 2213-2230, 3919-3964, 1924 |
| Rebuscar | Encontrado | 4085-4135 |
| Reportar con motivos | Encontrado (5 motivos) | 2270-2286, 3978-4042 |
| Recordar la fuente resuelta | Encontrado (vínculos más aprendizaje) | 3420, 3428-3434, 3965-3976 |
| Play y pausa | Encontrado | 1985, 5163-5167, 6091 |
| Detener | Encontrado | 1986, 2003, 1937, 4975-5006 |
| Silencio y volumen | Encontrado (NEO; en móvil, nativos) | 1988-1989, 6005-6006, 6092 |
| Retroceso de 30 s con J | Encontrado | 1987, 2002, 5061-5074, 6097 |
| Indicador y botón de directo | Encontrado | 1983, 1993, 5038-5056, 5104-5119 |
| Pantalla completa también en iPhone | Encontrado | 5971-5986 |
| PiP | Encontrado | 5987-5994 |
| Canal anterior o siguiente con flechas solo si se está viendo algo | Encontrado | 6098-6106 (botones en 2034-2035, casi siempre ocultos) |
| Menú del reproductor | Encontrado | 1999-2006, 5144-5162 |
| Modos Baja latencia, Equilibrado y Estable | Encontrado (en Ajustes) | 2149-2155, 2387-2402, 5930-5953 |
| Reproductor externo | **No encontrado.** No hay VLC ni `intent:`; lo más parecido es «Pegar hash», una fuente externa. | — |
| Copiar canal | **Parcial.** Hay copiar hash, copiar enlace `acestream://` y copiar el nombre del canal. | 2004, 3894, 5461-5470, 3424 |
| Mini-reproductor | **Parcial.** Es la barra «Sigue sonando», sin imagen. | 1932-1938, 3056-3066 |
| Línea de estado bajo el vídeo | Encontrado | 2020, 2493-2525 |
| Toasts: máximo 2 y nunca encima del vídeo | Encontrado | 2490-2572, 876-880 |
| Panel nerd (estado del motor, pares, bajada y subida, hash) | Encontrado | 1973-1980, 4577-4581 |
| Salud: resumen | Encontrado | 4295 |
| Salud: cuadrícula por fuente | **Distinto.** Es por **servicio** (backend, motor, segundo motor, IA, agenda y directorios). | 4282-4293 |
| Salud: refrescar | Encontrado | 2265, 5902 |
| Salud: reiniciar con segundo toque | **En otro sitio.** Está en Ajustes, no en Salud. | 2157-2162, 5954-5963 |
| Biblioteca: favoritos, recientes y listas | Encontrado (el Directorio solo muestra la lista activa) | 5473-5486 |
| Biblioteca: buscador | Encontrado | 2107-2110, 6069-6079 |
| Biblioteca: abre en la pestaña con contenido | Encontrado | 6131-6132 |
| Biblioteca: estados vacíos con botón | Encontrado | 5623-5640 |
| Biblioteca: editar título | Encontrado | 5383-5408 |
| Biblioteca: borrar con deshacer de 6 s | Encontrado | 5409-5439 |
| Biblioteca: buscar en el motor | Encontrado | 5642-5690, 5578-5582 |
| Directorios: M3U y HTML por URL | Encontrado | 2130-2137, 5756-5780 |
| URL privadas bloqueadas salvo `ALLOW_PRIVATE_SYNC_URLS` | **Parcial.** El front solo muestra el error y la nota; la excepción es del backend. | 3742, 2137; `server.js:70`, `server.js:1312` |
| IPFS sin pasarela | **Parcial.** El front solo traduce `ipfs_*`; la URL por defecto es de ipfs.io y la resuelve el backend. | 3703-3704, 3748-3749, 2348; `server.js:1441-1450` |
| Motivo del último fallo | Encontrado | 5697-5706, 5720 |
| Estado del motor en la cabecera | Encontrado | 1920-1923, 4232-4258 |
| PWA | Encontrado (el SW solo se registra en contexto seguro) | `manifest:1-24`, `sw.js:1-72`, 10-18, 6141-6159 |
| Media Session | **Parcial.** Solo metadatos, sin acciones. | 5308-5317 |
| Ollama opcional | **Parcial e indirecto.** Solo la fila «IA local» de Salud, el chip `IA` y el sufijo `· revisadas por la IA`. | 4286, 3408, 4122 |

---

## 28. Lo que tiene el front y el inventario no menciona

1. **Dos pantallas** (portada sin reproductor y visionado), el botón `‹ INICIO` y el conmutador Agenda/Biblioteca en visionado (1138-1186, 3067-3102).
2. **Barra de comando con Content ID** (`Reproducir` y `Detener`) y el botón «Pegar hash» de la cabecera (2039-2045, 1924).
3. **Marcadores en vivo** en la agenda y en el centro de partido, con ocultación anti-spoiler del partido que ves (3163-3295).
4. **Insignias de estado del partido** (`EN DIRECTO`, `EN n MIN`, `EN h H m MIN`, `TERMINADO`) y **resaltado de tus equipos** (3001-3008, 541-547).
5. **Filtro `Para ti` / `Todos`** y la tarjeta de primer uso (2073-2076, 2082-2087).
6. **Coincidencia local en la agenda:** `Ver canal` si ya está en tu biblioteca, `Buscar canal` si no, y rótulos destacados (3334-3344, 2920-2932).
7. **Comprobador con arranque automático** de la primera fuente verificada, **reintento de las fallidas en reposo** y precalentado (3548-3725, 3278-3284).
8. **Aprendizaje:** «Es el canal correcto» y telemetría automática de resultados («arrancó», «falló», «cayó», «sigue») (3965-3976, 4426-4472).
9. **Traspaso de reproducción entre dispositivos** (4159-4229).
10. **Reanudación automática** cuando el motor vuelve (4252-4256).
11. **Recuperación en capas:** buffer inicial por modo, rebuffer, vigilante, reintentos y, en iOS, reconexión por `error`, `ended` o al volver a la app, y empuje al directo (5177-5306).
12. **Adaptador remux fMP4 para iOS** y plan B del HLS nativo (4697-4828).
13. **Guardar favorito con nombre** (modal) y aviso de **favorito caído** (2232-2244, 5489-5509).
14. **Copiar enlace `acestream://`** desde las tarjetas (5461-5470).
15. **Barra de estadísticas** (pares, bajada, subida y estado del buffer) y **botones de zapping** (2028-2037).
16. **Panel de reposo informativo** (motor, canales y partidos) y **capa «Toca para reproducir»** (4329-4341, 2008-2011).
17. **Ratón en escritorio:** clic para pausar, doble clic para pantalla completa, controles que se esconden y cursor oculto (6012-6024, 5129-5136).
18. **Atajos adicionales:** M, S, G, F, P, `/` y Escape (6081-6108).
19. **Gestión completa de listas:** activar una (`Usar`), actualizar a mano, borrar con segundo toque, máximo de 8, texto de auto-actualización cada 3 h y URL por defecto (5707-5822, 2137).
20. **Modo demo completo** y detección automática (2404-2464, 6111-6124).
21. **Accesibilidad:** trampa de foco en modales, `aria-live` y roles (5825-5858).
22. **Historial automático** de hasta 60 canales (4931-4937).

---

## 29. Contradicciones, código muerto y dudas

1. **Reproductor externo:** no existe en 0.6.59 ni aparece en el CHANGELOG. Si v2 lo quiere, es una funcionalidad nueva.
2. **Salud frente a lo que dice el prompt:** la cuadrícula es por servicio, no por fuente, y el reinicio con doble toque está en Ajustes (2157-2162, 5956-5963).
3. **El «mini-reproductor» no tiene imagen:** en la portada, `#hero` está oculto (1149) y solo suena el audio.
4. **El service worker no se registra en HTTP** (6147). En `http://umbrel.local:7792` no hay caché ni arranque rápido; la PWA solo aporta el icono.
5. **El acceso directo `?vista=agenda`** no se trata en el código (6156). Funciona solo porque la agenda es la vista por defecto.
6. **El bloqueo de primer uso es código muerto:** `openPreferences(true)` no se llama nunca (2866, 2872-2873, 2900-2907, 5845, 5926-5929, 6086).
7. **Ramas sin uso:**
   - `sendSourceFeedback(…,'incorrect')` no tiene botón (3970, 3974);
   - `sourceStateLabel` no se usa (3858-3871);
   - `tab-canales` es un residuo (4924);
   - `probeCodec` se guarda pero no se muestra (3693).
8. **El reintento como infohash probablemente nunca se dispara:** solo se llama si `playMpegts` rechaza su promesa (4940-4944, 4859), pero sus errores internos se capturan (4647-4653) y los de mpegts van por `retryCurrentPlayback` (4664-4673). Un hash pegado que sea un infohash puede no probarse nunca como tal.
9. **Rotulado raro en «Encontrar canal»:** `· {availability} fuentes` pinta la disponibilidad, que es una fracción de 0 a 1 o un porcentaje, como si fuera un número de fuentes (demo: «0.91 fuentes») (3420).
10. **`Copiar nombre del canal`** usa solo `navigator.clipboard`, sin respaldo, así que falla por HTTP en la LAN (3424). El resto de copias sí tiene respaldo.
11. **Pegar un hash desde la cabecera** mientras suena un canal de la biblioteca le pone el **título de ese canal** y lo añade a sus fuentes (3949-3955). Además no entra en el historial (3962).
12. **Las insignias `EN n MIN` y `EN DIRECTO` no se actualizan con el tiempo:** solo se recalculan al repintar la agenda, y la agenda no se refresca sola (§3.1).
13. **Dos relojes distintos:** `Hoy` y `Mañana` usan la fecha del dispositivo (3010), mientras que los estados de los partidos usan la hora de Madrid (2985). Fuera de España pueden no cuadrar.
14. **El panel de reposo dice «Hoy»** pero cuenta los partidos del día **seleccionado**, y «Canales» suma directorio y favoritos, sin recientes (4335-4340).
15. **El texto de la tarjeta no cuadra con el código:** dice que la agenda «pondrá primero lo tuyo», pero no reordena: filtra (Para ti) y resalta (2084, 2968).
16. **El orden del zapping** es el de llegada de las categorías, mientras que la biblioteca las ordena alfabéticamente. Los recientes no entran (5323-5330, 5565).
17. **El directorio solo muestra la lista activa** aunque la nota dice que «cada una conserva sus canales». La coincidencia local de la agenda (`Ver canal` o `Buscar canal`) tampoco mira las listas inactivas (2575-2583, 2912-2919).
18. **Visibilidad casi nula:** la barra de estadísticas, los botones de zapping, la barra de comando y las pistas de teclado quedan ocultos en casi todas las combinaciones (938, 1231, 1682-1684). Hay que decidir en v2 si se quedan.
19. **Nombres de variables engañosos:** `--amber` se redefine a rojo #E61919 (1012). El color «comprobando» se define dos veces, 1626 y 1829, y gana la última (verde).
20. **Consultas de marcadores de más:** cada `renderFootball` dispara una consulta inmediata a `/api/scores` (3358), aunque el repintado se deba a otra cosa.
21. **Una fuente reportada no se cambia sola,** aunque la nota dice que «se apartará». Tampoco se vuelven a filtrar las fuentes visibles fuera del escaneo (4034-4038).
22. **El SW no precachea** `icon-180.png` ni `icon-maskable-512.png` (`sw.js:8-19`). Los estáticos se sirven desde la caché mientras la versión no cambie, así que cada cambio de JS o fuentes obliga a subir `VERSION`.
23. **`DEV_ID` va en `sessionStorage`,** así que dos pestañas del mismo navegador se quitan el mando entre sí (2345-2347).
24. **El nerd enseña el estado del motor** (`online`/`offline`), no el `status` de la sesión, que sí se lee (`S.stats.status`, 4544) (4577).
25. **Quitar un favorito con la estrella** no tiene deshacer; borrarlo con la papelera en la pestaña Favs, sí. Hay dos comportamientos distintos para lo mismo (5344-5355, 5413-5439).
26. **Sincronizar una lista** no deshabilita los botones mientras dura, así que se puede enviar dos veces (5756-5780).
