# Fuente · Historia funcional, comportamientos a preservar, quejas y vocabulario

> Material de trabajo para el inventario. Extraído el 24-sep-2026 de `CHANGELOG.md`,
> `docs/comportamientos.md`, `docs/decisiones.md`, `docs/compat.md`, `docs/diseno/*`,
> `docs/analisis/*`, `docs/pruebas-iphone.md`, `docs/PROGRESO.md`, `docs/dudas.md`,
> `docs/ideas-futuras.md`, `docs/verificacion-web.md`, `docs/accesibilidad.md`,
> `docs/PARADAS.md`, `docs/RESUMEN-MAÑANA.md`, `docs/INFORME.md`. Rutas relativas a
> `umbrel-app-store/`. Las capturas de `docs/capturas/` son anteriores a la 0.7.1.

## 1. Historia funcional (lo que existe hoy)

### Agenda
- 0.6.9 agenda personalizada (primer uso: ligas, equipos, nacionalidades); vincular a mano un Content ID.
- 0.6.14 horas en hora de Madrid («horario peninsular»); competición real por partido.
- 0.6.17 fuente principal futbolenlatv (14 días); flechas en la tira de días; competiciones filtran, equipos resaltan.
- 0.6.18 cada partido avisa de si está en directo o cuánto falta.
- 0.6.25 marcadores en vivo (ESPN, cada 8 s con algo en juego, 45 s si no). El partido que ves sale **tapado** con «Ver marcador».
- 0.6.29 canal a secas («DAZN») → se ofrece toda su familia numerada.
- 0.6.57 la tira de días no se recentra sola.
- 0.6.58 primer uso: agenda completa + tarjeta «Personaliza tu agenda» (sin modal bloqueante).
- 0.7.0 web nueva (Agenda, Biblioteca, Buscar, Ajustes; barra inferior en móvil); tiempo real por SSE.
- 0.7.1 «Para ti» en iPhone; desaparecen las «franjas en blanco» de la tira de días.

### Gustos / «Para ti»
- Unión de liga + equipo + selección/país. Alias exactos (Barcelona/FC Barcelona/Barça, sin Barcelona SC ni filiales). LaLiga ≠ Hypermotion.
- Sin gustos se fuerza «Todos». Los equipos resaltan **sin reordenar** (B-144).

### Centro de partido
- 0.6.41 estrena el centro de partido: precalienta fuentes cerca del inicio; reportar señal caída o canal incorrecto; aprende.
- 0.6.46 **Rebuscar** (favoritos → M3U → índice AceStream) sin detener la señal.
- 0.6.47 **Pegar hash** durante la reproducción (Content ID, `acestream://` o URL); no se vincula ni se guarda.
- 0.6.58 saltar a un canal de la biblioteca cierra el centro de partido.
- 0.7.0 «Abrir en…» (app AceStream o VLC).

### Fuentes y failover (política única v2)
- Orden: nivel de marca (concreto antes que genérico) → procedencia estricta (vínculo guardado, M3U, favoritos, historial, buscador) → nombre (≥92 exacto, ≥70 recomendado) → fiabilidad aprendida → disponibilidad → puntuación. Reparto entre proveedores en los primeros puestos.
- Comprobador en segundo plano («segundo motor»): 3 primeras fuentes al instante; el progreso dice cuántas se han comprobado.
- **Verificada**: entrega vídeo H.264 reproducible (≥128 KiB). **Floja**: entrada < 85 % del bitrate, intermitente, verificada que falla una prueba, o vista ≥60 s y cortada. **Sin señal**: HEVC en web, sin vídeo o 0 bytes.
- Lo que ve el reproductor manda 3 min sobre el comprobador; la que se conecta sale como «comprobando».
- Entrada al partido: espera y arranca la primera verificada; si ninguna, la primera floja; si quedan reintentos: «Las vuelvo a probar a las HH:MM y arranco la primera que responda».
- Caída: hasta 3 reconexiones (1, 2, 4 s); agotadas → siguiente verificada. **Elegir a mano apaga el automatismo.**
- Reportar aparta la fuente (30 min; 10 min si corte/calidad/audio; 30 días si canal incorrecto).
- Desde la biblioteca nunca hay salto automático; solo «hermanas» (≥92).

### Reproductor y mini
- Modos Estable / Equilibrado (defecto) / Baja latencia.
- Línea de estado bajo el vídeo (un mensaje, 4,5 s). Toasts: 2 máx., 2,8 s, nunca sobre el vídeo, `×n`, «Deshacer».
- «Directo» con tres estados: «Directo» relleno · «Ir al directo · −34 s» · «Reanudar». En directo si ≤1,25 s por detrás.
- −30 s (J), Detener, pantalla completa, PiP. Controles se ocultan a los 3,2 s si suena. Clic espera 190 ms; doble clic = pantalla completa.
- Zapping ← → solo mientras ves algo; lista = favoritos + directorio activo.
- 0.7.0 el reproductor no se pierde al navegar: grande en el partido, mini en la agenda. «Directo de verdad»: dice el retraso y salta al borde.
- 0.7.1 iPhone: deslizar arriba sobre el mini abre; abajo minimiza. «Dónde se está reproduciendo» también desde el reproductor.
- Marcador del partido que ves: **tapado** («Tu emisión va por detrás del directo»); se destapa con un toque hasta cambiar de canal.

### Biblioteca y búsqueda
- Favoritos (60), Recientes (60), Listas (directorio activo agrupado por categoría). «Emitiendo ahora»: tus canales que dan un partido.
- Abre en la pestaña con contenido; cada vacío lleva un botón que lo resuelve; borrar se deshace en 6 s.
- Buscar contra el motor (2–80 caracteres, 100 resultados, con «disponibilidad»). Pegar un Content ID lo reproduce como fuente externa.

### Directorios (Listas)
- Hasta 8 listas M3U/HTML/IPFS de ≤500 canales, una «En uso»; se actualizan cada 3 h; la tarjeta dice por qué falló la última actualización; direcciones locales bloqueadas.

### Dispositivos, mando, «Dónde se está reproduciendo»
- Mismo canal en dos pantallas: se comparte (HLS). Canal distinto: «el último que da al play se queda el mando», el otro se para con aviso. Ajuste **«Un solo dispositivo a la vez»**.
- Emparejar iPhone: Ajustes › Dispositivos › código de 6 dígitos o QR (5 min, un uso). Revocar pide dos toques.
- 0.7.1 «Dónde se está reproduciendo»: qué canal suena y en qué dispositivos; «Ver aquí» te une a esa sesión.

### Salud y diagnóstico
- Panel de salud: motor, comprobador, IA, agenda, directorios. Registro de fallos por causa. Reiniciar el motor pide segundo toque (6 s). El motor se reinicia solo (3/h).

### App iOS
- 0.7.0 nativa: emparejamiento, Tailscale, PiP, AirPlay, pantalla de bloqueo, HEVC. 0.7.1: Para ti, listas agrupadas, gestos arriba/abajo, PiP doble arreglado.

## 2. Diseño actual y su historia
- Estilos previos: violeta (0.5) → «sala de cine» cian (0.6.4) → «terminal» monoespaciada con acento rojo (0.6.18) → casi negro + ámbar (0.6.59).
- Fase 1 de la v2: tres opciones A «Luz de focos» (cristal, azul abismo #081829 + cielo #5fd9ff, Mona Sans + Martian Mono), B «Rótulo» (pizarra/papel, TV, Archivo + Azeret Mono), C «Grada» (tifo, fucsia, Anybody). Elegida A con injertos (23-sep-2026).
- Punto flojo reconocido de A: **personalidad 7/10, «azul oscuro con acento frío es la familia de color más vista en las apps de marcadores»**. Riesgo abierto: «que se quede en otra app azul».
- Lo descartado: teselas de día grandes, cuadrados de dos letras, marcador cuatro veces, vídeo pequeño en escritorio, fuentes en carrusel, título gigante en cada pantalla, tercera familia tipográfica, fucsia.

## 3. Quejas literales y pendientes de UX
- Isma (PROGRESO.md, 23-sep 19:40): «bandas en blanco (tira de días y selector de Biblioteca en iOS 26.6 real), agenda sin "Para ti", listas sin agrupar, no se puede volver del mini-reproductor, PiP doble al volver a la app; pide gestos (arriba abre el vídeo, abajo lo cierra) y un apartado "Dónde se está reproduciendo". **"La web está mejor hecha para el móvil que la propia app"**».
- pruebas-iphone.md §14: todo sin verificar en iPhone real (bandas, volver del mini, PiP, pantalla de bloqueo, AirPlay, rotación).
- INFORME/RESUMEN: LCP 2,7 s en 4G lento por Mona Sans (98 KB de 250 KB). Sin probar «dos canales distintos a la vez».
- verificacion-web.md: jerga («búfer» → «colchón»); rótulos duplicados («Abrir en la app AceStream» / «de AceStream»).
- accesibilidad.md: recortes «…» aceptados (URL de lista, «A las 22:00, España – Marruecos» en 360–430 px, subtítulo de fuente sobre el vídeo, mensajes largos de la línea de estado).
- Contradicción viva: la tarjeta de primer uso promete «la agenda pondrá primero lo tuyo» pero la app **filtra y resalta, no reordena**.
- En capturas iOS 0.7.0: marcador «1 – 0» destapado mientras se reproduce (rompe la regla anti-spoiler); países en inglés («Spain», «Europe»).
- En web escritorio: nombres cortados («Real Socie…»); «Estado del motor dl» sin traducir; 4 columnas y dos rejillas de botones (Favorito, Rebuscar, Pegar hash, Copiar hash, Es el canal correcto, Reportar, Abrir en…).
- En web móvil: con la tarjeta de primer uso solo cabe 1,5 partidos sobre el pliegue; «Para ti 0» desactivado a la vista.
- «Pegar hash» perdió presencia (solo en Biblioteca y dentro del partido).

## 4. Vocabulario del producto (resumen)
Canal · Señal/fuente («Fuente n») · Proveedor (Elcano, Nueva Era) · Operador (M+) · Marca paraguas (DAZN) · Familia/hermanas · Dial · Coletilla de calidad (HD, FHD, 1080p) · **Verificada** (verde) · **Floja** (ámbar) · **Sin señal** (rojo) · **Comprobando** · Pendiente · Reportada/apartada · Comprobador (segundo motor) · Motor · Precalentar · Rebuscar · «Es el canal correcto» · Vínculo · Content ID · Infohash · Pegar hash · Directorio/Lista («En uso») · Biblioteca (Favoritos, Recientes, Listas, «Emitiendo ahora») · Dorsal · Buscar en el motor · Disponibilidad · Agenda (14 días) · Para ti / Todos · Gustos («¿Qué fútbol te mueve?») · Tu equipo · Centro de partido · Escenario / Luego · Dónde se emite · Ver canal / Buscar canal / Encontrar canal · Marcador tapado / Ver marcador · Directo / Ir al directo / Reanudar · Colchón · Modos · Línea de estado · Aviso · Emitiendo / En pantalla / Sonando · Mini-reproductor · Zapping · Datos técnicos (panel nerd, S) · Pares · **Mando** · Traspaso · Un solo dispositivo a la vez · Emparejar / Dispositivos / Revocar · Dónde se está reproduciendo / Ver aquí / Este dispositivo · Salud / Registro de fallos · Abrir en… · Remux («Adaptando el canal para este dispositivo…») · Demo.
