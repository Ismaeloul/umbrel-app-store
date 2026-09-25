# Historial de versiones de Ace Player Neo

Las notas de cada version salen del campo `releaseNotes` del manifiesto tal y como se publicaron en la tienda. La version actual las lleva ademas en `umbrel-app.yml`; las anteriores solo viven aqui.

## 0.8.0 (preparada, sin publicar)

Diseño nuevo, "Palco", en la web y en la app de iPhone: negro de cine con
un solo color de accion, el oro, y un modo claro igual de cuidado. La app
sigue el tema del sistema (claro u oscuro) salvo que elijas otro en
Ajustes > Apariencia.

Escudos y colores de verdad: la agenda enseña el escudo de cada equipo, sus
colores y el logo de la competicion. Los descarga tu Umbrel una vez y los
guarda; la web y el iPhone nunca los piden a nadie mas. Si un equipo no
aparece, sale un escudo generado con sus iniciales, y la agenda nunca espera
por ellos. Se apagan con ACE_TEAM_CRESTS=false.

Agenda: arriba, el partido destacado en una tarjeta grande con los colores
de los dos clubes, su hora o el minuto en directo y el estado de la señal.
Nada suena hasta que tocas "Ver ahora". El marcador sigue tapado hasta que
lo pides.

Partido: el video manda, con la luz de los dos equipos alrededor. Las
fuentes son carteles con el nombre del canal, la calidad y un anillo que
dice su estado con forma, palabra y color (Verificada, Floja, Sin señal,
Comprobando, Pendiente, Reportada); la dorada es la que esta en pantalla.
Un solo reproductor para todo: grande en el partido y en miniatura, con
imagen, mientras navegas.

Canales (antes Biblioteca), Buscar y Ajustes con el mismo aire. Pega un
Content ID o un enlace acestream:// en Buscar y lo reproduce al momento.

App de iPhone renovada (se actualiza aparte, con su IPA nueva): barra de
pestañas del sistema (Liquid Glass en iOS 26) con el mini-reproductor dentro,
arrastrar el video hacia abajo para minimizarlo, deslizarlo a los lados para
cambiar de fuente, doble toque para pantalla completa y vibraciones en cada
gesto.

## 0.7.1 (2026-09-23)

Nuevo en Ajustes: "Donde se esta reproduciendo". Ves que canal esta
sonando y en que dispositivos (el ordenador, el iPhone...), y cambia al
momento cuando alguien pone o quita un canal. Tambien se abre desde el
reproductor.

App de iPhone renovada (se actualiza aparte, con su IPA nueva): la agenda
filtra por tus equipos y ligas con "Para ti", las listas vienen agrupadas
como en la web, el reproductor se abre deslizando hacia arriba sobre el
mini y se minimiza deslizando hacia abajo, y al volver a la app con el PiP
activo ya no se ve el video dos veces. Adios a las franjas en blanco de
arriba en la agenda y en la biblioteca.

Salud: cerrar la pagina o parar un canal ya no cuenta como fallo en el
registro de diagnostico.

## 0.7.0 (2026-09-23)

Ace Player Neo, rehecho por dentro y por fuera. Tus favoritos, recientes,
listas y preferencias pasan solos a la version nueva, y antes de tocar nada
se guarda una copia intacta de tus datos por si hubiera que volver atras.

Web nueva: otro diseño, en oscuro y en claro, con Agenda, Biblioteca, Buscar
y Ajustes siempre a mano (en el movil, en una barra abajo). El reproductor
ya no se pierde al navegar: grande en el partido y en miniatura mientras
miras la agenda. Abre antes y pesa menos. Las fuentes de cada partido salen
en lista con su estado, y cada canal tiene un "Abrir en..." para la app de
AceStream o para copiar la direccion del stream y verlo en VLC.

El mismo partido en dos pantallas: si abres en otro dispositivo el canal que
ya estas viendo, el primero ya no se corta; los dos lo ven a la vez. Con
canales distintos sigue como siempre: el ultimo que da al play se queda el
mando y el otro se para con aviso. Si prefieres lo de antes, esta "Un solo
dispositivo a la vez" en Ajustes.

El motor se cuida solo: si AceStream deja de responder, la app lo nota, lo
reinicia (como mucho tres veces por hora) y vuelve a abrir el canal que
estabas viendo. Reiniciarlo a mano tampoco para el video: el reproductor
espera y se reengancha. Cada canal que dejas de ver se cierra en el motor,
asi que no quedan descargas fantasma comiendose la conexion.

El comprobador de fuentes ya no molesta: ademas de no tocar nunca el canal
que estas viendo, va mas despacio mientras hay algo en marcha, asi no le
quita pares al partido.

Directo de verdad: el boton dice cuanto vas por detras del directo y salta
al borde en un toque. Una señal que da un segundo de imagen entre cortes ya
no reconecta sin fin: pasa a la siguiente fuente. Las estadisticas, la
agenda y el mando llegan al momento, sin que la pagina pregunte cada pocos
segundos.

App de iPhone: se empareja desde Ajustes > Dispositivos con un codigo de 6
digitos o un QR, sin el login de Umbrel, y funciona en casa y fuera por
Tailscale. Reproductor nativo con ventana flotante, AirPlay y el partido en
la pantalla de bloqueo, y ve tambien las fuentes HEVC que la web no puede.
Cada iPhone se puede desconectar desde la web.

Por dentro: el Umbrel comprueba cada fichero de la version nueva antes de
arrancarla, y la web ya no deja descargar el codigo del servidor.

## 0.6.59 (2026-09-22)

Las listas de canales vuelven a actualizarse. Desde el 20 de septiembre las
pasarelas publicas de IPFS (ipfs.io, dweb.link) ya no sirven ficheros y los
tres directorios se quedaban con la copia vieja. Ahora el servidor los baja
directamente de la red IPFS, sin pasarela, y comprueba cada trozo contra su
huella.

Fuentes que iban y venian: el estado de cada fuente ya no salta de
"verificada" a "sin señal" y vuelta. Lo que ve el reproductor manda durante
unos minutos sobre la prueba del comprobador y se comparte con las demas
pantallas. Una fuente verificada que falla una sola prueba queda floja, no
muerta. El comprobador deja en paz el canal que estas viendo, al que antes
le quitaba pares, y la fuente que se esta conectando sale como
"comprobando" en vez de parpadear en rojo. Si ninguna responde todavia, la
app espera a los reintentos y arranca sola la primera que vuelva. Una
fuente que ya se estaba viendo aguanta tres reconexiones antes de cambiar a
otra, y un solo silencio del motor ya no pone "Motor: apagado" en pleno
partido.

iPhone, menos cortes: el canal arranca con unos segundos de colchon en vez
de pegado al directo, el adaptador se reconecta solo si el motor se corta y
la lista ya no se da por terminada. Si la imagen se queda parada con video
disponible, salta al directo en vez de reiniciar; ante un error del
reproductor reconecta al momento y no a los 30 segundos; y al volver a la
app recupera la señal si se habia perdido. El arranque tiene margen para lo
que tarda de verdad un canal lento. El titulo del canal sale en la pantalla
de bloqueo y en la ventana flotante.

HTTPS: las redirecciones del motor ya no llevan al navegador a http://
cuando la app se abre por https.

## 0.6.58 (2026-09-19)

Repaso general de la interfaz y del servidor.

Reproductor: volver a la portada ya no apaga el canal. Sigue sonando y una
barra permite volver al video o detenerlo. Los controles de escritorio
ganan un boton de Detener y un retroceso de 30 segundos para repetir la
jugada (tecla J). La pantalla completa funciona en iPhone. Las flechas
del teclado solo zapean cuando estas viendo algo, no mientras navegas por
la agenda. Al saltar a un canal de la biblioteca se cierra el centro de
partido en vez de quedarse pegado al anterior.

Fuentes: cada boton del selector dice el proveedor y su estado en una
palabra, no solo un numero. La señal floja se pinta en ambar y la fallida
en rojo; antes eran el mismo color, tambien en el panel de salud.

Primer uso: la agenda sale completa y una tarjeta invita a personalizarla;
desaparece el modal bloqueante del arranque. La biblioteca abre en la
pestaña que tiene contenido, cada estado vacio lleva el boton que lo
resuelve, y desde cualquier pestaña se puede saltar a buscar en el motor.

Legibilidad: ningun texto por debajo de 11 px y los grises secundarios
con contraste suficiente. Los avisos hablan de la señal, no de buffers ni
de infohashes.

Sin sustos: borrar un canal se puede deshacer durante seis segundos;
borrar un directorio y reiniciar el motor piden un segundo toque, y el
reinicio sale de la cabecera. Un Content ID se pega desde un boton fijo de
la cabecera, tambien sin partido en marcha.

Servidor: cuatro rutas leian el estado antes que el cuerpo de la peticion
y podian pisar escrituras de otro dispositivo. Un state.json ilegible se
aparta y se recupera de la copia anterior en vez de arrancar sin
favoritos. Los errores internos salen como 500 con rastro en el log. El
remux para iPhone ya no expulsa a un espectador activo. Hasta ocho
rotulos por partido sin contar variantes HDR o Bar. El reproductor
consulta un endpoint ligero en vez de bajar el estado entero cada cinco
segundos. Reiniciar el motor exige un secreto que solo conoce el backend.

Directorios: la tarjeta dice por que fallo la ultima actualizacion (ipfs.io
lleva dias respondiendo 429) y se prueba dweb.link como alternativa.

Empaquetado: nginx espera a que el servidor este sano, comprime HTML y
JSON, el escaner deja de publicar su puerto en la red local, ffmpeg queda
en cache para instalarse sin internet, los tests corren en GitHub Actions
y el historico de notas pasa a CHANGELOG.md.

## 0.6.57 (2026-09-19)

Los carruseles del movil ya no vuelven solos al principio. El selector de
fuentes se repintaba cada segundo y medio mientras el comprobador trabajaba,
y cada repintado rehacia el carril entero: al deslizarlo con el dedo volvia
a la primera fuente y cortaba la inercia. Ahora, si las fuentes son las
mismas, solo cambian el color y el estado de cada boton sin tocar el carril,
y cuando entra o sale una fuente se conserva la posicion. Solo se mueve solo
la primera vez que aparece y cuando cambia la fuente activa, lo justo para
que se vea. Lo mismo para la tira de dias de la agenda, que se recentraba en
hoy con cada repintado: ahora solo se reconstruye si cambia algo y solo se
centra al elegir otro dia; y si la tocas mientras se esta centrando, manda
el dedo. La fila de acciones de la fuente (favorito, rebuscar, pegar hash,
reportar), que en el movil tambien se desplaza en horizontal, deja de
rehacerse con cada refresco; y ademas ya se puede deslizar entera: estaba
alineada al final y los primeros botones desbordaban por la izquierda,
fuera del alcance del dedo.

## 0.6.56 (2026-09-08)

Los avisos dejan de tapar el video. Lo que le pasa a la señal -fuente
verificada, reintento, buffer, zapping, rebusqueda, directo- no es una
notificacion sino el estado del reproductor, y ahora se lee en una linea
discreta justo debajo del video, de una en una, sin apilarse. Los avisos
emergentes quedan solo para lo que haces tu -favorito, copiar, guardar- y
para errores que piden atencion: mas pequeños, dos como maximo, menos
tiempo en pantalla y en la esquina inferior derecha del ordenador, nunca
encima de la imagen. En el movil siguen centrados sobre la barra inferior,
donde no hay video debajo.

## 0.6.55 (2026-09-08)

Al entrar a un partido arranca la primera fuente que funciona de verdad.
Hasta ahora se reproducia la mejor colocada sin esperar al comprobador, y
si no iba, un unico salto a otra. Ahora la app espera al comprobador y
arranca la primera verificada; si esa se cae, pasa a la siguiente
verificada, y asi hasta agotarlas. En cuanto eliges una a mano, el
automatismo se apaga. Con la precarga de la agenda la espera suele ser de
segundos, y el resultado bueno vale diez minutos en vez de tres.
El comprobador ya no se deja engañar por el arranque. MOVISTAR PLUS de
ELCANO daba 3 MB en medio segundo -la cache del motor- y despues medio
megabit con un par: el comprobador la ponia en verde y el reproductor se
quedaba a los pocos segundos. Ahora mantiene la prueba doce segundos y
mide, con el propio contador del motor, lo que entra del enjambre en la
segunda mitad -pasada la rafaga- contra el bitrate del canal, que sale de
los PCR del transport stream. Si no llega al 85%, la fuente es floja y no
verde. Medido con esa señal: canal de 2,2 Mbit/s y entrada de 1,5, ahora
marcada como floja; y otra pasada dio 2,7 y verde, que es justo lo que le
pasa a esa señal: unas veces va y otras no. Cada boton del selector dice
ahora esos dos numeros al pasar por encima.
De paso, el codec sale de la PMT del propio flujo: ffprobe solo se lanza
cuando el flujo no lo dice, y cada comprobacion tarda menos.

## 0.6.54 (2026-09-06)

La version que declara la app vuelve a ser la real. La 0.6.53 seguia
diciendo 0.6.52 en el panel de salud y en la cache del movil, porque el
numero estaba escrito a mano en dos sitios que ninguna release tocaba. Ahora
un test exige que servidor y service worker lleven la version del
manifiesto, asi que no puede volver a quedarse atras. Con la cache del
movil renovada, el telefono descarga el reproductor de esta version en
vez de conservar el anterior.

## 0.6.53 (2026-09-06)

Arregla que un partido de LaLiga arrancara solo en DAZN 1. La agenda
anuncia Espanyol-Sevilla en "M+ LALIGA", "M+ LALIGA HDR", "DAZN" y "DAZN
App Gratis", y hay un vinculo guardado de "DAZN" hacia DAZN 1: la app lo
ponia el primero y lo reproducia sola, con otro deporte, por delante de
las once señales de M+ LALIGA que tenias en las listas.
La regla de la 0.6.52 -la marca se aparta detras del canal concreto- no
saltaba aqui porque "M+ LALIGA" tambien parecia generica al lado de "M+
LALIGA HDR". Las coletillas HDR, Bar o UHD son el mismo canal en otra
calidad o para otro local, no un canal mas concreto: ya no cuentan. Y se
añade una segunda pista con datos y no con palabras: si de otro canal
anunciado hay señales exactas en tus listas y de este solo hay familia o
un vinculo, este es la marca y se aparta. Un vinculo solo decide si sigue
en cabeza tras ese orden; cuando el partido solo se anuncia por la marca,
como Juventus-Milan en "DAZN", el vinculo manda igual que antes.
Comprobado con tu biblioteca real: Espanyol-Sevilla pasa de abrir DAZN 1 a
abrir M+ LALIGA, Arsenal-Chelsea abre DAZN 1 -que si esta anunciado- y
Juventus-Milan no cambia.
Rebuscar deja de decir que no hay nada y sacar siete fuentes despues. El
aviso salia en cuanto se reunian las señales, pero quien decide cuales
funcionan es el comprobador, segundos mas tarde, y las fallidas ni se
pintan. Ahora anuncia cuantas señales reune y da el veredicto -cuantas
nuevas funcionan de verdad- cuando el comprobador termina.
Para ti ya no cuela LaLiga Hypermotion. Venia de la seleccion "España": su
regla de competiciones nacionales miraba si la liga "incluye" laliga, y
"laliga hypermotion" la incluye. Quien quiera Segunda la marca como liga,
como hasta ahora.
La IA local se calentaba en lotes de 96 nombres con 6,5 s de tope. Medido
en el NAS, 100 nombres tardan 6,9 s: el primer lote se pasaba siempre, se
tiraba el trabajo entero y se repetia cada media hora (era el
"ollama_timeout" del registro). Ahora va en lotes de 24 con 12 s de
margen, y un lote fallido no tira los demas.

## 0.6.52 (2026-08-27)

Arregla que al dar a un partido se abriera otro canal. La agenda lista varios
canales por partido y NO son equivalentes: para el Barcelona-Athletic anuncia
"DAZN LaLiga", "DAZN" y "LaLiga TV Bar", donde "DAZN" es la marca y
"DAZN LaLiga" es el canal donde de verdad dan el partido. La app los trataba
igual, asi que un vinculo guardado sobre la marca se ponia el primero y abria
DAZN 1, con otro deporte.
Ahora un canal cuyas palabras caben dentro de las de otro canal pedido se
reconoce como la marca y se aparta detras del canal concreto. No se descarta:
sigue estando en el selector por si acaso. Y si un partido solo se anuncia
por la marca, la marca es lo unico que hay y no se toca nada.
Comprobado sobre sesenta partidos de la agenda real: cambia la señal que
arranca sola en nueve, y los nueve son exactamente este fallo. Ninguno pierde
fuentes.
La app aprende sola que señales aguantan. Hasta ahora solo aprendia si
pulsabas "es el canal correcto", asi que en la practica no aprendia nada.
Ahora cada reproduccion deja un veredicto por su cuenta -arranco, no arranco,
o arranco y se cayo- y con eso ordena las fuentes la proxima vez.
Aprende en dos niveles, y los dos hacen falta. Por enlace, porque uno
concreto puede morir y no volver. Y por proveedor, que es lo que de verdad
cambia las cosas: cuando un proveedor se cae, se caen todas sus señales a la
vez, asi que la leccion sirve tambien para enlaces suyos que nunca has
probado. Es exactamente el diagnostico que hacias a mano.
Arrancar y morirse en menos de un minuto no cuenta como que funcionara, y la
fama vieja se desgasta: lo que iba bien hace un mes deja de pesar si ahora se
cae. Con pocos intentos la app no se precipita; hacen falta varios aciertos
para que una fuente adelante a una desconocida.
Lo aprendido solo ordena entre fuentes igual de validas: nunca decide que
canal es. Eso lo siguen resolviendo el nombre y el numero de canal.
El historial de aprendizaje arranca vacio a proposito.
Blindaje interno, sin cambios visibles. El umbral que decide "es ese canal,
sin duda" estaba escrito a mano en siete sitios distintos que significan lo
mismo: cambiar uno y dejar los otros seis en silencio era un fallo esperando
su turno. Ahora tiene nombre y se usa en todos.
Ademas quedan sujetos por tests dos acoplamientos que hasta ahora solo vivian
en la cabeza de quien escribio el codigo: que una promocion de la busqueda
inteligente cuenta como canal exacto -y por tanto descarta las hermanas
numeradas, que es lo que se quiere- y que las marcas paraguas como DAZN
conservan su familia aunque la IA este activa.
Y uno nuevo que ya nos costo un rato en su dia: el emparejador de canales
existe por duplicado, en el servidor y en la pagina, y si divergen el boton
dice "buscar canal" mientras el servidor si lo encuentra. Ahora un test
compara las dos implementaciones sobre nombres reales y salta si dejan de
coincidir.
Cuatro correcciones sobre lo ultimo que se añadio.
El hash que pegas a mano ya no se manda siempre como Content ID. Un hash de
40 caracteres puede ser un Content ID o un infohash y mirandolo no hay forma
de saberlo, asi que se marca como desconocido: se prueba primero como Content
ID -que es lo que llevan los enlaces acestream://- y si el motor no arranca
se reintenta una sola vez como infohash antes de darlo por muerto. Las
señales de tus listas no se ven afectadas, que esas si saben lo que son.
El boton de pegar hash ya esta disponible cuando un partido no encuentra
ninguna fuente, que es justo cuando hace falta. Antes el panel entero se
ocultaba y se iba con el.
La deteccion de Hypermotion vuelve a mirar el canal. Los canales de un
partido son objetos, no texto, asi que esa comprobacion no detectaba nada y
solo funcionaba cuando la propia fuente rotulaba bien la competicion.
Y la busqueda inteligente se vuelve mas prudente: el listón sube de 0,82 a
0,86 -medido, dos competiciones distintas llegaban a rozar 0,8154- y cuando
no hay ningun otro canal con el que contrastar se exige practicamente
identidad en vez de dar el visto bueno por defecto.
El filtro Para ti separa estrictamente LaLiga de LaLiga Hypermotion, incluso
cuando la agenda rotula el partido como LaLiga y la referencia a Hypermotion
solo aparece en el canal de emision. Elegir LaLiga ya no muestra encuentros
de Segunda Division, y elegir Hypermotion sigue encontrando sus partidos.

## 0.6.51 (2026-08-27)

La app aprende sola que señales aguantan. Hasta ahora solo aprendia si
pulsabas "es el canal correcto", asi que en la practica no aprendia nada.
Ahora cada reproduccion deja un veredicto por su cuenta -arranco, no arranco,
o arranco y se cayo- y con eso ordena las fuentes la proxima vez.
Aprende en dos niveles, y los dos hacen falta. Por enlace, porque uno
concreto puede morir y no volver. Y por proveedor, que es lo que de verdad
cambia las cosas: cuando un proveedor se cae, se caen todas sus señales a la
vez, asi que la leccion sirve tambien para enlaces suyos que nunca has
probado. Es exactamente el diagnostico que hacias a mano.
Arrancar y morirse en menos de un minuto no cuenta como que funcionara, y la
fama vieja se desgasta: lo que iba bien hace un mes deja de pesar si ahora se
cae. Con pocos intentos la app no se precipita; hacen falta varios aciertos
para que una fuente adelante a una desconocida.
Lo aprendido solo ordena entre fuentes igual de validas: nunca decide que
canal es. Eso lo siguen resolviendo el nombre y el numero de canal.
El historial de aprendizaje arranca vacio a proposito.
Blindaje interno, sin cambios visibles. El umbral que decide "es ese canal,
sin duda" estaba escrito a mano en siete sitios distintos que significan lo
mismo: cambiar uno y dejar los otros seis en silencio era un fallo esperando
su turno. Ahora tiene nombre y se usa en todos.
Ademas quedan sujetos por tests dos acoplamientos que hasta ahora solo vivian
en la cabeza de quien escribio el codigo: que una promocion de la busqueda
inteligente cuenta como canal exacto -y por tanto descarta las hermanas
numeradas, que es lo que se quiere- y que las marcas paraguas como DAZN
conservan su familia aunque la IA este activa.
Y uno nuevo que ya nos costo un rato en su dia: el emparejador de canales
existe por duplicado, en el servidor y en la pagina, y si divergen el boton
dice "buscar canal" mientras el servidor si lo encuentra. Ahora un test
compara las dos implementaciones sobre nombres reales y salta si dejan de
coincidir.
Cuatro correcciones sobre lo ultimo que se añadio.
El hash que pegas a mano ya no se manda siempre como Content ID. Un hash de
40 caracteres puede ser un Content ID o un infohash y mirandolo no hay forma
de saberlo, asi que se marca como desconocido: se prueba primero como Content
ID -que es lo que llevan los enlaces acestream://- y si el motor no arranca
se reintenta una sola vez como infohash antes de darlo por muerto. Las
señales de tus listas no se ven afectadas, que esas si saben lo que son.
El boton de pegar hash ya esta disponible cuando un partido no encuentra
ninguna fuente, que es justo cuando hace falta. Antes el panel entero se
ocultaba y se iba con el.
La deteccion de Hypermotion vuelve a mirar el canal. Los canales de un
partido son objetos, no texto, asi que esa comprobacion no detectaba nada y
solo funcionaba cuando la propia fuente rotulaba bien la competicion.
Y la busqueda inteligente se vuelve mas prudente: el listón sube de 0,82 a
0,86 -medido, dos competiciones distintas llegaban a rozar 0,8154- y cuando
no hay ningun otro canal con el que contrastar se exige practicamente
identidad en vez de dar el visto bueno por defecto.
El filtro Para ti separa estrictamente LaLiga de LaLiga Hypermotion, incluso
cuando la agenda rotula el partido como LaLiga y la referencia a Hypermotion
solo aparece en el canal de emision. Elegir LaLiga ya no muestra encuentros
de Segunda Division, y elegir Hypermotion sigue encontrando sus partidos.

## 0.6.50 (2026-08-26)

Blindaje interno, sin cambios visibles. El umbral que decide "es ese canal,
sin duda" estaba escrito a mano en siete sitios distintos que significan lo
mismo: cambiar uno y dejar los otros seis en silencio era un fallo esperando
su turno. Ahora tiene nombre y se usa en todos.
Ademas quedan sujetos por tests dos acoplamientos que hasta ahora solo vivian
en la cabeza de quien escribio el codigo: que una promocion de la busqueda
inteligente cuenta como canal exacto -y por tanto descarta las hermanas
numeradas, que es lo que se quiere- y que las marcas paraguas como DAZN
conservan su familia aunque la IA este activa.
Y uno nuevo que ya nos costo un rato en su dia: el emparejador de canales
existe por duplicado, en el servidor y en la pagina, y si divergen el boton
dice "buscar canal" mientras el servidor si lo encuentra. Ahora un test
compara las dos implementaciones sobre nombres reales y salta si dejan de
coincidir.
Cuatro correcciones sobre lo ultimo que se añadio.
El hash que pegas a mano ya no se manda siempre como Content ID. Un hash de
40 caracteres puede ser un Content ID o un infohash y mirandolo no hay forma
de saberlo, asi que se marca como desconocido: se prueba primero como Content
ID -que es lo que llevan los enlaces acestream://- y si el motor no arranca
se reintenta una sola vez como infohash antes de darlo por muerto. Las
señales de tus listas no se ven afectadas, que esas si saben lo que son.
El boton de pegar hash ya esta disponible cuando un partido no encuentra
ninguna fuente, que es justo cuando hace falta. Antes el panel entero se
ocultaba y se iba con el.
La deteccion de Hypermotion vuelve a mirar el canal. Los canales de un
partido son objetos, no texto, asi que esa comprobacion no detectaba nada y
solo funcionaba cuando la propia fuente rotulaba bien la competicion.
Y la busqueda inteligente se vuelve mas prudente: el listón sube de 0,82 a
0,86 -medido, dos competiciones distintas llegaban a rozar 0,8154- y cuando
no hay ningun otro canal con el que contrastar se exige practicamente
identidad en vez de dar el visto bueno por defecto.
El filtro Para ti separa estrictamente LaLiga de LaLiga Hypermotion, incluso
cuando la agenda rotula el partido como LaLiga y la referencia a Hypermotion
solo aparece en el canal de emision. Elegir LaLiga ya no muestra encuentros
de Segunda Division, y elegir Hypermotion sigue encontrando sus partidos.

## 0.6.49 (2026-08-26)

Cuatro correcciones sobre lo ultimo que se añadio.
El hash que pegas a mano ya no se manda siempre como Content ID. Un hash de
40 caracteres puede ser un Content ID o un infohash y mirandolo no hay forma
de saberlo, asi que se marca como desconocido: se prueba primero como Content
ID -que es lo que llevan los enlaces acestream://- y si el motor no arranca
se reintenta una sola vez como infohash antes de darlo por muerto. Las
señales de tus listas no se ven afectadas, que esas si saben lo que son.
El boton de pegar hash ya esta disponible cuando un partido no encuentra
ninguna fuente, que es justo cuando hace falta. Antes el panel entero se
ocultaba y se iba con el.
La deteccion de Hypermotion vuelve a mirar el canal. Los canales de un
partido son objetos, no texto, asi que esa comprobacion no detectaba nada y
solo funcionaba cuando la propia fuente rotulaba bien la competicion.
Y la busqueda inteligente se vuelve mas prudente: el listón sube de 0,82 a
0,86 -medido, dos competiciones distintas llegaban a rozar 0,8154- y cuando
no hay ningun otro canal con el que contrastar se exige practicamente
identidad en vez de dar el visto bueno por defecto.
El filtro Para ti separa estrictamente LaLiga de LaLiga Hypermotion, incluso
cuando la agenda rotula el partido como LaLiga y la referencia a Hypermotion
solo aparece en el canal de emision. Elegir LaLiga ya no muestra encuentros
de Segunda Division, y elegir Hypermotion sigue encontrando sus partidos.

## 0.6.48 (2026-08-23)

El filtro Para ti separa estrictamente LaLiga de LaLiga Hypermotion, incluso
cuando la agenda rotula el partido como LaLiga y la referencia a Hypermotion
solo aparece en el canal de emision. Elegir LaLiga ya no muestra encuentros
de Segunda Division, y elegir Hypermotion sigue encontrando sus partidos.

## 0.6.47 (2026-08-22)

Nuevo boton Pegar hash durante la reproduccion. Permite introducir un Content
ID de 40 caracteres, un enlace acestream:// o una URL que contenga el ID y
reproducirlo como una fuente externa sin salir del partido. La fuente se
incorpora al selector de la sesion actual, no crea ninguna asociacion ni se
guarda automaticamente en favoritos. Si funciona, se puede conservar despues
con el boton Favorito habitual.

## 0.6.46 (2026-08-22)

Nuevo boton Rebuscar en el centro de partido. Sin detener la señal que estas
viendo, hace una pasada nueva por Favoritos, todo el directorio M3U y el
indice publico de AceStream, en ese orden. La IA local contrasta el conjunto
completo con los canales anunciados para el partido y el segundo motor vuelve
a comprobar los hashes sin reutilizar resultados antiguos. Las fuentes nuevas
aparecen en el selector a medida que se verifican; si no aparece ninguna, la
app lo dice y conserva tanto la reproduccion como las opciones existentes.

## 0.6.45 (2026-08-22)

La agenda Para ti ahora combina todos tus gustos: muestra un partido cuando
coincide con una liga, un equipo o una seleccion o pais favorito. Los
amistosos y torneos especiales de tus equipos dejan de desaparecer por no
pertenecer a una liga marcada. Tambien reconoce variantes habituales como
Barcelona, FC Barcelona y Barca sin mezclar el club con Barcelona SC o sus
filiales.

## 0.6.44 (2026-08-22)

La agenda Para ti ahora combina todos tus gustos: muestra un partido cuando
coincide con una liga, un equipo o una seleccion o pais favorito. Los
amistosos y torneos especiales de tus equipos dejan de desaparecer por no
pertenecer a una liga marcada. Tambien reconoce variantes habituales como
Barcelona, FC Barcelona y Barca sin mezclar el club con Barcelona SC o sus
filiales.

## 0.6.43 (2026-08-19)

La agenda Para ti ahora combina todos tus gustos: muestra un partido cuando
coincide con una liga, un equipo o una seleccion o pais favorito. Los
amistosos y torneos especiales de tus equipos dejan de desaparecer por no
pertenecer a una liga marcada. Tambien reconoce variantes habituales como
Barcelona, FC Barcelona y Barca sin mezclar el club con Barcelona SC o sus
filiales.

## 0.6.42 (2026-08-19)

Las fuentes que fallan dejan de ocupar hueco en el selector, salvo la señal
que siga activa, y ya no se vuelven a comprobar unos segundos despues. El
segundo motor aplaza diez minutos su siguiente intento y mantiene el hash
apartado mientras tanto. Si la señal inicial falla, el reproductor salta
una sola vez a la primera alternativa realmente verificada; desde ese punto
todos los cambios vuelven a ser manuales. Una fuente reportada puede volver
a aparecer cuando la comprobacion aplazada confirma que se ha recuperado.

## 0.6.41 (2026-08-19)

Estrena el nuevo centro de partido. Precalienta y vuelve a comprobar fuentes
cerca del inicio, permite reportar una señal caída o un
canal incorrecto, aprende de las correcciones hechas por el usuario y añade
un panel de salud del motor principal, el comprobador, Ollama, la agenda y
los directorios M3U. En ordenador, el vídeo estrena controles NEO acordes al
diseño; el móvil conserva los controles nativos. Las fuentes se presentan
como botones numerados compactos con verde para verificadas o comprobando y
rojo para fallidas o reportadas. El verificador ya no confunde pares o bytes
recibidos con una imagen válida: comprueba la pista de vídeo y el reproductor
confirma la fuente activa antes de marcarla como operativa.

## 0.6.40 (2026-08-19)

Corrige el fallo que podia dejar la aplicacion inaccesible justo despues de
actualizarla. Compose arrancaba la version nueva, pero el hook de Umbrel
seguia comprobando la anterior y terminaba sin copiar los archivos nuevos al
NAS. En la 0.6.39, por ejemplo, los servicios buscaron releases/0.6.39 aunque
el hook dio por buena releases/0.6.38.
El hook ya obtiene automaticamente la version unica usada por Compose y la
contrasta con el manifiesto antes de detener o recrear nada. Si falta la
release, la restaura primero desde el checkout local de la tienda, despues
desde su etiqueta inmutable y, como ultimo salvavidas, desde main. Asi una
version olvidada en el hook o una etiqueta pendiente no vuelve a tumbar la
aplicacion. Se anade ademas una prueba de consistencia para que cualquier
diferencia entre manifiesto, Compose, hook y carpeta de release falle antes
de publicar.

## 0.6.39 (2026-08-19)

Nueva capa de IA local para resolver los canales de cada partido. El backend
entrega a embeddinggemma la programacion completa de futbolenlatv junto con
los nombres de tus M3U, favoritos, historial y resultados del buscador; asi
puede recuperar rotulos raros como "MOVISTAR CHAMPIONS --> SPORT TV" sin
mandar ningun dato fuera del NAS. El identificador del partido hace que el
servidor tome los canales de la agenda real y no confie en un nombre enviado
por el navegador. La IA compara cada fuente con todos los canales programados
y solo suma coincidencias claras; las reglas exactas siguen mandando sobre
los diales, por lo que Champions 2 o 3 nunca sustituyen al canal principal ni
Hypermotion se cuela en LaLiga o Champions. Si Ollama no responde, la busqueda
clasica sigue funcionando. Tambien se busca sin el prefijo de operador para
que el buscador encuentre variantes ELCANO, NEW ERA y similares.
Nuevo comprobador de fuentes en segundo plano. Un segundo motor AceStream,
aislado del reproductor, recibe todas las coincidencias de un partido y las
prueba de una en una descargando una muestra real. Las tres primeras siguen
apareciendo al instante para que puedas entrar sin esperar; despues, el
selector se actualiza solo y añade las señales verificadas, marca las lentas
y retira las que no entregan video. El progreso indica cuantas se han
comprobado y cuantas son reproducibles. Los resultados buenos se reutilizan
durante tres minutos y los fallos se vuelven a intentar pronto, porque los
enjambres P2P cambian continuamente. El escaner tiene puerto, memoria y cache
propios, no se expone al navegador y cierra cada sesion al terminar para no
competir con el canal que estas viendo.
La prueba real en Umbrel descubrio y corrigio un falso negativo del cliente
HTTP interno: el motor devolvia una sesion valida pero no empezaba a servir
el video. Con la peticion corregida, un hash activo paso de 0 bytes tras 18 s
a entregar 166 KB en 1,36 s y queda marcado como verificado.
Ademas, un cero del buscador ya no elimina un hash que tambien venga de tus
listas o favoritos: se conserva para que decida el segundo motor con datos
reales. Los resultados muertos que solo aporta el buscador se siguen
descartando sin gastar tiempo de prueba.

## 0.6.38 (2026-08-18)

Los canales de la agenda ahora se emparejan como equivalentes aunque las
listas escriban M+, M., Movistar o no indiquen operador, y se reconocen las
coletillas de proveedor con flechas ASCII o Unicode sin confundirlas con el
nombre del canal. Los numeros se conservan para no mezclar Champions 1, 2 y
3. La prioridad pasa a ser estricta: vinculo guardado, todos los M3U,
favoritos, historial y solo al final el buscador AceStream.
Bajo el reproductor cada alternativa muestra ya su origen y proveedor, hash
corto y disponibilidad, en vez de ser un boton numerado sin contexto. Al
cambiar a un resultado alternativo del buscador tambien se conserva si es un
infohash, evitando el falso error de stream que provocaba tratarlo como ID.

## 0.6.37 (2026-08-18)

Se retira el tope de fuentes: ahora se ofrecen TODAS las que superen el
umbral, no doce. Medido sobre tus listas, un partido de Champions pasa de 12
a 23 señales y DAZN a 22.
Y con el tope fuera salio a la luz un fallo que tapaba: un vinculo guardado
contaba como prueba de que el canal exacto existe, y como el vinculo esta
archivado con el mismo nombre que pides, casa consigo mismo siempre. Tener un
vinculo de "DAZN" borraba de golpe los 22 DAZN de la biblioteca y dejaba una
sola señal. Ahora esa prueba solo la da la biblioteca.
El selector aguanta la lista larga: el nombre del canal tiene sitio
garantizado y los botones ruedan en horizontal empezando por el primero, que
es el mejor colocado.

## 0.6.36 (2026-08-18)

Primero tus listas, despues el buscador del motor. Habia un fallo tonto y
gordo: la disponibilidad solo la traen los resultados del buscador, y al
ordenarlo todo junto los de tus listas -que valen "no se sabe"- perdian
siempre. Asi que la señal que arrancaba sola era casi siempre un hash suelto
del buscador, teniendo tus canales importados, que estan curados y funcionan
mucho mejor.
El orden pasa a ser: los vinculos que has confirmado a mano, luego tus listas
M3U con favoritos e historial, y por ultimo el buscador. Dentro de cada grupo
se sigue repartiendo entre proveedores. Al buscador se le guardan las dos
ultimas plazas por si tus hashes hubieran caducado todos a la vez, y si no
hay nada que poner ahi esas plazas vuelven a tus listas.

## 0.6.35 (2026-08-18)

Cambia como se identifican los canales, y con eso aparecen muchas mas
señales. Tus listas grandes son agregadores: la de NEW ERA trae dentro ocho
proveedores -SPORT TV, NEW LOOP, ELCANO, NEW ERA...- y lo rotula en el propio
titulo, "LIGA DE CAMPEONES --> ELCANO". La app trataba esa coletilla como
parte del nombre del canal, asi que el proveedor contaba como palabra propia
y hundia la puntuacion. Lo mismo con el operador: "M+ Liga de Campeones" y
"LIGA DE CAMPEONES" son el mismo canal, pero "movistar" contaba como palabra
distintiva. Ahora ambas cosas se tratan como lo que son, decoracion. Medido:
de 53 canales de Champions en tus listas se reconocian 26 y ahora 33.
Y las señales se reparten entre proveedores en vez de dejar que uno copo la
lista: antes salian cinco del mismo sitio seguidas y las alternativas
quedaban del octavo puesto en adelante, asi que si ese proveedor estaba caido
la que arrancaba sola estaba muerta. Ahora los primeros puestos llevan uno de
cada proveedor.
El numero de canal se conserva intacto, que es lo unico que de verdad
distingue un partido de otro: Liga de Campeones 2 sigue sin colarse en un
partido del 1.

## 0.6.34 (2026-08-18)

Se acabo que un partido de Liga de Campeones ofreciera señales del 2, del 3 y
del 4, que son otros partidos. Venia del arreglo que permitio que pedir
"DAZN" ofreciera todos los DAZN: al no distinguir los dos casos, tambien
ofrecia las hermanas numeradas de un canal que existe tal cual.
La diferencia esta en si el canal exacto existe en tu biblioteca. "M+ Liga de
Campeones" existe, asi que el 2 y el 3 sobran; "DAZN" a secas no existe como
canal, asi que alli las numeradas son lo unico que hay. Ahora la familia solo
se ofrece cuando no aparece el canal exacto. Medido sobre tus listas: de 38
señales de otro canal se pasa a ninguna, y DAZN conserva las suyas.
Las coletillas de calidad no cuentan como numero: 1080p o 720p no convierten
un canal en otro distinto.

## 0.6.33 (2026-08-18)

Menos señales muertas al dar a ver un partido. La busqueda ya se rehacia
entera en cada pulsacion, pero mandaba solo el parecido del nombre: un hash
caido con el nombre clavado se ofrecia por delante de uno vivo. Ahora, dentro
de cada grupo de nombres igual de buenos, primero va lo que el motor dice que
esta vivo, y lo que da por muerto -sin nadie compartiendo- ni se ofrece.
Un mismo hash puede llegar por tu lista M3U y por el buscador del motor. Al
fusionarlos se perdia el dato de disponibilidad, que solo trae el buscador;
ahora se conserva venga de donde venga, asi que tambien se sabe si los de tus
listas siguen vivos. Se ofrecen hasta doce señales en vez de ocho.
El selector marca cada fuente con un punto: verde si tiene pares de sobra,
ambar si va justa, y al pasar por encima dice el porcentaje. Ademas, al ir a
ver un partido se refrescan en segundo plano las listas que lleven mas de
media hora sin actualizarse, sin hacerte esperar.

## 0.6.32 (2026-08-18)

"Ir al directo" vuelve a funcionar en el iPhone. Daba un microcorte y te
dejaba donde estabas porque preguntaba a la parte equivocada del reproductor:
miraba lo que llevaba descargado por delante del cabezal -un par de segundos-
en vez del borde real de la emision. Con 158 s de retraso saltaba 0,8 s.
Ahora usa la ventana en vivo que publica la lista, asi que el salto llega de
verdad al directo. El indicador tambien se arregla: antes decia 0 s de
retraso llevando dos minutos y medio. Si ya estas en el directo te lo dice en
vez de dar el tiron, y si la señal no deja saltar mas adelante, avisa en
lugar de dejar el boton encendido para siempre.

## 0.6.31 (2026-08-18)

El audio deja de ir por delante de la imagen en el iPhone, y sin añadir ni un
milisegundo de latencia.
Al engancharse a un directo casi nunca caes justo en un fotograma clave. El
reempaquetado tiraba los fotogramas de video hasta el siguiente clave pero
conservaba el audio de ese tramo, asi que la reproduccion arrancaba con
sonido a solas y el audio quedaba adelantado el resto de la sesion, tanto
como durase el grupo de imagenes. Medido con un enganche a mitad de grupo:
2,111 s de adelanto. Ahora se conservan esos fotogramas iniciales y las dos
pistas empiezan juntas: 0,071 s, por debajo de lo perceptible.
No es un cambio de tiempos ni de buffer: la latencia y los modos de
reproduccion se quedan exactamente como estaban, y el video se sigue copiando
sin recodificar, asi que tampoco sube el consumo del NAS.

## 0.6.30 (2026-08-18)

Arregla el audio desincronizado en el iPhone. Solo pasaba alli porque el
iPhone es el unico que reproduce a traves del reempaquetado del servidor; en
el ordenador el video va directo y por eso iba bien.
El sincronizador de audio estaba puesto en "async=1", que segun la propia
documentacion de ffmpeg solo rellena o recorta muestras, y ademas solo cuando
el desfase ya supera una decima de segundo. Con una señal P2P, que llega con
saltos continuos, eso significa que la deriva pequeña no se corregia nunca y
al acumularse se arreglaba de golpe: de ahi que el audio se adelantara y se
atrasara respecto a los labios. Ahora va en 1000, que permite estirar y
encoger el audio de forma continua -un 2% como maximo, inaudible- para seguir
la deriva segun aparece.

## 0.6.29 (2026-08-18)

Muchos mas partidos con canal. La agenda anuncia el canal a secas -"DAZN" en
151 de 661 partidos- y eso no casaba con ninguno de tus DAZN 1, DAZN 2 o
DAZN 1 720p: la guarda que impide confundir DAZN 1 con DAZN 2 descartaba
tambien la familia entera, asi que el partido salia como si no hubiera canal.
Ahora pedir el canal a secas ofrece toda su familia numerada. Medido sobre
catorce dias: los partidos con canal reconocido pasan de 63 a 177, y las
señales ofrecidas por partido de 7,1 a 15,8.
Se ofrecen, pero no se reproduce ninguna a ciegas: eliges tu desde el
selector. Y lo que ya estaba protegido sigue igual: DAZN 1 no casa con
DAZN 2, y LaLiga TV no trae Hypermotion, porque ahi lo que sobra es una
palabra y no un numero de canal.

## 0.6.28 (2026-08-18)

Se acaba el parpadeo. Al elegir un canal, la biblioteca entera desaparecia y
volvia con su animacion de entrada; al dar a reproducir un partido, igual con
la agenda. Era porque la marca de "en pantalla" y el estado "buscando" iban
cocidos en el html, asi que cambiarlos obligaba a rehacer la lista completa.
Ahora esas dos cosas son solo una clase: la lista no se toca. Medido: cero
reconstrucciones donde antes habia una por cada cambio de estado.

## 0.6.27 (2026-08-18)

Se acaba el spam de avisos. Una señal inestable encadenaba baches y cada uno
soltaba su propio aviso: llegaban a apilarse catorce iguales tapando medio
video. Ahora un mensaje repetido no se apila, se le renueva el tiempo y se le
pone un contador, y nunca hay mas de tres avisos a la vez. Ademas el aviso de
buffer se da una vez por canal en lugar de en cada bache, que la barra de
estado ya dice "rellenando" todo el rato.
La competicion y la etiqueta de tiempo pasan a compartir linea, en vez de
gastar la insignia una linea entera para ella sola. La fila baja de 115 a 111
px y caben 5,3 partidos en vez de 5,1. Si no cabe -en el movil con nombres de
competicion largos- la insignia baja de linea, antes que recortar la
competicion y dejarla en "UEFA Champio...".

## 0.6.26 (2026-08-18)

El canal que suena se ve siempre. Su nombre estaba solo en la capa flotante
del video, que aparece al pasar el raton: en el movil no se veia nunca y en
el ordenador solo si movias el raton. Ahora hay una barra fija justo debajo
del video con el nombre del canal, y el selector de fuentes vive dentro de
ella. Al saltar de fuente el nombre cambia al instante, sin esperar a que
arranque la señal nueva, asi que se ve de cual estas tirando. Los nombres
largos se recortan con puntos en vez de empujar el selector fuera de la caja.

## 0.6.25 (2026-08-18)

Marcadores en vivo en la agenda. Los partidos que se estan jugando muestran
el resultado y el minuto, y los que acaban de terminar su resultado final.
Los datos salen de ESPN, que sirve con menos de ocho segundos de caché, asi
que el marcador va practicamente en directo: se consulta cada ocho segundos
mientras haya algo en juego y cada cuarenta y cinco cuando solo quedan
partidos por empezar.
El partido que estas VIENDO sale tapado a proposito, con un "ver marcador"
que lo destapa al tocarlo. AceStream va por detras de la emision real, asi
que un marcador instantaneo te cantaria el gol antes de que lo vieras en
pantalla. Al cambiar de canal vuelve a taparse.
El cruce entre la agenda y los marcadores se hace por hora de saque y nombre
de equipo, con alias para los clubes que cada web escribe distinto -"O.
Lyonnais" frente a "Lyon"-. Medido sobre los partidos de un dia: cruzan todos
los que ESPN cubre. Las competiciones que no cubre siguen apareciendo en la
agenda, simplemente sin marcador.

Tambien arregla el desplazamiento de la portada. La agenda y la biblioteca crecian
hasta el alto de todo su contenido, asi que la rueda del raton sobre una caja
no hacia nada: lo que se desplazaba era la pagina entera, kilometros hacia
abajo al elegir "Todos". Ahora cada caja mide lo que la pantalla, muestra unos
cinco partidos y rueda por dentro. De paso la portada se compacta -sin los
subtitulos, que el rotulo ya dice de que va cada caja- para que quepan esos
cinco sin apretar. En el movil cada lista mantiene su altura util en vez de
encadenar una pagina interminable.

## 0.6.23 (2026-08-18)

Se retira el cambio automatico de fuente: el salto lo decides tu desde el
selector. Si una señal no arranca, la app te avisa y te dice cuantas
alternativas tienes para ese canal, pero no cambia nada por su cuenta.

## 0.6.22 (2026-08-18)

Corrige que la lista de fuentes se encogiera sola: bastaba un reintento
automatico para que las señales encontradas por la agenda se redujeran a las
del M3U. Ahora la lista solo se recalcula al cambiar de canal de verdad.
Ademas el motor sube a 4 GB de limite y 1,5 GB de buffer en vivo, que hay
memoria de sobra, para aguantar mejor los enjambres con pocos pares.

## 0.6.21 (2026-08-18)

Corrige que en un partido de Champions aparecieran canales de Segunda entre
las opciones. Y al dar a reproducir ya no pregunta: arranca el mejor y desde
el selector de fuentes cambias de señal cuando quieras.

## 0.6.20 (2026-08-18)

Mas fuentes por canal y salto automatico. Al resolver un partido se consultan
ahora TODAS las capas -vinculos guardados, todas tus listas M3U y el buscador
del motor- en vez de parar en la primera coincidencia buena, asi que se
reunen muchas mas señales del mismo canal. Y si la que estas viendo no
arranca, la app salta sola a la siguiente en vez de reintentar la misma y
quedarse en Conectando. Cuando ninguna responde te lo dice claramente, en
lugar de dejarte esperando.

## 0.6.19 (2026-08-18)

Correcciones de uso real en el iPhone. La cabecera respeta el area del notch,
asi que el boton de volver deja de quedar debajo de la muesca. Se quitan las
lineas de fondo, que se dibujaban por encima del video y ensuciaban la
imagen del canal. Ya no avisa de que esta conectado al backend en cada
arranque. Y lo principal: cuando un canal tiene varias señales de AceStream
se conservan todas y aparece un selector para saltar a otra si la que ves va
borrosa o se cae, en vez de descartarlas y tener que volver a buscar.

## 0.6.18 (2026-08-18)

Rediseño completo y app instalable en el movil. La aplicacion pasa a tener
dos pantallas: al entrar ves la agenda y la biblioteca en paralelo para
decidir que ver, y al reproducir saltas al visionado con el video y el panel
al lado. Nuevo lenguaje visual de terminal: rejilla rigida, monoespaciada y
un unico acento rojo. Se puede añadir a la pantalla de inicio del movil y
abrir como una app, con icono propio y sin barra del navegador. Los partidos
avisan de si estan en directo o cuanto falta, y el reproductor en reposo dice
si el motor esta listo. Al volver al inicio se libera el motor, que solo
admite una reproduccion a la vez. Corrige que el modal de ajustes se saliera
de la pantalla, que los ajustes pudieran quedarse sin salida si fallaba el
guardado, una fuga de temporizadores al zapear y que la agenda no detectara
los canales renombrados. Sube a 500 el limite de canales por lista.

## 0.6.17 (2026-08-18)

La agenda pasa a futbolenlatv.com, que cubre todos los operadores y no solo
la parrilla de Movistar: 639 partidos en catorce dias. El calendario se amplia
de 5 a 14 dias y la barra de fechas gana flechas, porque los ultimos dias
quedaban fuera de alcance. Las competiciones que eliges ahora deciden que
partidos se listan y tus equipos favoritos ya no filtran: resaltan su partido
dentro de esa lista. Se corrige de paso que elegir "LaLiga" trajera Segunda en
vez de Primera. Las listas M3U se emparejan tambien por tvg-id, asi que las
que rotulan el canal con coletilla del proveedor vuelven a reproducirse solas.
Se añade LaLiga Hypermotion como competicion elegible. Si futbolenlatv falla,
la agenda cae a la EPG de Movistar+ y luego a TheSportsDB.

## 0.6.16 (2026-08-18)

La agenda pasa a leerse de la EPG publica de Movistar+ en vez de TheSportsDB.
Es la parrilla real de lo que se emite en España, asi que aparecen todos los
partidos y no uno al dia: medido, 33 partidos en cinco dias frente a 5. Cada
partido trae su canal exacto -que coincide con el nombre de las listas M3U-,
la hora peninsular y la competicion de verdad. Si la EPG falla, la agenda cae
automaticamente a TheSportsDB como antes.
Ademas, nueva disposicion en pantallas anchas: la agenda pasa a una columna fija a la
derecha del video, con su propio scroll, asi se lee sin perder de vista la
reproduccion. Las filas de partido se compactan segun el ancho disponible, de
modo que la misma vista sirve para el movil y para la columna lateral. Por
debajo de 1200 px todo se apila como antes.
Incluye los arreglos previos de la agenda de futbol: las horas se mostraban
en UTC bajo la etiqueta
"horario peninsular", asi que todos los partidos salian 2 h antes en verano y
1 h en invierno; ahora se convierten a hora de Madrid y los de madrugada ya
aparecen en el dia correcto. La competicion ya no es siempre "Futbol", asi que
el filtro por liga de las preferencias vuelve a funcionar. Y un canal que solo
cambia una palabra deja de recomendarse por otro: LaLiga TV Hypermotion ya no
se confunde con LaLiga TV, aunque sigue pudiendo elegirse a mano. Incluye la
reparacion de la reproduccion en ordenador de la 0.6.13. No cambia la
biblioteca, las preferencias ni el historial.

## 0.6.15 (2026-08-18)

Nueva disposicion en pantallas anchas: la agenda pasa a una columna fija a la
derecha del video, con su propio scroll, asi se lee sin perder de vista la
reproduccion. Las filas de partido se compactan segun el ancho disponible, de
modo que la misma vista sirve para el movil y para la columna lateral. Por
debajo de 1200 px todo se apila como antes.
Incluye los arreglos previos de la agenda de futbol: las horas se mostraban
en UTC bajo la etiqueta
"horario peninsular", asi que todos los partidos salian 2 h antes en verano y
1 h en invierno; ahora se convierten a hora de Madrid y los de madrugada ya
aparecen en el dia correcto. La competicion ya no es siempre "Futbol", asi que
el filtro por liga de las preferencias vuelve a funcionar. Y un canal que solo
cambia una palabra deja de recomendarse por otro: LaLiga TV Hypermotion ya no
se confunde con LaLiga TV, aunque sigue pudiendo elegirse a mano. Incluye la
reparacion de la reproduccion en ordenador de la 0.6.13. No cambia la
biblioteca, las preferencias ni el historial.

## 0.6.14 (2026-08-17)

Arregla la agenda de futbol. Las horas se mostraban en UTC bajo la etiqueta
"horario peninsular", asi que todos los partidos salian 2 h antes en verano y
1 h en invierno; ahora se convierten a hora de Madrid y los de madrugada ya
aparecen en el dia correcto. La competicion ya no es siempre "Futbol", asi que
el filtro por liga de las preferencias vuelve a funcionar. Y un canal que solo
cambia una palabra deja de recomendarse por otro: LaLiga TV Hypermotion ya no
se confunde con LaLiga TV, aunque sigue pudiendo elegirse a mano. Incluye la
reparacion de la reproduccion en ordenador de la 0.6.13. No cambia la
biblioteca, las preferencias ni el historial.

## 0.6.13 (2026-08-17)

Repara la reproduccion en ordenador. Desde la 0.6.9 el reproductor recibia la
URL del stream en forma relativa, y el worker de mpegts.js (blob:) no puede
resolverla: la descarga fallaba al instante y el canal acababa en "pocos pares
o emision caida" tras tres reenganches. Ahora al reproductor siempre se le
pasa la URL absoluta. El iPhone no estaba afectado porque usa el adaptador
fMP4. No cambia la biblioteca, las preferencias ni el historial.

## 0.6.12 (2026-08-17)

Hace permanente la reparacion de actualizaciones mediante el hook nativo de
pre-arranque de Umbrel. El NAS verifica la release 0.6.12, la restaura desde
la tienda local y usa su tag inmutable como respaldo, sin cronjobs y sin tocar
la biblioteca, las preferencias ni el historial.

## 0.6.11 (2026-08-17)

Corrige el arranque de reparacion introducido en la 0.6.10: la descarga y la
extraccion de la release se ejecutan ahora como una unica orden antes de
iniciar el backend y Nginx. Si umbrelOS no copia la carpeta 0.6.11 durante la
actualizacion, Ace Player Neo la restaura desde su tag inmutable sin tocar la
biblioteca, las preferencias ni el historial.

## 0.6.10 (2026-08-17)

Corrige una actualizacion rota en la que umbrelOS aplicaba el Compose nuevo
sin copiar la carpeta de la release: ahora Ace Player Neo garantiza la 0.6.10
desde un tag inmutable antes de iniciar el backend y Nginx. Conserva la agenda
de futbol personalizada, las preferencias de ligas, equipos y nacionalidades,
la busqueda automatica en M3U y AceStream y la navegacion movil flotante de la
0.6.9, junto con sus mejoras de reproduccion, sincronizacion y seguridad.

## 0.6.9 (2026-08-16)

Anade una agenda de futbol personalizada: en el primer uso permite elegir
ligas, equipos y nacionalidades, cruza cada canal con los directorios M3U y
el buscador de AceStream, reproduce coincidencias fiables y permite vincular
manualmente un Content ID cuando no encuentra ninguna. Incluye una nueva
navegacion movil flotante. Tambien corrige renombres y borrados del
directorio, evita que dos dispositivos se pisen la biblioteca y hace fiable
el traspaso de
reproduccion. HLS precarga, reintenta fallos transitorios y reutiliza una sola
sesion del motor; el remux de iOS sirve segmentos por streaming y se detiene
sin afectar a otro equipo. Limita URLs peligrosas, aisla el socket de Docker
y actualiza Node y Nginx a versiones soportadas y fijadas por digest.

## 0.6.8 (2026-08-07)

Reproduccion P2P mas estable y con menos cortes: nuevos perfiles
Equilibrado, Estable y Baja latencia, precarga real antes de arrancar,
recuperacion de buffer sin saltar al directo ni reiniciar la sesion
demasiado pronto, buffering interno del motor, puerto P2P dedicado y una
biblioteca de directorios que conserva varias fuentes y sus listas.

## 0.6.7 (2026-07-12)

Arreglada la desincronizacion entre audio y video en iPhone/iPad: los
directos traen huecos y saltos de reloj y al recodificar el audio se
iba acumulando deriva respecto al video. Ahora ffmpeg compensa esos
huecos al vuelo (aresample async) y descarta paquetes corruptos, asi
que el audio queda clavado a la imagen.

## 0.6.6 (2026-07-12)

Los canales HEVC (H.265) ya se ven en iPhone/iPad: el player web de
Apple rechaza HEVC dentro de segmentos TS, asi que si un canal no
arranca en iOS la app lo re-empaqueta al vuelo a fMP4 con ffmpeg (sin
transcodificar, CPU minima) y lo reproduce adaptado. Incluye todo lo
de la 0.6.5: iPhone con reproductor nativo fino, traspaso de
reproduccion entre dispositivos estilo Spotify, stats y cierre de
sesion tambien en movil.

## 0.6.5 (2026-07-12)

Arregla la reproduccion en iPhone/iPad: iOS ahora usa siempre la ruta
HLS correcta (mpegts no funciona en iOS aunque diga que si), con
estadisticas, cierre limpio de sesion y mensajes de error detallados
tambien en movil. Nuevo traspaso de reproduccion entre dispositivos
estilo Spotify: si le das al play en el movil mientras el PC reproduce,
el PC se detiene solo con un aviso (el motor AceStream solo alimenta a
un dispositivo a la vez). Incluye el rediseno 0.6.4 y el arreglo del
boton de copiar en HTTP.

## 0.6.4 (2026-07-12)

Rediseno completo "sala de cine": pagina vertical con el reproductor
como protagonista, barra superior flotante, y la biblioteca como
parrilla de tarjetas grandes por canal (con acciones al pasar el raton
y categoria desplegable en el directorio). Paleta fria premium con
acento cian. Movil de verdad: controles del player debajo del video
(compatibles con los controles nativos de iOS), navegacion inferior
por scroll, tarjetas a dos columnas y pantalla despejada. Fuentes
autoalojadas: ya no queda ninguna dependencia de CDN.

## 0.6.3 (2026-07-12)

Estabilidad de reproduccion: al cambiar de canal se avisa al motor para
que pare la sesion anterior (adios descargas zombis que robaban ancho de
banda y RAM), el motor usa cache en disco con limites de memoria y de
subida P2P, un vigilante salta al directo o reengancha el canal solo si
el video se atasca, se reengancha automaticamente si el motor se
reinicia, y las estadisticas (pares/velocidad) reintentan hasta salir.

## 0.6.2 (2026-07-12)

Arregla que ningun resultado del buscador reproducia: el motor devuelve
infohashes y se estaban tratando como Content IDs; ahora se reproducen
con el parametro correcto (tambien al guardarlos en favoritos). Incluye
la pestana "Buscar" (0.6.0), el sistema de releases/ para que las
actualizaciones apliquen de verdad (0.6.1) y las librerias de
reproduccion incluidas sin CDN externo (0.5.2).

## 0.6.1 (2026-07-12)

Arregla que las actualizaciones no aplicaran los cambios (umbrelOS no
sobreescribe archivos existentes: ahora cada version va en su propia
carpeta releases/). Incluye lo de 0.6.0: nueva pestana "Buscar" para
buscar canales por nombre en el motor AceStream (con disponibilidad de
cada stream), reproducirlos o guardarlos en favoritos sin tocar un hash.
Y lo de 0.5.2: hls.js y mpegts.js incluidos en la app, sin CDN externo.

## 0.6.0 (2026-07-12)

Nueva pestana "Buscar": busca canales publicados en el motor AceStream por
nombre (con disponibilidad de cada stream) y reproducelos o guardalos en
favoritos sin tocar un hash. Ademas, desde la 0.5.2 las librerias de
reproduccion van incluidas en la app (sin CDN externo).

## 0.5.2 (2026-07-12)

Las librerias de reproduccion (hls.js y mpegts.js) ahora van incluidas en la
app en vez de cargarse de un CDN externo: la app funciona 100% autoalojada
y ya no depende de internet para reproducir. Sin cambios visuales.

## 0.5.1 (2026-07-04)

Corrige el aviso "toca para reproducir" que aparecia aunque el canal ya
estuviera reproduciendose (solo se muestra ya si el navegador bloquea el
autoplay, y desaparece solo al arrancar el video). Incluye el rework 0.5.0:
diseno violeta, reproductor 16:9, boton LIVE para volver al directo,
estadisticas visibles, zapping, PiP, atajos y modos Estable/Baja latencia
con auto-recuperacion de buffer.

## 0.5.0 (2026-07-04)

Rework completo de la interfaz (ACE-NEO): nuevo diseno violeta sin
React/Tailwind por CDN (carga mucho mas rapida), reproductor 16:9 con
controles flotantes, barra de estadisticas siempre visible (pares y
velocidad), boton LIVE para volver al directo tras una pausa o retraso,
zapping entre canales, Picture-in-Picture, atajos de teclado y modo de
reproduccion Estable/Baja latencia con auto-recuperacion de buffer que
elimina los cortes en canales con pocos pares.
