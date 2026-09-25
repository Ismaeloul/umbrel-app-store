# Centro de partido (teatro Palco) y selector de fuentes

`?vista=partido/<id>` y `partido/canal/<hash>` (la ruta está en `../partido/`,
que solo reexporta). Inventario §5, §6 y §7 enteros y las reglas 19-26 y 29-30
de §26. Capturas y revisión de 11 tamaños en `docs/capturas/fase2/partido/`.

| Fichero | Qué |
|---|---|
| `match-center/index.tsx` | El TEATRO (Palco W5): busca el partido en la agenda, entra (resolver, comprobar, arrancar), proyecta la cápsula del marcador sobre el vídeo (`player/stage-slot.ts`), la cabecera y, sin panel lateral, las pestañas debajo. Monta las hojas UNA vez |
| `match-center/Scoreboard.tsx` | Cápsula del marcador sobre el vídeo (tapada por defecto, regla 29; cifras que giran, B5; rebote del gol, W14) y el marcador grande de la pestaña «Partido» |
| `match-center/MatchHead.tsx` | Cabecera bajo el vídeo: competición y estado, los dos escudos con los nombres (elemento compartido con la tarjeta de la agenda) y el h1 oculto con el título |
| `match-center/TheaterTabs.tsx` | Panel con pestañas Fuentes · Partido · Datos técnicos (o Fuentes · Canal · Datos técnicos): paneles montados con `hidden`, pestaña recordada en la sesión y unida a la tecla S |
| `match-center/MatchPanel.tsx` | Pestaña «Partido»: escudos grandes sobre la luz de los clubes, marcador grande (si está destapado), barra del partido, competición y «Dónde se emite» |
| `match-center/WhereAired.tsx` | Todos los canales (B3: continuo si está en tu biblioteca, discontinuo si se buscará) y la chuleta de atajos (solo con ratón) |
| `match-center/ChannelCenter.tsx` | Canal suelto: cabecera con la tesela del canal, hermanas del mismo canal (regla 23), su ficha y sus acciones |
| `match-center/MatchAside.tsx` | Panel lateral de escritorio (`../partido/aside.tsx`): las mismas pestañas, con «Plegar el panel lateral» |
| `match-center/NerdSection.tsx` | «Datos técnicos» (`PlayerNerdStats` del reproductor) en su pestaña |
| `match-center/find.ts` | `findMatch` (la vista y el panel lateral se cargan por separado) |
| `sources/session.ts` | **El controlador**, fuera de React: resolución, comprobador (SSE + respaldo), arranque automático, política de cambio de fuente, reportes, Rebuscar, vínculos |
| `sources/model.ts` | Reglas puras (estado efectivo, qué se ve, qué arranca, frases, progreso, hermanas, calidad del cartel) |
| `sources/SourcesPanel.tsx`, `SourceList.tsx`, `SourcePoster.tsx`, `SourceInspector.tsx` | Selector con CARTELES de fuente (Palco W6: tesela del canal, número, «En pantalla» que se desliza, anillo de estado con palabra, calidad y proveedor; nunca miniaturas de vídeo), barra «Emitiendo» que se desliza, inspector con «Abrir en…» |
| `sources/ResolverSheet.tsx`, `ReportSheet.tsx` | «Encontrar canal» y «Reportar fuente» |
| `sources/demo.ts` + `demo-data.ts` | Resolución y comprobador de muestra (un paso cada 1,35 s) |

## Política única de cambio de fuente (P16)

1. **Entrar al partido** = automático. Con comprobador, se espera a la primera
   verificada (en el orden del servidor) y se arranca con `origin: 'auto'`
   (1 reconexión antes de la primera imagen). Terminado el comprobador sin
   verificadas, la primera floja. En reposo (`waiting`), se dice a qué hora
   reintenta y se sigue esperando. Sin comprobador, la mejor colocada.
2. **Mientras sea automático** (nadie ha elegido nada), si la fuente agota sus
   reconexiones, se pasa a la siguiente verificada que no se haya probado.
3. **En cuanto eliges una fuente, pegas un hash o eliges en «Encontrar
   canal»**, todo es manual: nunca se salta sola; el reproductor dice cuántas
   quedan. Única excepción heredada: el salto de entrada tras «Encontrar
   canal» si el comprobador da la elegida por fallida antes de verse.
4. **Canal de la biblioteca**: nunca salta sola (reproductor.md §4.4).
5. **Detener o el traspaso** apagan todo lo automático; la lista se queda.

## Decisiones (modo autónomo, criterio conservador)

- **El controlador vive fuera de React** (`session.ts`): con el reproductor en
  «mini» la vista está oculta (Activity) y sus efectos parados, pero el
  cambio de fuente tiene que seguir funcionando.
- **Salir del partido antes de que suene nada** apaga el automatismo (no se
  arranca un vídeo con la persona en otra pantalla). Volver lo relanza como
  una entrada nueva. Volver mientras suena no vuelve a resolver.
- **Comprobador**: con el SSE abierto no se sondea nada; cada `scan.progress`
  de ESE trabajo pide `/api/v1/football/scans/:id` y `scan.verdict` cambia la
  fuente al momento. Sin SSE (no conectó en 10 s, o demo), cada 1,5 s.
- **El comprobador se cae** (3 fallos): además del aviso, si nada suena se
  reproduce la mejor colocada (la 0.6.59 se quedaba esperando para siempre).
- **Regla 22 sin perder nada**: las caídas y las que esperan en cola no ocupan
  sitio, pero quedan plegadas al final («Ver 3 más (1 sin señal, 2 en
  cola)»). Los números no cambian al plegar.
- **Rebuscar sin nada sonando** y sin haber elegido nada vuelve a armar el
  arranque automático (sigue siendo la entrada al partido).
- **Reportar** no cambia de fuente (como la 0.6.59), pero el aviso ofrece
  «Ver la n» si hay otra viva.
- **Pegar hash en un partido** lo añade como fuente manual del partido; en un
  canal suelto se abre como canal propio (contradicción 11: no hereda el
  nombre del que sonaba).
- **Canal sin hermanas**: sin selector (§7.1), pero con sus acciones
  (favorito, copiar, reportar, «Abrir en…»), que en la 0.6.59 desaparecían.
- `client` de la resolución = el visor de la pestaña (`getViewerId()`): dos
  pestañas no se cancelan el comprobador la una a la otra.
- **Marcador**: tapado también antes de que arranque el vídeo (estás a punto
  de verlo); el ojo tachado lo vuelve a tapar. Sin goleadores: ninguna API
  que usemos los da.
- «Es el canal correcto» manda el canal del partido con el que casó la
  fuente (la 0.6.59 mandaba siempre el primero).
- Atajos nuevos: **N** (siguiente fuente) y **1-9** (la fuente n).

## Pendiente (de otros)

- Reproductor: `PlayOptions.record: false` para no apuntar en Recientes un
  hash pegado (§7.5); un tono «sin señal» para `setWaitingMessage` (hoy el
  mensaje final va en la vista y en la línea de estado). La luz ambiental ya
  no ensancha la página (a los lados nunca pasa del margen de la vista).
