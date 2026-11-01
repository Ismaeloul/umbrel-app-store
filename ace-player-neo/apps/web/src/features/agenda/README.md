# Agenda (`?vista=agenda`) y columna compacta

Inventario §3, §4 y §5.1 (hasta abrir el partido). Capturas y revisión de 11
tamaños en `docs/capturas/fase2/agenda/`.

| Fichero                    | Qué                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.tsx`                | La portada (piel Palco, W4): en el móvil, cabecera, héroe, tira de días, «Para ti»/«Todos», tarjeta de primer uso y filas por competición. Desde 768 px (salvo el móvil en horizontal), al estilo SofaScore: la lista (`DeskList`) y a la derecha el detalle del partido ELEGIDO (`Detail.tsx`); al entrar, ninguno. Nunca reproduce ni enseña vídeo                                             |
| `Hero.tsx`                 | Héroe del móvil: el `featuredMatch` como tarjeta versus XL (sin marcador), «Ver ahora»/«Ver el partido»/«Buscar canal»/«Volver al vídeo» (navega al partido), cápsula «Marcador» y dónde se emite. En escritorio no hay héroe ni destacado                                                                                                                                                       |
| `cards.ts`                 | Funciones puras de las tarjetas versus: lados (`versusSide`), chip de cuándo (`versusWhen`), palabra y tono de la señal y `matchGlow(match)` (luz de los dos clubes con la paleta de la API)                                                                                                                                                                                                     |
| `column.tsx`               | Columna junto al vídeo del partido (desde 1024 px): la misma `DeskList` que la Agenda de escritorio, con el partido abierto resaltado; ahí un clic abre el partido                                                                                                                                                                                                                               |
| `DeskList.tsx`             | Lista de escritorio al estilo SofaScore: pestañas «Todo»/«Para ti», el día en una píldora (‹ Hoy ›, con la lista de días), píldoras «En directo (N)»/«Terminados»/«Próximos» y las ligas, grupos por competición (logo, país, contador, plegar) y filas (hora y estado, equipos, canal, resultado o señal). La comparten la vista y la columna                                                   |
| `domain.ts`                | Reglas puras: reloj de Madrid, insignias, días, grupos, marcadores (ventana 15 min/3,5 h, 8 s/45 s), señal por partido, «Ver canal»/«Buscar canal». Lo de «Para ti» y el emparejado de canales se importa de `@ace/shared`                                                                                                                                                                       |
| `data.ts`                  | Consultas (agenda, marcadores, precalentado), reloj de 20 s y la señal que llega por SSE (`scan.progress` con `matchId`)                                                                                                                                                                                                                                                                         |
| `MatchRow.tsx`             | Tarjeta de partido (versus `md`, o `sm` compacta): cápsula de señal arriba, marcador o tapado abajo a la derecha, canales debajo. `FlipNum`, `CensorBars` y `teamGlow` los usan también el panel y el centro de partido                                                                                                                                                                          |
| `AgendaList.tsx`           | Filas horizontales por competición (`PosterRail`, sin virtualizar) y la pila de la columna compacta                                                                                                                                                                                                                                                                                              |
| `DayStrip.tsx`             | Tira de días (pastillas Palco; teselas en escritorio) que no se recoloca al repintar                                                                                                                                                                                                                                                                                                             |
| `Detail.tsx`               | Detalle del partido elegido en escritorio (sin apuestas ni estadísticas): migas «País › Competición», X, escudos grandes, hora o minuto y el resultado a la vista (tapado solo el del partido que ves o uno tapado a mano), «Ver partido» (atajo O) y «Ver juntos», y «Dónde se ve» (señal del comprobador y canales en filas). `AgendaDetailEmpty`: la invitación a elegir y el resumen del día |
| `day-swipe.ts`             | Deslizar entre días en el móvil (`useDaySwipe`): Touch Events pasivos; una fila de tarjetas solo se queda el gesto si aún puede desplazarse hacia ese lado                                                                                                                                                                                                                                       |
| `score-reveal.ts`          | Marcador TAPADO del partido que suena (regla 29): `useScoreHidden(id)`, `revealScore(id)`, `resetScoreReveal()`; lo tapado a mano en la agenda: `hideScore(id)`, `useScoreCovered(id)`                                                                                                                                                                                                           |
| `demo.ts` / `demo-data.ts` | Agenda, marcadores y precalentado del modo demo (los datos solo se descargan en demo)                                                                                                                                                                                                                                                                                                            |

Para otras vistas:

- **Marcador tapado**: `import { useScoreHidden, revealScore } from '../agenda/score-reveal.ts'`
  (así el «destapado» es el mismo en la agenda, el centro de partido, la
  biblioteca y el mini-reproductor). El reproductor puede llamar a
  `resetScoreReveal()` al cambiar de fuente.
- **Agenda en demo abriendo un partido directamente**: `import '../agenda/demo.ts';`.
- **Hoja de gustos** (Ajustes → «Editar mis gustos»): `../preferences/PreferencesSheet.tsx`;
  el resumen, `preferenceSummary()` de `../preferences/model.ts`.

## Decisiones (modo autónomo, criterio conservador)

- **«Ver canal» / «Buscar canal» abren el centro de partido**, que es quien
  resuelve (`/football/resolve`), espera la fuente verificada y reproduce. Por
  eso la tarjeta no tiene estado «Buscando» propio (§3.4): lo enseña el partido.
- **Rótulos de canal:** la tarjeta pinta 2 y «+n» (en 360 px no caben 8); el
  detalle de escritorio y el centro de partido los pintan **todos** (regla 30).
- **Orden:** bloques por competición y, dentro, directo → próximos → terminados,
  cada tramo por hora (opción A). «Tu equipo» resalta y nunca reordena dentro
  del bloque (regla 27). En «Todos» con gustos, los bloques con algo tuyo van
  primero y los de cantera, filiales o femenino al final (D23); el héroe del móvil no
  destaca un partido de cantera si hay otro.
- **Reloj único de Madrid** también para «Hoy»/«Mañana» (contradicción 13).
- **Refresco:** sin sondeo de la agenda (§3.1); caduca a los 10 min y se vuelve a
  pedir al volver a la pestaña. Los marcadores sí se consultan (8 s / 45 s y solo
  con partidos en su ventana): no hay evento SSE de marcadores.
- **Escritorio al estilo SofaScore (Isma, 1-11-2026):** desde 768 px (salvo
  el móvil en horizontal) la lista y, a la derecha, el detalle. Al entrar NO
  hay nada abierto (ni destacado): un clic en una fila elige el partido y
  enseña dónde se ve; doble clic, Intro, la O o «Ver partido» abren el centro
  de partido; la X cierra el detalle. Solo visual: el comprobador y el
  precalentado no cambian. Los filtros «En directo»/«Terminados»/«Próximos»
  son de presentación (`byPhase`) y el país bajo cada liga sale de su nombre
  (`competitionArea`: el `country` del partido es el del canal).
- **«Tu equipo» (0.9.0):** aura VERDE alrededor de la tarjeta (por fuera) en
  la lista del móvil; en la de escritorio, el nombre en negrita. Solo
  equipos, no ligas.
- **Deslizar entre días (móvil):** también sobre las filas cuando no tienen
  más que enseñar hacia ese lado; el scroll vertical siempre gana. Dedo a la
  izquierda = día siguiente; hacia un lado sin día (Hoy, a la derecha) la
  lista apenas se mueve. Solo anula el gesto un scroll que SIGUE al dedo (no
  el salto de la barra del navegador al final de la página), y el cuerpo de
  la agenda recorta lo que se sale por los lados para que la página nunca se
  ensanche (eso reajustaba la ventana en mitad del gesto).
- **Flechas ‹ › de la tira**, solo con ratón (en táctil se desliza la tira).
  La tira no va pegada arriba; al cambiar de día con la lista bajada, la página
  vuelve a ella.
- **Móvil en horizontal:** titular bajo, sin frase, y días y filtro en una línea.
- **Accesibilidad:** una frase `role="status"` resume día, partidos y directos
  (regla 36) en vez de hacer `aria-live` la lista entera.
