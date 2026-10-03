Guía TV de la IPTV (docs/iptv.md §20; investigación en
docs/investigacion/guia-tv.md). Vista `?vista=guia` (`&ambito=favoritos|todos`).
Se ve sin servidor con `?demo=1&vista=guia`; `&guia=hoy` la deja como la guía
real del panel de Isma (solo hoy) y `&guia=grande`, con 4 391 canales.

| Fichero         | Qué                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `index.tsx`     | La vista: cabecera con «Favoritos \| Todos», estados (sin IPTV, preparando, sin guía, fallo), días, «Ahora», tablero |
| `Board.tsx`     | La parrilla: filas virtuales, tramos de la franja visible, regla, raya de «ahora», teclado y teclear el número       |
| `Detail.tsx`    | La franja del programa elegido (PC) y la hoja «Más info» (en el móvil, al tocar)                                    |
| `data.ts`       | Canales por páginas de 200 y programas por teselas de 6 h × 30 filas; 409 `guide_stale` → vuelve a pedir la guía    |
| `model.ts`      | Lógica pura: medidas, línea de tiempo y días con datos (`coveredTo`), teselas, tramos, «Sin información», textos    |
| `demo.ts`       | Registra `iptvGuide*` del modo demo con la guía de ejemplo de @ace/shared                                           |

Decisiones:

- **Dónde va:** hija de Canales, no un 6.º destino (la barra ya tiene 5 con
  «Pelis y series» y a 360 px no cabe otro). Se entra con el botón «Guía TV»
  de la cabecera de Canales (solo con IPTV activa); dentro, se ilumina Canales.
- **Días con `coveredTo`:** un chip de día solo sale si la guía llega al menos
  6 h dentro de él. Con la guía de Isma (solo hoy) no hay chips: «Hoy · fecha ·
  tu proveedor solo da la guía de hoy», y la parrilla acaba en «Fin de la guía
  disponible». No se enseña ayer: no hay catch-up.
- **El título visible desde el borde** (como el deco): la parrilla pone `--sl`
  (su scroll) al desplazarse y cada bloque desplaza su título con CSS; React
  solo repinta cada 48 px.
- **«Ver»** abre el canal IPTV como un canal tocado en Canales (`playChannel`
  con el id IPTV). Con un programa futuro o pasado dice «Ver el canal».
- **Logos:** `iptvGuideArt` si el proveedor los da; si no o si fallan,
  `ChannelMark`. En la demo, siempre `ChannelMark`.
