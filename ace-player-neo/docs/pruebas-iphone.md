# Pruebas de Ace Neo en el iPhone real

Lo que la CI no puede comprobar (el simulador no tiene PiP de verdad, ni
pantalla de bloqueo, ni llamadas, ni auriculares, ni cámara, ni Tailscale) se
prueba aquí, a mano, en el iPhone de Isma. Cada paso dice qué hacer y **qué
tiene que pasar**. Marca `[x]` lo que salga bien; si algo falla, anota el
número del paso, la hora, la red (Wi-Fi de casa / datos + Tailscale) y lo que
ves (una captura ayuda), y mira el **Registro de fallos** de la sección
**Salud** de la web, donde la app manda sus fallos de reproducción.

Cómo instalar la IPA: `docs/ios.md`. Direcciones del Umbrel: `docs/acceso-remoto.md`.

## 0. Preparación

| # | Paso | Resultado esperado | ✔ |
|---|---|---|---|
| 0.1 | Instala la IPA con IPA Station. En el iPhone: Ajustes → General → VPN y gestión de dispositivos → confiar; Ajustes → Privacidad y seguridad → Modo de desarrollador activado. | Aparece **Ace Neo** con su icono en la pantalla de inicio y abre. | [ ] |
| 0.2 | Abre Ace Neo por primera vez. | Pantalla **Emparejar** con tres huecos (red local, Tailscale, código) y el botón «Escanear código QR». «Emparejar» está desactivado. | [ ] |
| 0.3 | Ajustes (de la app, tras emparejar) → Acerca de. | Versión 0.8.0 y el número de compilación = número de la ejecución de la CI de la que bajaste la IPA. | [ ] |

## 1. Emparejar por QR en la LAN

Wi-Fi de casa, Tailscale **apagado** en el iPhone.

| # | Paso | Resultado esperado | ✔ |
|---|---|---|---|
| 1.1 | En el PC abre la web por la LAN (`http://umbrel.local:7792`) → Ajustes → Dispositivos → **Emparejar un dispositivo**. | La web enseña un código de 6 dígitos y un QR, con la cuenta atrás de 5 minutos. | [ ] |
| 1.2 | En Ace Neo pulsa **Escanear código QR**. | iOS pide permiso para la **cámara** con el texto de la app (en español). Al aceptarlo se abre el visor. | [ ] |
| 1.3 | Apunta al QR. | El visor se cierra solo; el hueco **Red local** queda con `http://umbrel.local:7792` y el código relleno. | [ ] |
| 1.4 | Pulsa **Emparejar**. | La primera vez iOS pide permiso de **red local** (texto de la app en español): acéptalo. En unos segundos entra en la **Agenda**. | [ ] |
| 1.5 | Mira la web (Ajustes → Dispositivos). | Aparece el iPhone en «Dispositivos emparejados», con la fecha de ahora. El código ya no vale (uno nuevo si se vuelve a pedir). | [ ] |
| 1.6 | Alternativa sin la app: abre la **Cámara** del iPhone y apunta al QR de un código nuevo. | iOS ofrece abrir el enlace en **Ace Neo**; la app se abre con la dirección y el código rellenos (si ya estaba emparejada, pregunta antes «¿Emparejar con otro servidor?»). | [ ] |
| 1.7 | Cierra la app del todo (deslizar en el selector de apps) y vuelve a abrirla. | Entra directamente en la Agenda (el token sigue en el Llavero), sin pedir nada. | [ ] |

## 2. Emparejar por Tailscale (fuera de casa)

Wi-Fi **apagado**, datos móviles, **Tailscale encendido** en el iPhone.

| # | Paso | Resultado esperado | ✔ |
|---|---|---|---|
| 2.1 | Web → Ajustes → Dispositivos → revoca el iPhone (pulsa «Revocar» dos veces). | La app vuelve a **Emparejar** con el aviso «Se ha retirado el acceso de este dispositivo…» (ver también el paso 12). | [ ] |
| 2.2 | En el PC, abre la web **por Tailscale** (`http://umbrel.<tu-tailnet>.ts.net:7792`) → Emparejar un dispositivo → escanea el QR desde la app. | El QR lleva la dirección de Tailscale: el hueco **Tailscale** queda relleno (no el de red local). | [ ] |
| 2.3 | Pulsa **Emparejar**. | Entra en la Agenda por Tailscale. En Ajustes de la app, la conexión activa dice «Tailscale». | [ ] |
| 2.4 | En Ajustes de la app, rellena también la dirección de **red local** (`umbrel.local:7792`). | Se guarda sin volver a emparejar. | [ ] |
| 2.5 | Con la app abierta, vuelve a casa: enciende el Wi-Fi (Tailscale puede seguir encendido). | Sin tocar nada, la app pasa a usar la red local (Ajustes → conexión activa: «Red local») y la agenda sigue cargando. | [ ] |
| 2.6 | Apaga el Wi-Fi otra vez. | Vuelve sola a Tailscale; si estaba sonando algo, se reengancha (puede verse «Reconectando…» un momento). | [ ] |
| 2.7 | ATS con IP: pon en el hueco Tailscale la IP `http://100.x.y.z:7792` y quita el nombre; en casa, pon en red local la IP `http://192.168.1.x:7792`. Recarga la agenda en cada caso. | Las dos funcionan. Si iOS bloqueara una IP, la app lo dice con un mensaje claro (no se queda cargando): anótalo y usa el nombre `.ts.net` / `.local`. | [ ] |

## 3. Reproducción básica

| # | Paso | Resultado esperado | ✔ |
|---|---|---|---|
| 3.1 | Agenda → un partido con canal (o Biblioteca → un favorito). | Centro de partido: cabecera, lista de fuentes con su estado (Comprobando / Verificada / Floja…). Cuando hay una **Verificada**, empieza a sonar sola (arranque automático). | [ ] |
| 3.2 | Espera a la imagen. | Vídeo y sonido en menos de ~10 s desde que la fuente está verificada. La línea de estado deja de decir «Conectando». | [ ] |
| 3.3 | Toca el vídeo. | Salen los controles con cristal: pausa, −30 s, **Directo** (con el retraso real, p. ej. «−8 s»), PiP, AirPlay y pantalla completa. Se esconden solos a los ~3 s. | [ ] |
| 3.4 | Pulsa **−30 s** y luego **Directo**. | Retrocede 30 s (el botón Directo enseña el retraso); al pulsar Directo vuelve al borde del directo (punto rojo). | [ ] |
| 3.5 | Pausa 1 minuto y reanuda. | Reanuda desde donde estaba (con retraso); Directo lo lleva al directo. | [ ] |
| 3.6 | Vuelve atrás a la Agenda sin parar. | Aparece el **mini-reproductor** justo encima de la barra de pestañas y sigue sonando. Tocarlo abre el **reproductor grande** (el vídeo crece desde el mini). | [ ] |
| 3.7 | Cambia de pestaña (Biblioteca, Buscar, Ajustes). | El mini sigue ahí y el audio no se corta. | [ ] |
| 3.8 | Ajustes → Modo de reproducción → cambia entre Estable / Equilibrado / Baja latencia con algo sonando. | Cambia sin cortar ni reconectar (solo cambia el colchón). | [ ] |
| 3.9 | En la web, abre el mismo canal en el PC mientras suena en el iPhone. | El iPhone sigue sonando (la sesión del motor se comparte). Si la web «toma el mando», el iPhone lo dice en la línea de estado. | [ ] |

## 4. Picture in Picture

| # | Paso | Resultado esperado | ✔ |
|---|---|---|---|
| 4.1 | Con el vídeo sonando en el centro de partido, sube al inicio (desliza desde abajo). | El vídeo sigue en una **ventana flotante (PiP)** sin cortes, con sonido. | [ ] |
| 4.2 | Mueve la ventana, hazla grande/pequeña, escóndela en el borde. | Todo funciona; el audio sigue incluso escondida. | [ ] |
| 4.3 | Pausa y reanuda desde los controles del PiP. | Pausa/reanuda; la app también lo refleja al volver. | [ ] |
| 4.4 | Pulsa el botón de «volver a la app» del PiP. | Se abre Ace Neo con el **reproductor grande** (o el centro de partido, si estabas en él) y el vídeo vuelve a su sitio, sin reconectar y **una sola imagen**. | [ ] |
| 4.5 | En la app, pulsa el botón **PiP** de los controles. | Entra en PiP sin salir de la app. | [ ] |
| 4.6 | Cierra el PiP con la X. | Se para el vídeo (o queda el mini en la app, según iOS), sin quedarse la sesión colgada: en la web, la sesión desaparece en menos de 1 min. | [ ] |
| 4.7 | Con el PiP abierto, deja el iPhone 10 min usando otras apps. | Sigue sonando; si la señal se cae, se reengancha sola. | [ ] |
| 4.8 | Con el PiP abierto, vuelve a Ace Neo **tocando su icono** (no el botón del PiP). | La ventanita del PiP se cierra sola y el vídeo vuelve al reproductor grande. **Nunca se ve doble** (antes salía la ventanita arriba y el reproductor debajo). | [ ] |
| 4.9 | Desde el reproductor grande, pulsa **PiP**. | El grande se minimiza al mini (con el icono de PiP en su vídeo) y puedes seguir usando la app. En el mini/partido pone «Se está viendo en imagen en imagen» con «Volver aquí», que cierra el PiP. | [ ] |

## 5. Audio en segundo plano

| # | Paso | Resultado esperado | ✔ |
|---|---|---|---|
| 5.1 | Con el vídeo sonando, **bloquea** el iPhone (botón lateral). | El **sonido sigue** con la pantalla apagada. | [ ] |
| 5.2 | Déjalo bloqueado 15 min. | Sigue sonando todo el rato (el latido al backend continúa; la web sigue mostrando la sesión). | [ ] |
| 5.3 | Desbloquea y vuelve a la app. | Vuelve la imagen; si se había quedado por detrás, vuelve al directo sola. Sin pantalla negra. | [ ] |
| 5.4 | Con el vídeo sonando en el mini (sin PiP), cambia a otra app que no reproduzca sonido. | El audio sigue. | [ ] |
| 5.5 | Abre otra app que reproduzca audio (Música, un vídeo de Safari). | Ace Neo se pausa (la otra app toma el audio). Al volver, se puede reanudar. | [ ] |
| 5.6 | Con el **interruptor de silencio** puesto, reproduce. | Suena igual (categoría de audio de reproducción de vídeo). | [ ] |

## 6. Pantalla de bloqueo y Centro de Control

| # | Paso | Resultado esperado | ✔ |
|---|---|---|---|
| 6.1 | Con algo sonando, bloquea el iPhone y enciende la pantalla. | En la pantalla de bloqueo aparece el reproductor: título del partido (o canal), la competición/fuente y la marca de Ace Neo como carátula. | [ ] |
| 6.2 | Pulsa pausa y luego reproducir desde la pantalla de bloqueo. | Pausa y reanuda de verdad (la app lo refleja). | [ ] |
| 6.3 | Pulsa **siguiente** / **anterior**. | Cambia a la siguiente/anterior fuente verificada del partido (si hay más de una); si no hay lista, los botones están desactivados. | [ ] |
| 6.4 | Abre el Centro de Control. | Mismo reproductor, mismos botones, funcionando. | [ ] |
| 6.5 | Para el vídeo desde la app. | El reproductor desaparece de la pantalla de bloqueo. | [ ] |

## 7. AirPlay

| # | Paso | Resultado esperado | ✔ |
|---|---|---|---|
| 7.1 | Con algo sonando, pulsa el botón **AirPlay** de los controles y elige el Apple TV / tele. | El **vídeo** (no solo el audio) pasa a la tele; en el iPhone se ve un aviso de que se está reproduciendo por AirPlay. | [ ] |
| 7.2 | Bloquea el iPhone 5 min. | La tele sigue reproduciendo. | [ ] |
| 7.3 | Vuelve a elegir «iPhone» en AirPlay. | Vuelve al iPhone sin reconectar desde cero. | [ ] |

## 8. Interrupciones

| # | Paso | Resultado esperado | ✔ |
|---|---|---|---|
| 8.1 | Con algo sonando, recibe una **llamada** (pide a alguien que te llame) y **cuelga sin cogerla**. | Al sonar la llamada, Ace Neo se pausa; al acabar, se reanuda solo. | [ ] |
| 8.2 | Recibe otra llamada y **cógela** 1 min; cuelga. | Durante la llamada, pausado; al colgar se reanuda solo o queda en pausa con el botón listo (iOS decide). Pulsa Directo si se quedó atrás. | [ ] |
| 8.3 | Invoca a **Siri** («Oye Siri, qué hora es») con algo sonando. | Se pausa mientras habla Siri y se reanuda después. | [ ] |
| 8.4 | Deja que suene una **alarma** o temporizador. | Se pausa; al pararla, se reanuda o queda en pausa lista para seguir. | [ ] |
| 8.5 | Graba una nota de voz con algo sonando (otra app que usa el micro). | Ace Neo se pausa y no se queda en un estado raro al volver. | [ ] |

## 9. Auriculares

| # | Paso | Resultado esperado | ✔ |
|---|---|---|---|
| 9.1 | Conecta AirPods (o auriculares Bluetooth) y reproduce. | El audio sale por los auriculares. | [ ] |
| 9.2 | Quítate los AirPods (o apágalos) con algo sonando. | **Se pausa** (no se pone a sonar por el altavoz). | [ ] |
| 9.3 | Vuelve a ponértelos y pulsa reproducir (en la app o en los propios AirPods). | Reanuda. | [ ] |
| 9.4 | Doble toque / pellizco en los AirPods. | Pausa y reanuda (y siguiente/anterior si está configurado). | [ ] |
| 9.5 | Si tienes auriculares con cable (adaptador): desconéctalos. | Se pausa, igual que en 9.2. | [ ] |

## 10. Rotación

Con el **bloqueo de rotación desactivado** en el Centro de Control.

| # | Paso | Resultado esperado | ✔ |
|---|---|---|---|
| 10.1 | Con el partido sonando en el centro de partido, gira el iPhone a horizontal. | Se abre el reproductor grande a **pantalla completa en horizontal**, sin cortar el vídeo. | [ ] |
| 10.2 | Toca el vídeo en pantalla completa. | Salen los controles, incluido el botón de cerrar, todos alcanzables (no quedan bajo la isla ni en los bordes redondeados). | [ ] |
| 10.3 | Vuelve a vertical, o pulsa la flecha (o desliza hacia abajo) para minimizar. | En vertical, el reproductor grande con el vídeo arriba; al minimizar, vuelve al centro de partido (o al mini), sonando. | [ ] |
| 10.4 | Gira a horizontal en la Agenda, la Biblioteca y Ajustes. | Las pantallas se ven bien en horizontal (nada cortado), o se quedan en vertical si así está pensado. | [ ] |
| 10.5 | Pulsa el botón de pantalla completa en vertical (en el partido o en el reproductor grande). | Gira a horizontal con el vídeo a pantalla completa; el mismo botón lo devuelve a vertical. | [ ] |

## 11. Volver a la app y cortes de red

| # | Paso | Resultado esperado | ✔ |
|---|---|---|---|
| 11.1 | Con algo sonando, deja la app en segundo plano (sin PiP) 5 min y vuelve. | Al volver comprueba la señal: si la sesión seguía viva, vuelve al directo; si no, se reengancha sola. Sin pedir nada. | [ ] |
| 11.2 | Activa el modo avión 20 s con algo sonando y quítalo. | «Reconectando (1/3)…» y vuelve a sonar solo. | [ ] |
| 11.3 | En la web, **reinicia el motor** (o Ajustes de la app → Reiniciar motor, confirmando). | La app avisa, espera y se reengancha sola cuando el motor vuelve. | [ ] |
| 11.4 | Con una fuente que se caiga (o reportándola), en automático. | Tras 3 reconexiones pasa a la **siguiente verificada** sola. Si la fuente la elegiste tú a mano, no salta: te pide que elijas otra. | [ ] |

## 12. Revocar

| # | Paso | Resultado esperado | ✔ |
|---|---|---|---|
| 12.1 | Con algo sonando en el iPhone, en la web → Ajustes → Dispositivos → **Revocar** el iPhone (dos pulsaciones). | En segundos el vídeo se para («Este dispositivo ya no tiene acceso…») y la app vuelve a **Emparejar** con el aviso «Se ha retirado el acceso de este dispositivo. Vuelve a emparejarlo desde la web.». | [ ] |
| 12.2 | Revoca con la app cerrada y ábrela después. | Al abrir, la primera petición da 401 y vuelve a **Emparejar** con el mismo aviso. | [ ] |
| 12.3 | Revoca con la app en PiP. | El PiP se para; al volver a la app, pantalla de Emparejar. | [ ] |
| 12.4 | Vuelve a emparejar con un código nuevo (QR). | Funciona; las direcciones que ya tenía se conservan y el iPhone aparece otra vez en la web. | [ ] |
| 12.5 | Ajustes de la app → **Olvidar este servidor**. | Borra token, direcciones y caché y vuelve a Emparejar (en la web el dispositivo sigue hasta que lo revoques). | [ ] |

## 13. Accesibilidad y apariencia (rápido)

| # | Paso | Resultado esperado | ✔ |
|---|---|---|---|
| 13.1 | Cambia a modo **oscuro** y a claro (Centro de Control). | Todas las pantallas se ven bien en los dos (las capturas de la CI, `AceNeo-capturas`, son la referencia). | [ ] |
| 13.2 | Ajustes → Accesibilidad → Texto más grande al máximo. | Se lee todo; nada se corta ni se solapa en Agenda, centro de partido y Ajustes. | [ ] |
| 13.3 | VoiceOver: recorre la Agenda y el reproductor. | Cada partido y cada botón se anuncia en español con sentido («Reproducir», «Directo, 8 segundos de retraso»…). | [ ] |
| 13.4 | Reducir movimiento activado. | Sin animaciones de muelle ni zoom grandes; todo sigue funcionando. | [ ] |

## 14. La vuelta de hoja (lo que Isma vio mal en el iPhone)

| # | Paso | Resultado esperado | ✔ |
|---|---|---|---|
| 14.1 | Abre la **Agenda** y la **Biblioteca** en claro y en oscuro. | El título grande va **arriba** (como en cualquier app de iOS) y debajo, dentro de lo que se desplaza, la tira de días / el selector Favoritos · Recientes · Listas. **Ninguna banda vacía** (ni blanca ni del color del fondo) encima ni debajo del título. | [ ] |
| 14.2 | Agenda: toca varios días de la tira. | Cada píldora dice «Hoy 23 · 5», «Mañana 24 · 2»…; la elegida se rellena de azul y se desliza; los partidos cambian. | [ ] |
| 14.3 | Agenda con tus gustos guardados (los de la web). | Se abre en **«Para ti»** y solo salen tus ligas, equipos y selecciones (las **reservas argentinas ya no salen primero**, ni salen). «Todos» enseña todo. Los partidos de tu equipo llevan una estrella. Los que van en directo, arriba; los terminados, al final. | [ ] |
| 14.4 | Toca el botón de ajustes junto a «Para ti» (o Ajustes → Tu fútbol). | «¿Qué fútbol te mueve?» con chips de ligas, equipos y nacionalidades (con bandera) y un hueco para añadir otros. Marca o quita uno y **Guardar**: la agenda cambia al momento y la web ve los mismos gustos. | [ ] |
| 14.5 | Sin gustos (bórralos todos y guarda). | La agenda enseña todos los partidos; «Para ti» no sale y queda el botón «Personalizar». Con un servidor recién instalado (sin personalizar nunca) sale la tarjeta «Personaliza tu agenda» con «Ahora no». | [ ] |
| 14.6 | Biblioteca → **Listas**. | Las categorías de la lista (DEPORTES, GENERALISTAS…) salen **agrupadas y plegadas**, con su número de canales, como en la web. Tocar una la despliega; otra vez, la pliega. Arriba, la lista activa y «Cambiar» para elegir otra. | [ ] |
| 14.7 | Biblioteca → Listas → escribe en el buscador. | Filtra dentro de la lista y despliega solas las categorías con resultados. | [ ] |
| 14.8 | Biblioteca → **Favoritos**. | Cada canal con su dorsal (número o inicial) y, si la agenda lo anuncia hoy, «● En directo…» o «A las 21:00, Local – Visitante». Recientes, por Hoy / Ayer / Esta semana / Antes. | [ ] |
| 14.9 | Toca un canal de la biblioteca (p. ej. BOING). | Empieza a sonar y se abre el **reproductor grande** (vídeo arriba, título, estado, favorito, PiP, «Más» y otros canales de la lista). | [ ] |
| 14.10 | En el reproductor grande, **desliza hacia abajo** desde el vídeo o la cabecera. | El reproductor baja siguiendo el dedo (se encoge un poco); al soltar pasado el umbral (o con un golpe rápido) se minimiza al mini con un muelle; si sueltas antes, vuelve arriba. | [ ] |
| 14.11 | En el mini, **desliza hacia arriba**. | Se abre otra vez el reproductor grande. Tocarlo también. **Siempre se puede volver** una vez minimizado. | [ ] |
| 14.12 | En el mini, desliza **hacia abajo** (o la ×). | Se detiene la reproducción con «Deshacer» (desde la 0.8.0 deslizar de lado ya no detiene; ver 15.8). | [ ] |
| 14.13 | Con algo sonando en el iPhone y otra cosa en el PC, Ajustes → **Dónde se está reproduciendo**. | Cada sesión con su canal y sus dispositivos: el iPhone (icono de móvil, su nombre, «Este dispositivo», Reproduciendo) y el PC (icono de ordenador, «Chrome · Windows» o similar). Pausa en el PC: en menos de 15 s (su siguiente latido) pasa a «En pausa». Para en el PC: desaparece. | [ ] |
| 14.14 | En esa sección, «Ver aquí» en la sesión del PC. | El iPhone se une a ese canal y abre el reproductor grande (la sesión del motor se comparte). | [ ] |
| 14.15 | Buscar → escribe «dazn». | Arriba, «En tu biblioteca» con tus canales al instante (y lo que emiten hoy); debajo, «En el motor AceStream» con la disponibilidad. Tocar uno lo pone a sonar en el reproductor grande. | [ ] |
| 14.16 | Ajustes → Listas. | Tus listas guardadas con la activa marcada; tocar otra la activa (la Biblioteca cambia). Deslizar: Actualizar / Borrar. Guardar una lista nueva con su dirección M3U. | [ ] |
| 14.17 | Abre la app sin red (modo avión) tras haberla usado. | Agenda, biblioteca y «Para ti» salen al instante con lo guardado (los gustos también se guardan), con el aviso «Sin conexión». | [ ] |

## 15. Palco (0.8.0)

El rediseño «Palco»: la agenda con su portada, las tarjetas «versus», el
escenario como única superficie de reproducción, el mini como accesorio de la
barra de pestañas (iOS 26) y los gestos con su respuesta háptica. Las
capturas de la CI (`AceNeo-capturas`, `claro-…` y `oscuro-…`) son la referencia.

| # | Paso | Resultado esperado | ✔ |
|---|---|---|---|
| 15.1 | Abre la app con algún partido en directo en la agenda (o sin nada sonando). | La **Agenda** enseña arriba la **portada**: la tarjeta «versus» grande del partido destacado con «● EN DIRECTO · 13'» y la cápsula de señal, y debajo «Local vs. Visitante» y «Ver ahora». **No suena nada** hasta que tocas «Ver ahora» (o abres un partido). | [ ] |
| 15.2 | Mira las tarjetas de la agenda (portada y secciones En directo · Próximos · Terminados). | Fondo partido en dos colores (los del club, unidos en diagonal), los dos **escudos grandes** (reales si el servidor los da; si no, un escudo generado con el monograma; nunca un hueco vacío), el logo de la competición en la pastilla del centro, el chip «VIE 21:00» o «● EN DIRECTO», la cápsula de señal («Señal», «Floja», «Sin señal», «Comprobando», «Señal lista», «Se comprueba 45 min antes») y la estrella de «tu equipo». **Ningún marcador en las tarjetas**, tampoco en las terminadas. | [ ] |
| 15.3 | Toca una tarjeta. | Se abre el **escenario** con un fundido cruzado: cabecera (flecha, competición, «Más»), el vídeo 16:9, el título con escudos, las cápsulas Señal · Dónde se emite · Más, la fila de **carteles de fuentes** (tesela del canal, «1080p · Elcano», anillo de estado; **dorado** el que está en pantalla) y «Datos técnicos» plegado. En un partido en directo arranca sola la primera verificada; en uno futuro, la caja del vídeo enseña la hora y «Ver el canal ahora». | [ ] |
| 15.4 | En iOS 26, fíjate en la barra de pestañas mientras suena algo y bajas por una lista. | La barra es la del sistema (Liquid Glass) con Agenda · Canales · Ajustes y el botón de Buscar; se **pliega al bajar** y el **mini** (imagen viva 96×54, título, minuto · estado, play, ×) va **dentro de la barra** como su accesorio (una sola línea cuando la barra está plegada). Nada de una segunda barra encima. | [ ] |
| 15.5 | En el escenario, **arrastra el vídeo hacia abajo** despacio y suelta pasado el umbral. | Toda la pantalla se **encoge siguiendo al dedo** (escala, esquinas redondeadas, el resto se apaga), vibra al pasar el umbral y al soltar se minimiza al mini. Si sueltas antes, vuelve arriba con muelle. | [ ] |
| 15.6 | Con dos o más fuentes verificadas o flojas, **desliza el vídeo a un lado**. | Aparece la pista «Siguiente fuente» / «Fuente anterior», vibra al armar y al soltar cambia de fuente con un **corte a negro** de medio segundo; el cartel dorado y la etiqueta «En pantalla» se deslizan al nuevo. Con una sola fuente, el gesto no hace nada. | [ ] |
| 15.7 | **Un toque** en el vídeo; luego **dos toques** seguidos. | Un toque enseña o esconde los controles **al instante** (sin esperar al doble toque); el doble toque gira a **pantalla completa** con vibración; otro doble toque (o el botón) vuelve. | [ ] |
| 15.8 | En el mini, **desliza hacia abajo**; luego toca «Deshacer». | El mini se va y se detiene la reproducción; sale el aviso «… detenido» con **Deshacer** durante 6 s: al tocarlo vuelve a sonar lo mismo y el mini reaparece. Deslizar de lado **ya no detiene**. | [ ] |
| 15.9 | En el escenario, toca la cápsula «Señal · n» (o «Todas» al final de la fila). | Se abre la **hoja de fuentes** (media altura, se puede subir del todo) con todos los carteles en dos columnas, «Rebuscar» arriba y «Pegar Content ID» abajo; tocar un cartel lo pone en pantalla y cierra la hoja. Mantén pulsado un cartel: menú (Es el canal correcto · No es este canal · Reportar… · Copiar enlace). | [ ] |
| 15.10 | Con un partido en directo sonando, mira el marcador del escenario; luego cambia de fuente o de canal. | El marcador va **tapado** («Marcador» con un ojo): al tocarlo se destapa (dígitos que ruedan y la lista de goles con su minuto) y **se vuelve a tapar al cambiar de canal**. En las tarjetas de la agenda y en la portada, el marcador nunca aparece. | [ ] |
| 15.11 | Ajustes → **Apariencia**: Sistema · Claro · Oscuro. | Cambia al momento en toda la app. En **claro** conserva la personalidad (tarjetas versus, oro, cápsulas) sin ser una versión lavada del oscuro; en **oscuro**, fondos casi negros y la barra de Liquid Glass sin bandas. «Reducir transparencia» de iOS pone los cristales opacos. | [ ] |
| 15.12 | Ajustes → Accesibilidad → Texto más grande al máximo. | Agenda, escenario, Canales y Ajustes se leen; las cápsulas y filas se adaptan (se desplazan en horizontal si no caben), nada se solapa ni se corta. | [ ] |
| 15.13 | VoiceOver por la agenda, el escenario y el mini. | Cada tarjeta se anuncia con equipos, competición, hora o minuto, señal y «tu equipo»; el escenario es una ventana modal (el «Escape» de dos dedos lo minimiza); el mini dice qué suena y tiene las acciones «Abrir el reproductor» y «Detener». Todo en español. | [ ] |
| 15.14 | Con algo sonando en el escenario, **gira** el iPhone a horizontal; luego vuelve a vertical. | Solo el vídeo a pantalla completa con las zonas seguras laterales; el botón de arriba a la derecha es «Minimizar» (no hay «salir»: se sale girando). En vertical vuelve el escenario entero. Con el escenario cerrado (mini), girar abre el escenario a pantalla completa. | [ ] |
| 15.15 | Con el vídeo en el escenario, sube al inicio (PiP) y vuelve a la app tocando su icono. | El PiP se cierra y el vídeo vuelve al escenario, **una sola imagen**, sin reconectar (igual que en la sección 4). | [ ] |
| 15.16 | Canales: fila «Emitiendo ahora», favoritos, recientes y listas; mantén pulsado un canal. | Carteles con el dorsal grande y lo que emiten; en las filas, deslizar a la izquierda borra con Deshacer y a la derecha marca favorito; la pulsación larga abre el menú (Ver canal · favoritos · Renombrar · Abrir en… · Borrar). Tocar un canal abre el **escenario del canal** (nombre · categoría, otras señales del mismo canal, otros canales de la lista). | [ ] |
| 15.17 | Buscar: pega un enlace `acestream://…` o un Content ID de 40 caracteres. | Sale «Enlace detectado» con «Reproducir»: se abre el escenario como canal «Enlace pegado» y **no** entra en recientes. | [ ] |

## Cuando algo falla

- Anota el paso, la hora y la red. En la web: Salud → Registro de fallos
  (fallos de reproducción que manda la app, con tiempo hasta la imagen,
  reconexiones y retraso) y Ajustes → Dispositivos (último acceso del iPhone).
- Si es de firma (la app no abre, no suena en segundo plano, no hay PiP):
  repasa «Qué comprobar al firmar» en `docs/ios.md`.
- Si es de red (no empareja, no carga): prueba el nombre `.local` / `.ts.net`
  en vez de la IP (paso 2.7) y mira `docs/acceso-remoto.md`.
