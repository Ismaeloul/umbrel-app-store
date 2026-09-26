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

Menos retraso en el iPhone y los tres modos tambien con la IPTV. Tu Umbrel corta
el video en trozos tan cortos como deja cada canal (uno por fotograma clave,
normalmente de 1 s): en "Baja latencia" el iPhone pasa de unos 8-11 s a unos 4 s
por detras cuando el canal lo permite, y en el navegador la IPTV va a 3, 6 o 10 s
segun el modo, como AceStream. La IPTV arranca antes. Las apps 0.6 siguen
arrancando con el margen de siempre, pero tras un paron pueden quedarse mas cerca
del directo (y pararse algo mas con redes P2P justas).
