# Agenda (`?vista=agenda`) y columna compacta

Inventario §3, §4 y §5.1 (hasta abrir el partido). Capturas y revisión de 11
tamaños en `docs/capturas/fase2/agenda/`.

| Fichero                    | Qué                                                                                                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.tsx`                | La portada (piel Palco, W4): cabecera, héroe (solo móvil y tableta), tira de días, «Para ti»/«Todos», tarjeta de primer uso, filas por competición y, desde 1024 px, panel del partido elegido + «Luego» (desde 1280, «En directo» con marcador, B1). Nunca reproduce ni enseña vídeo |
| `Hero.tsx`                 | Héroe del móvil y la tableta: el `featuredMatch` como tarjeta versus XL (sin marcador), «Ver ahora»/«Ver el partido»/«Buscar canal»/«Volver al vídeo» (navega al partido), cápsula «Marcador» y dónde se emite. En escritorio no hay héroe (0.9.0) |
| `cards.ts`                 | Funciones puras de las tarjetas versus: lados (`versusSide`), chip de cuándo (`versusWhen`), palabra y tono de la señal y `matchGlow(match)` (luz de los dos clubes con la paleta de la API)                                                         |
| `column.tsx`               | Columna compacta junto al reproductor (centro de partido ≥ 1280), en tarjetas versus pequeñas. Comparte día y filtro con la vista (`state.ts`)                                                                                                       |
| `domain.ts`                | Reglas puras: reloj de Madrid, insignias, días, grupos, marcadores (ventana 15 min/3,5 h, 8 s/45 s), señal por partido, «Ver canal»/«Buscar canal». Lo de «Para ti» y el emparejado de canales se importa de `@ace/shared`                           |
| `data.ts`                  | Consultas (agenda, marcadores, precalentado), reloj de 20 s y la señal que llega por SSE (`scan.progress` con `matchId`)                                                                                                                             |
| `MatchRow.tsx`             | Tarjeta de partido (versus `md`, o `sm` compacta): cápsula de señal arriba, marcador o tapado abajo a la derecha, canales debajo. `FlipNum`, `CensorBars` y `teamGlow` los usan también el panel y el centro de partido                              |
| `AgendaList.tsx`           | Filas horizontales por competición (`PosterRail`, sin virtualizar) y la pila de la columna compacta                                                                                                                                                  |
| `DayStrip.tsx`             | Tira de días (pastillas Palco; teselas en escritorio) que no se recoloca al repintar                                                                                                                                                                 |
| `Stage.tsx`                | Panel del partido elegido en escritorio y `LiveStrip` (B1: «RSO 1–0 VIL · 33'», tapado solo el que estás viendo)                                                                                                                                     |
| `day-swipe.ts`             | Deslizar entre días en el móvil (`useDaySwipe`): Touch Events pasivos; una fila de tarjetas solo se queda el gesto si aún puede desplazarse hacia ese lado                                                                                         |
| `score-reveal.ts`          | Marcador TAPADO del partido que suena (regla 29): `useScoreHidden(id)`, `revealScore(id)`, `resetScoreReveal()`                                                                                                                                      |
| `demo.ts` / `demo-data.ts` | Agenda, marcadores y precalentado del modo demo (los datos solo se descargan en demo)                                                                                                                                                                |

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
  escenario y el centro de partido los pintan **todos** (regla 30).
- **Orden:** bloques por competición y, dentro, directo → próximos → terminados,
  cada tramo por hora (opción A). «Tu equipo» resalta y nunca reordena dentro
  del bloque (regla 27). En «Todos» con gustos, los bloques con algo tuyo van
  primero y los de cantera, filiales o femenino al final (D23); el escenario no
  destaca un partido de cantera si hay otro.
- **Reloj único de Madrid** también para «Hoy»/«Mañana» (contradicción 13).
- **Refresco:** sin sondeo de la agenda (§3.1); caduca a los 10 min y se vuelve a
  pedir al volver a la pestaña. Los marcadores sí se consultan (8 s / 45 s y solo
  con partidos en su ventana): no hay evento SSE de marcadores.
- **Escritorio sin héroe (0.9.0):** toda la página es el calendario; el
  destacado sale de entrada en el panel de la derecha y su tarjeta, elegida.
- **«Tu equipo» (0.9.0):** aura VERDE alrededor de la tarjeta (por fuera) en
  la lista y en «Luego»; solo equipos, no ligas. Oro no: se confundía con el
  aro oro (por dentro) de la tarjeta elegida.
- **Deslizar entre días (móvil):** también sobre las filas cuando no tienen
  más que enseñar hacia ese lado; el scroll vertical siempre gana.
- **Flechas ‹ › de la tira**, solo con ratón (en táctil se desliza la tira).
  La tira no va pegada arriba; al cambiar de día con la lista bajada, la página
  vuelve a ella.
- **Móvil en horizontal:** titular bajo, sin frase, y días y filtro en una línea.
- **Accesibilidad:** una frase `role="status"` resume día, partidos y directos
  (regla 36) en vez de hacer `aria-live` la lista entera.
