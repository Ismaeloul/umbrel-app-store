# Notas preparadas para la 0.8.1 (sin publicar)

El CHANGELOG de la app vive en el paquete de la tienda
(`ismaeloul-ace-player-neo/CHANGELOG.md`), que solo se toca al publicar. Hasta
entonces, la entrada de la 0.8.1 se prepara aquí; al montar la release se copia
tal cual en el CHANGELOG y en `releaseNotes` de `umbrel-app.yml`, con su fecha.
La versión NO está subida.

---

## 0.8.1 (sin fecha)

Tu IPTV, primero. En Ajustes > IPTV, desde el navegador del ordenador, puedes
conectar una lista M3U (su direccion) o una cuenta Xtream Codes (servidor,
usuario y contraseña). Se guarda cifrada en tu Umbrel y no vuelve a salir de
ahi: ni al navegador, ni al iPhone, ni a los registros. En el iPhone no hay
nada que configurar.

Cuando un partido de la agenda se ve por un canal que esta en tu IPTV (por
ejemplo DAZN LaLiga), o tocas un canal que tambien tienes en ella (por ejemplo
Antena 3), sale primero la IPTV, con su distintivo en el selector de fuentes.
El comprobador sigue verificando las fuentes de AceStream por detras.

Si uno no va, va el otro: si la IPTV se cae, sigue sola por la mejor fuente de
AceStream verificada, te avisa y vuelves a la IPTV con un toque ("Volver a la
IPTV"). Si falla AceStream y tienes IPTV, pasa a la IPTV. Cambiar a mano es un
toque en el selector.

El video de la IPTV pasa siempre por tu Umbrel, convertido a HLS: en el
navegador se reproduce con hls.js y en el iPhone como cualquier otro canal.

Si tu lista trae guia de programas (XMLTV), tu Umbrel la usa por dentro para
encontrar el canal que de verdad echa cada partido, aunque la agenda no lo
sepa; las repeticiones, los resumenes y las previas no cuentan. No hay
pantallas nuevas: como mucho, una linea con el estado de la guia en Ajustes >
IPTV. Sin guia, todo funciona igual.

La app emparejada del iPhone puede usar Salud, Dispositivos y "Un solo
dispositivo a la vez", y revocar otros iPhone o a si misma. El codigo QR de
emparejar lleva tambien tu otra direccion (casa y Tailscale).

Varios dispositivos a la vez. Tu Umbrel sigue poniendo un canal para toda la
casa (AceStream o IPTV), pero ahora se nota menos: si cambias de canal mientras
en otro dispositivo se ve algo, el navegador te pregunta "Cambiar en los dos" o
"Solo aqui". Con "Cambiar en los dos", el otro pasa solo al canal nuevo. Con
"Solo aqui", el otro deja de verlo con un aviso claro ("En el PC han cambiado a
Antena 3") y un toque para ver lo mismo o volver a lo suyo. Arriba sale una
capsula pequeña con lo que se ve en el otro ("En el iPhone · DAZN LaLiga"); al
tocarla lo ves tambien donde estas. Con un solo dispositivo no sale nada, y con
"Un solo dispositivo a la vez" encendido manda el ultimo, como antes. La app del
iPhone lo tendra en su proxima version; la de ahora se para como siempre.

Los tres modos tambien con la IPTV. En el navegador la IPTV va a unos 4, 6 o
10 s por detras segun el modo ("Baja latencia" se queda en 4 s y no en 3: con
3 s se paraba de vez en cuando). Tu Umbrel corta ahora el video del iPhone en
trozos tan cortos como deja cada canal (uno por fotograma clave, normalmente de
1 s), pero la app del iPhone de ahora sigue con su margen de siempre (4, 8 o
12 s por detras): acercarla mas al directo se hara con la proxima app, cuando
se haya medido que el iPhone lo aguanta sin pararse. Si el PC y el iPhone ven a
la vez el mismo canal de AceStream, los dos siguen unos 15 s por detras: esta
version no lo mejora. Con canales de fotograma clave corto la IPTV arranca antes
(unos 7 s sin colchon del proveedor, antes 15-20 s); con fotogramas clave largos
(4-10 s, habitual en IPTV que recodifican) tarda de 10 a 20 s, como antes. Las
apps 0.6 siguen arrancando con el margen de siempre, pero tras un paron pueden
quedarse mas cerca del directo (y pararse algo mas con redes P2P justas).
