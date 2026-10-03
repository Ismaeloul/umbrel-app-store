# Buscador de canales IPTV con nombres raros (0.9.0, equipo buscador-iptv)

> Lo que pidió Isma (docs/pendiente.md, «Para la 0.9.0», punto 6): «Mejorar más la búsqueda de canales IPTV:
> los nombres reales son raros (ES 4K LA 1, ES: LA 1 4K, |ES| LA 1 FHD...) y buscar la 1 debe dar La 1 la
> primera». El punto 7 (lo mismo en Pelis y series) es de la segunda tanda: este módulo ya está listo para
> eso (§7).

## 1. En pocas palabras

- Hay **un solo buscador por nombre** para todo: el módulo puro `@ace/shared` →
  `packages/shared/src/domain/name-search.ts`. Lo usan Buscar (`iptv/search.ts`), la pestaña IPTV de
  Canales (`iptv/browse.ts`, que antes ordenaba a su manera), el orden de lo que trae el motor
  (`searchRelevance`), la demo de la web y el resaltado de las filas.
- **«la 1» da La 1 la primera**, y detrás La 1 Canarias y La 1 Catalunya. «La 10» y «La 100» no salen (un
  número solo casa entero). «LaLiga TV 1», «LALIGA+ PPV 1» o «LA LIGA 1» salen después, como flojos.
- Los nombres del panel se limpian igual escriba como escriba el país, la calidad o los adornos: «ES 4K LA
  1», «ES: LA 1 4K», «|ES| LA 1 FHD», «ES► LA 1», «◉ ES: LA 1», «ES ★ LA 1 ★», «LA 1 #2», «LA 1 TVE»… son
  **una sola fila** con sus calidades.
- Se entiende lo que escribe una persona: «la uno», «tele 5», «a3», «m+ laliga», «#0» o «cero», «tdp»,
  «champions», «uk: laliga tv» (el país pedido primero), «es: la 1 4k» pegado tal cual.
- Lo que casa **se resalta** en el nombre de la fila (un rotulador dorado y subrayado), en la pestaña IPTV,
  en el filtro de Canales y en Buscar.
- Tus **favoritos** IPTV desempatan delante (nunca delante de lo igual).

## 2. Qué fallaba (medido con el corpus, antes de cambiar nada)

Con un corpus de ~1 500 nombres con la forma de las listas españolas e internacionales (§6), el servidor de la
0.8.4 daba:

| Consulta | Buscar (antes) | Pestaña IPTV (antes) |
|---|---|---|
| la 1 | LA 1, LA 1 TVE, LA 1 CANARIAS, LA 1 CATALUNYA, LA 1 CATALUNYA 2, ES: LA 1, LALIGA TV 1… | LA 1, LA 1 CATALUNYA, LA 1 CATALUNYA 2, LA 1 CANARIAS, **LA 10**, LA 1 TVE, **LA 100 RADIO**, ES: LA 1 |
| la1 | LA 1, **LA 10**, ES: LA 1, ES LA 10 (2)… | igual de mal |
| la uno, cero, tdp | nada | nada |
| tele 5 | TELE 5, TELE5, TELE 5 (DE) — **sin Telecinco** | igual |
| a3 (pestaña) | — | A3, A3 SERIES, ANTENA 3, ES ANTENA 3 (2), ANTENA3…, **MUSICA 32** |
| champions (pestaña) | — | nada |
| tv3 | TV3, TV3 2, TV3 CAT, ES TV3, **M+ LALIGA TV 3** antes que los TV3 de fuera | — |

Las causas:

1. **Limpieza** (`names.ts`): el país separado por un símbolo que no estaba en la lista (►, ✪, ★, «) o con un
   adorno delante (◉) se quedaba en el nombre («ES LA 1»: otra fila, que se ordenaba detrás de La 10); «#2»
   se leía como el número del canal («LA 1 CATALUNYA 2»); «LA 1 TVE», «TELE5», «ANTENA3» y «A3» eran filas
   aparte.
2. **Pestaña IPTV**: un orden propio, más sencillo que el de Buscar: un número casaba por el principio («1»
   con «10»), «la 1» era «empieza por» de «la 10», lo pegado casaba dentro de cualquier cosa («a3» dentro
   de «musica32») y no tenía los alias.
3. **Las dos**: sin números con letra («la uno», «RAI UNO»), sin «tele 5» = Telecinco, y España delante «en
   cualquier nivel» ponía una coincidencia floja de aquí («M+ LaLiga TV 3» para «tv3») delante de la igual
   de fuera.

## 3. El módulo común (`name-search.ts`, puro)

### 3.1 Las palabras de un nombre (`nameSearchWords`)

Sirve igual para un nombre limpio («La 1»), uno tal cual lo da el panel («ES► LA 1 FHD ⁺») o lo que escribe una
persona:

1. Plegado: superíndices de calidad leídos (ᴴᴰ → hd) y los demás fuera, NFKC, sin tildes, minúsculas.
2. Fuera lo que va tras la flecha de AceStream («--> ELCANO»).
3. **País delante en cualquier forma**: 2 letras (menos «tv», «la», «el»…), 3 de una tabla (esp, usa, ger,
   lat… y adornos: vip, ppv, 4k, tve…), «españa», «spain», «latino», «exyu», seguido de **cualquier
   símbolo**; o «es »/«esp » sueltos. Hasta tres veces («4K | ES: …», «VIP ES: …»).
4. Copias y reservas: «(2)», «[2]», «#2» (nunca «#0», que es un canal), «(BK-1)», backup, reserva…
5. La grafía única de `channelSpelling` (M+/M./Movistar Plus+ → movistar; «la liga» → laliga; LaLiga+ →
   laligaplus; la sexta → lasexta; **tele 5 / tele5 / tele cinco → telecinco**; **antena3 → antena 3**;
   **A3 a secas → Antena 3**; **A3 Series → Atreseries**).
6. «La 1 TVE», «Clan RTVE» → sin la cadena; «TVE 1» → la 1.
7. Trocea en letras y números («3/24» → 3 24, «BARÇA» → barca) y quita lo que no dice qué canal es: calidad,
   códec, fotogramas, resoluciones (1080p, 720p50…), VIP, RAW; también la calidad pegada detrás de un número
   («LA1HD» → la1, «DAZN1FHD» → dazn1). «24 horas» es «24h».
8. **Números con letra** (es, ca, it, en, fr, pt; del 0 al 10) **detrás de otra palabra**: «la uno» = «la 1»,
   «RAI UNO» = «RAI 1», «BBC ONE» = «BBC 1»; una palabra que empieza el nombre se deja («Cuatro» y «Ten» son
   canales). «cero» siempre es 0 (el «#0» de Movistar).

`keySearchWords` hace lo mismo con una clave ya normalizada del catálogo, diez veces más rápido (la prueba del
servidor comprueba que da lo mismo con 20 000 canales).

### 3.2 Lo que se escribe (`parseNameQuery`)

Las mismas palabras, más: el **país pedido** delante en cualquier caja («uk: …», «[de] …», «es-…»: España es
«de casa»), «m»/«mov» delante como Movistar, las palabras de relleno («tv», «canal», «channel») que no hace
falta encontrar, y los **alias** (buscan además otra cosa): Champions/UCL → Liga de Campeones; TVE/RTVE a secas
→ La 1, La 2, Teledeporte, 24h, Clan; A3 → Antena 3; TDP → Teledeporte.

### 3.3 El nivel de parecido (`nameTier`)

| Nivel | Qué | Ejemplo |
|---|---|---|
| 0 igual | las palabras que cuentan son las mismas (o pegado igual) | «la 1» → La 1; «la1» → La 1 |
| 1 familia | igual sin el número del final o sin la marca de delante | «dazn» → DAZN 1; «laliga» → DAZN LaLiga |
| 2 empieza por | lo escrito es el principio del nombre (la última palabra puede ir a medias) | «la 1» → La 1 Catalunya |
| 3 palabras enteras | todas, en orden | «hypermotion» → LaLiga TV Hypermotion |
| 4 en otro orden / por el principio | flojo | «la 1» → LaLiga TV 1 |
| 5 por dentro | flojo (compuestos o 5 letras o más) | «sexta» → laSexta |
| 6 sin la marca | flojo | «m+ vamos» → #VAMOS |
| 7 por la categoría | solo el servidor | «tdt» → los de «EU \| ES \| TDT» |

Reglas que lo hacen funcionar: **un número solo casa entero** («1» no es «10», «la1» no es «la10»; sí es el
principio de «24h» o «3cat»); una palabra que acaba en número no es el principio de otra que sigue con números
(«f1» no es «f10»); por dentro de una palabra solo en compuestos conocidos (laliga, lasexta, telecinco…) o con
5 letras o más.

### 3.4 El orden (`compareNameRank` y, en el servidor, `compareRankedHits`)

1. **Lo flojo (nivel 4 o peor) detrás de todo lo bueno**, sea del país que sea.
2. El **país**: el pedido en la consulta; luego España o sin país; luego América en español; luego el resto.
3. Lo que casa por un **alias** como igual o de la familia («champions» → M+ Liga de Campeones antes que
   «CHAMPIONS TV»).
4. **Lo igual** primero.
5. **Tus favoritos**.
6. El nivel.
7. (Servidor) Lo que resta: bar, PPV, replay, solo reservas, plataformas, eventos con horario; la familia que
   tiene la palabra de relleno escrita («laliga tv» → M+ LaLiga TV); la familia más corta y junta; el número
   del final; **la mejor calidad**; la clave más corta; el orden del proveedor.

`rankByName(items, consulta, describir)` hace todo esto para listas pequeñas (la demo, una página, Pelis y
series): calcula los hechos de cada nombre o usa los que ya traiga (`facts`).

### 3.5 El resaltado (`nameHighlights`)

Los trozos del nombre tal cual se enseña que casan con lo escrito: el principio de cada palabra que empieza por
lo escrito, y las palabras seguidas que pegadas lo forman («laliga» marca «LA LIGA»).

## 4. Servidor

- **Limpieza** (`iptv/names.ts`, `cleanIptvTitle`): el país lo separa cualquier símbolo (no el punto ni la
  coma: «DR. HOUSE» no es un país) y puede llevar adornos delante; «#N» del final es la copia N, como «(N)»;
  «LA 1 TVE» y «TVE 1» son La 1; «#0» se enseña con su «#». Con la grafía común, «TELE5»/«TELE 5» se juntan
  con TELECINCO (el TELE 5 alemán es otra fila: otro país) y «ANTENA3»/«A3» con ANTENA 3.
- **Buscar** (`iptv/search.ts`): el mismo índice de palabras de siempre (ahora con las palabras de
  `keySearchWords` y los nombres que apuntan a la clave en los alias del emparejado: «tvg» encuentra «TV
  GALICIA»), el nivel de `nameTier` y el orden de `compareRankedHits`. Lo de la categoría, la biblioteca y el
  precalentado a trozos, igual.
- **Pestaña IPTV** (`iptv/browse.ts`): los mismos candidatos, niveles y orden que Buscar. Decide QUÉ casa con
  el índice (barato) y ordena **solo las filas que quedan tras los filtros**. **España y sin país son una
  fila** (como en Buscar, §17 de docs/iptv.md): antes salían dos «M+ LaLiga TV» iguales cuando una variante
  traía «ES:» y otra no; la fila dice España si alguna variante lo dice y cuenta en los dos valores del filtro
  «País».
- **Favoritos** (`iptv/service.ts`): los ids IPTV de tus favoritos, como canal (clave y país), se pasan a los
  dos. En la pestaña, la caché de consultas tiene en cuenta tus favoritos.
- **Memoria**: guardar los hechos de todos los nombres costaría ~50 MB con 100 000 canales; se calculan solo
  los de los candidatos (3-4 µs cada uno) y se guardan hasta 20 000 (`NAME_CACHE_MAX`).

### Medidas (este PC, cargado con otros equipos)

| Canales | Índice Buscar | Índice pestaña | «la» | «la 1» | «dazn» | «m+ laliga» | «sports» |
|---|---|---|---|---|---|---|---|
| 20 000 | 88 ms | 156 ms | 15 / 22 ms | 1,5 / 1,9 ms | 1,3 / 1,0 ms | 0,5 / 0,8 ms | 5,5 / 5,2 ms |
| 100 000 | 202 ms | 575 ms | 28 / 32 ms | 4,9 / 2,8 ms | 3,5 / 1,5 ms | 2,4 / 1,4 ms | 20 / 17 ms |

(Buscar / pestaña, en frío.) En la pestaña, decidir qué casa marca las claves con arrays de bytes (sin
conjuntos): 12-24 ms aunque «canal» case con 90 000 de 100 000. El orden se calcula solo para las filas que
quedan tras los filtros y se ordena con dos números por fila (`packRankedHit`, el mismo orden que
`compareRankedHits`: lo prueba `buscador-corpus.test.ts` con 3 000 pares): «canal» con el filtro España (6 656
filas) baja de 534 ms (primera versión) a 40-90 ms con el PC cargado. El caso extremo, «canal» sin filtros
sobre el catálogo grande de prueba (90 000 filas que casan), tarda ~0,6 s: con listas reales (la de Isma tiene
27 687 canales) ninguna consulta de 2 letras o más casa con tantas. La web espera 450 ms tras la última tecla
antes de pedir (sin cambios), así que el móvil no hace nada al teclear.

## 5. Web

- **Resaltado** (`lib/name-highlight.ts`, `ChannelRow` con `highlight`): en la pestaña IPTV, el filtro de
  Canales (también «En tu IPTV») y Buscar. Con la API de resaltado de CSS (`CSS.highlights` y
  `::highlight(canal-coincide)` en `library.css`): **no toca el DOM**, así que el lector de pantalla, la
  búsqueda del navegador, el E2E y las pruebas leen el mismo texto. Se pinta con `--accent-wash` detrás y un
  subrayado de 2 px `--accent-edge`, sin cambiar la letra ni su color (contraste intacto en los dos temas).
  Sin la API (navegadores viejos), no se resalta. axe sin fallos serios en móvil y escritorio, oscuro y claro.
- **Demo**: la pestaña IPTV y «En tu IPTV» ordenan con `rankByName`; la IPTV de ejemplo trae los canales que
  confunden («La 10», «La 1 Catalunya», «La 1 Canarias», «M+ LaLiga TV 2/3», «LaLiga TV Hypermotion 2»,
  «LALIGA TV» inglés, «M+ #0») y las variantes 4K son una calidad más de su fila (fuera «M+ LaLiga 4K» y «DAZN
  LALIGA UHD» sueltos). En la demo, «En tu IPTV» del filtro de Canales sale sin pasar antes por Buscar.
- Sin cambios de contrato (`packages/shared` solo suma funciones; ninguna ruta, esquema ni error).

## 6. Pruebas

- `packages/shared/test/corpus/canales-iptv.ts`: el **corpus** (~1 500 nombres escritos a mano con la forma de
  las listas; nada sale de la lista real de Isma) y `corpusIptvGrande(n)` hasta 20 000 o 100 000 con relleno de
  otros países.
- `packages/shared/test/corpus/esperados.ts`: **la tabla consulta → los primeros** (71 consultas: «la 1» de 8
  formas, «la 2», «la 10», «tele 5», «a3», «m+ laliga», «hypermotion», «dazn», «dazn 1», «#vamos», «#0»,
  «champions», «tv3», «rai uno», «uk: laliga tv»…), con lo que nunca puede salir antes («la 10», «laliga 1»…)
  ni salir.
- `packages/shared/test/name-search.test.ts`: palabras, consulta, niveles, orden, resaltado, la tabla con el
  módulo solo y 20 000 canales al teclear.
- `apps/server/src/modules/iptv/buscador-corpus.test.ts`: la misma tabla por todo el camino del servidor en
  Buscar **y** en la pestaña, favoritos, `keySearchWords` = `nameSearchWords` con 20 000 claves, y 20 000
  canales al teclear.
- `names.test.ts` (limpieza), `service.test.ts` (favoritos de verdad), `browse.test.ts` y el E2E de
  integración `iptv.test.ts` (16) con los dos órdenes nuevos explicados; en la web, `model.test.ts` (la demo
  ordena como el servidor) y `lib/name-highlight.test.tsx`.

## 7. Para Pelis y series (segunda tanda, punto 7)

El módulo no sabe nada de canales salvo la grafía: sirve tal cual para títulos.

- Preparar una vez por título `nameFactsOf(título)` (o `nameFacts(nameSearchWords(título))`) y guardarlo con
  la tabla; para buscar, `parseNameQuery(lo escrito)` y `nameTierWithAliases(consulta, hechos)` o
  `rankByName(títulos, consulta, t => ({ name, facts, quality }))`.
- `nameSearchWords` ya quita los prefijos de país y calidad de los títulos VOD («ES - », «|ES| », «[4K] »,
  «4K - ») y las etiquetas del final (4K, HEVC, 1080p, «(2)»). Ojo: también quita palabras que en un título
  pueden ser parte del nombre si van solas al principio con un símbolo detrás (2 letras: «Up - …» se leería
  como país); para VOD conviene pasar el título ya limpio por `cleanVodTitle` (vod/titles.ts) y usar el
  módulo solo para las palabras y el orden.
- El año (4 cifras) es un número: casa entero. El orden por año o por «más reciente» va detrás de
  `compareNameRank`.
- El resaltado (`ChannelRow` → `useNameHighlight`) se puede usar igual en la tarjeta de un título.

## 8. Impacto en la app nativa

Ninguno obligatorio: no cambia ninguna ruta, esquema ni error (ni `ErrorCatalog.swift`). La app ve el mejor
orden y las filas juntas porque los da el servidor. Si se quiere el resaltado en iOS, hay que portar
`nameHighlights` (o pedirlo al servidor en otra versión).

## 9. Decisiones propuestas (para numerar al unir)

- **D-propuesta (buscador) 1 · Lo flojo detrás de lo bueno de cualquier país.** Cambia la regla de docs/iptv.md
  §19 («España o sin país delante en cualquier nivel») solo para las coincidencias flojas (en otro orden, por
  dentro, sin la marca, por la categoría): «tv3» da los TV3 de Suecia, Dinamarca… antes que «M+ LaLiga TV 3»;
  «sport 1» da el SPORT 1 alemán antes que «Eurosport 1». Entre lo bueno, España sigue primero («dazn 1» →
  DAZN 1 y DAZN 1 BAR de aquí antes que el alemán).
- **D-propuesta (buscador) 2 · En la pestaña IPTV, España y sin país son una fila** (cambia docs/iptv.md §16.3,
  que las separaba): como en Buscar (§17). Antes salían dos filas iguales.
- **D-propuesta (buscador) 3 · Tus favoritos IPTV desempatan delante, nunca delante de lo igual** (Buscar y
  pestaña).
- **D-propuesta (buscador) 4 · A igualdad de todo, la mejor calidad antes que el orden del proveedor.**
- **Para que decida Isma (no hecho):** dentro de la pestaña IPTV, la cápsula «IPTV» de cada fila sobra (todo es
  IPTV) y en el móvil, con un partido en directo, empuja las calidades hasta cortarlas («Descanso · En directo ·
  IPTV · 1080p · 72…»). Quitarla ahí daría sitio; se dejó porque §16.6 la decidió igual que en Buscar.

## 10. Riesgos

- Una lista con un canal cuyo nombre empiece por una sigla de 2 letras y un símbolo («TV-3», «LA - 1») ya no
  pierde la sigla (están excluidas «tv», «la», «el»…), pero otra sigla de 2 letras sí se leería como país.
- «Tele 5» alemán comparte clave con Telecinco: son filas distintas por el país, pero el emparejado con la
  agenda los distingue igual que antes (otro país no se empareja).
- Los números con letra solo del 0 al 10 y en seis idiomas.
- Los nombres en otros alfabetos (cirílico, árabe…) no se pueden buscar: la clave del catálogo
  (`normalizeChannelKey`, con la matriz 0.6.59 congelada) se queda solo con letras latinas y números. Ya pasaba
  antes; el módulo común sí los pliega (para Pelis y series).
