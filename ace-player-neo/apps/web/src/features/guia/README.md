Guía TV de la IPTV (docs/iptv.md §20; investigación en
docs/investigacion/guia-tv.md). Vista `?vista=guia` (`&ambito=favoritos|todos`
y, en escritorio, `&tipo=deportes|cine|noticias`). Se ve sin servidor con
`?demo=1&vista=guia`; `&guia=hoy` la deja como la guía real del panel de Isma
(solo hoy) y `&guia=grande`, con 4 391 canales.

| Fichero          | Qué                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `index.tsx`      | La vista: cabecera, estados (sin IPTV, preparando, sin guía, fallo), días y chips (escritorio) o «Ahora» (móvil)      |
| `Board.tsx`      | La parrilla: filas virtuales, tramos de la franja visible, regla, raya de «ahora», teclado y teclear el número        |
| `Detail.tsx`     | El popover del programa (escritorio: «Te aviso», «Ver ficha») y la hoja «Más info» (en el móvil, al tocar)           |
| `agenda-link.ts` | ¿Este programa es un partido de la Agenda? (para «Ver ficha»)                                                         |
| `data.ts`        | Canales por páginas de 200 (con `type`) y programas por teselas de 6 h × 30 filas; 409 `guide_stale` → vuelve a pedir |
| `model.ts`       | Lógica pura: medidas, línea de tiempo y días con datos (`coveredTo`), teselas, tramos, «Sin información», textos     |
| `demo.ts`        | Registra `iptvGuide*` del modo demo con la guía de ejemplo de @ace/shared                                            |

Decisiones:

- **Escritorio (desde 768, rediseño `01-escritorio.html` §2):** barra «Guía»
  con buscador y la campana de avisos (features/avisos); debajo, los días
  (Ayer, Hoy, Dom 1…) y los chips Favoritos, Todos, Deportes, Cine y Noticias.
  El tipo lo filtra el servidor (`type` en `iptvGuide`, los tipos de la faceta
  de Canales). Parrilla a lo ancho, 156 px por media hora (~3 h a 1280), raya
  amarilla, directos de verdad (marca de la guía) en rojo, lo pasado apagado.
  Pulsar un programa (o Intro) abre un popover; si «ahora» queda fuera, sale
  «‹ Ahora 19:42» abajo con un brillo en el borde. El móvil no cambia.
- **«Te aviso»:** guarda el programa en este navegador (features/avisos) y
  pide permiso de notificaciones al pulsarlo. El aviso sale 5 min antes:
  notificación si hay permiso; si no, un toast con la app abierta.
- **«Ver ficha»:** solo si el título es un enfrentamiento cuyos dos equipos
  casan con un partido de la Agenda a menos de 3 h.
- **Días con `coveredTo`:** un chip de día solo sale si la guía llega al menos
  6 h dentro de él. Con la guía de Isma (solo hoy) no hay chips en el móvil:
  «Hoy · fecha · tu proveedor solo da la guía de hoy», y la parrilla acaba en
  «Fin de la guía disponible». «Ayer» solo en escritorio y solo si la guía
  guardada lo cubre (no hay catch-up: «Ver» pone el canal en directo).
- **El título visible desde el borde** (como el deco): la parrilla pone `--sl`
  (su scroll) al desplazarse y cada bloque desplaza su título con CSS; React
  solo repinta cada 48 px.
- **«Ver»** abre el canal IPTV como un canal tocado en Canales (`playChannel`
  con el id IPTV). Con un programa futuro o pasado dice «Ver el canal».
- **Logos:** `iptvGuideArt` si el proveedor los da; si no o si fallan,
  `ChannelMark`. En la demo, siempre `ChannelMark`.
