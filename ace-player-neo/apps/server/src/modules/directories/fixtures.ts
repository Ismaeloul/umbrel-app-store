/* Listas inventadas para los tests de los parsers (hoy no existían:
   comportamientos-tests §3.2). Imitan lo que se ve en los directorios reales:
   la lista de NEW ERA en IPFS (tvg-id, group-title, coletillas "-->"), listas
   con CRLF, enlaces `getstream?id=`, y páginas HTML con enlaces
   `acestream://`, `?id=` y `&content_id=`. */

const H = (character: string): string => character.repeat(40);

export const HASHES = {
  dazn1: H('1'),
  dazn2: H('2'),
  m1: H('3'),
  laliga: H('4'),
  eurosport: H('5'),
  sinNombre: H('6'),
  mayusculas: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
  html1: H('7'),
  html2: H('8'),
  html3: H('9'),
  suelto: H('d'),
  query: H('e'),
} as const;

/** Lista estilo NEW ERA: `tvg-id` canónico y título con coletilla del proveedor. */
export const M3U_NEW_ERA = [
  '#EXTM3U url-tvg="https://epg.example/guia.xml"',
  `#EXTINF:-1 tvg-id="DAZN 1 HD" tvg-logo="https://logo.example/dazn1.png" group-title="DAZN",DAZN 1 --> NEW ERA`,
  `acestream://${HASHES.dazn1}`,
  '',
  `#EXTINF:-1 tvg-id="DAZN 2 HD" group-title="DAZN",DAZN 2 --> NEW ERA, 1080p`,
  `acestream://${HASHES.dazn2}`,
  `#EXTINF:-1 tvg-id="" group-title="Movistar &amp; Deportes",M+ Liga de Campeones &amp; más`,
  `http://127.0.0.1:6878/ace/getstream?id=${HASHES.m1}`,
  '#EXTVLCOPT:network-caching=1000',
  `#EXTINF:-1 tvg-id="LaLiga TV" group-title="LALIGA",<b>LALIGA TV</b>   HYPERMOTION`,
  `  ${HASHES.laliga}  `,
  // repetido: el parser lo deja pasar y la normalización lo quita
  `#EXTINF:-1 group-title="DAZN",DAZN 1 (copia)`,
  `acestream://${HASHES.dazn1}`,
  // sin #EXTINF delante: título por defecto y la categoría del anterior
  `acestream://${HASHES.sinNombre}`,
  `#EXTINF:-1 GROUP-TITLE="Eurosport" TVG-ID="Eurosport 1",Eurosport 1`,
  `acestream://${HASHES.mayusculas}`,
  '#EXTINF:-1,Canal sin enlace',
  'https://example.com/no-es-un-hash',
  '#EXTINF:-1 group-title="",Sin categoría',
  `acestream://${HASHES.eurosport}`,
  '',
].join('\n');

/** Lo mismo con CRLF (listas generadas en Windows). */
export const M3U_CRLF = [
  '#EXTM3U',
  '#EXTINF:-1 group-title="TV",Canal CRLF',
  `acestream://${HASHES.dazn1}`,
  '#EXTINF:-1',
  `acestream://${HASHES.dazn2}`,
].join('\r\n');

/** Página HTML de un agregador: enlaces de varios tipos, texto con etiquetas y un hash suelto. */
export const HTML_AGREGADOR = `<!doctype html>
<html><head><title>Canales</title></head>
<body>
  <ul>
    <li><a class="canal" href="acestream://${HASHES.html1}" target="_blank"><span>DAZN</span>&nbsp;1 &amp; más</a></li>
    <li><a href='https://visor.example/play?id=${HASHES.html2}&amp;hd=1'>
      M+ LaLiga
    </a></li>
    <li><a href="https://visor.example/ver?lang=es&content_id=${HASHES.html3}"></a></li>
    <li><a href="acestream://${HASHES.html1}">DAZN 1 (repetido)</a></li>
    <li><a href="https://example.com/otra-pagina">Sin hash</a></li>
    <li><a href="acestream://corto">Hash roto</a></li>
  </ul>
  <p>Copia y pega: acestream://${HASHES.suelto} o acestream://${HASHES.html2}</p>
  <script>var x = "acestream://${HASHES.query.toUpperCase()}";</script>
</body></html>`;
