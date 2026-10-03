/* Lo que tiene que dar el buscador con el corpus de canales-iptv.ts
   (0.9.0, docs/buscador.md): consulta → los primeros resultados, en orden.
   Lo usan la prueba del módulo puro (packages/shared/test/name-search.test.ts)
   y las del servidor (Buscar y la pestaña IPTV de Canales).

   Cada resultado esperado se escribe con las palabras que cuentan del nombre
   (`nameFactsOf(nombre).sig`: sin país, calidad, «tv» ni adornos) y, si no
   es de España ni sin país, «/PAÍS» detrás: «la 1», «dazn 1/DE». Varias
   opciones posibles van con «|» («la 1 canarias|la 1 catalunya»: cualquiera
   de las dos vale en ese puesto). Solo se comprueban los puestos escritos:
   lo que venga detrás da igual. `nunca` son resultados que no pueden salir
   antes del primero esperado (ni, si se escribe `fuera`, en ningún sitio). */

import { expect } from 'vitest';

export interface Esperado {
  readonly q: string;
  readonly top: readonly string[];
  /** No pueden salir antes que `top[0]`. */
  readonly nunca?: readonly string[];
  /** No pueden salir en ningún puesto. */
  readonly fuera?: readonly string[];
}

const LA1_TOP = ['la 1', 'la 1 canarias|la 1 catalunya', 'la 1 canarias|la 1 catalunya'];
const LA1_NUNCA = ['la 10', 'laliga 1', 'laligaplus ppv 1', 'la 100 radio', 'latino sports 1/LAT'];

export const ESPERADOS: readonly Esperado[] = [
  /* La 1 como la escribe cualquiera, y lo que se le parece. */
  { q: 'la 1', top: LA1_TOP, nunca: LA1_NUNCA, fuera: ['la 10', 'la 100 radio'] },
  { q: 'La 1', top: LA1_TOP, nunca: LA1_NUNCA },
  { q: 'la1', top: LA1_TOP, nunca: LA1_NUNCA, fuera: ['la 10'] },
  { q: 'la uno', top: LA1_TOP, nunca: LA1_NUNCA },
  { q: 'ES: LA 1 4K', top: LA1_TOP, nunca: LA1_NUNCA },
  { q: '|ES| LA 1 FHD', top: LA1_TOP, nunca: LA1_NUNCA },
  { q: 'la 1 hd', top: LA1_TOP, nunca: LA1_NUNCA },
  { q: 'LA1HD', top: LA1_TOP, nunca: LA1_NUNCA },
  { q: 'la 1 tve', top: ['la 1'] },
  { q: 'tve 1', top: ['la 1'] },
  { q: 'la 1 catalunya', top: ['la 1 catalunya'] },
  { q: 'la 2', top: ['la 2', 'la 2 catalunya'], nunca: ['laliga 2'] },
  { q: 'la 10', top: ['la 10'], fuera: ['la 1', 'la 100 radio'] },
  { q: 'la 7', top: ['la 7', 'la 7/IT'] },
  /* Canales numerados con «#»: cada uno su fila (nunca copias de una sola). */
  { q: 'laliga+ ppv 2', top: ['laligaplus ppv 2'] },
  { q: 'ppv #3', top: ['laligaplus ppv 3'] },
  { q: 'dazn ppv', top: ['dazn ppv 1', 'dazn ppv 2'] },
  {
    q: 'nba league pass',
    top: ['nba league pass 1/US', 'nba league pass 2/US', 'nba league pass 3/US'],
  },
  { q: 'eventos', top: ['eventos 1', 'eventos 2'] },
  /* Telecinco con todas sus grafías. El TELE 5 alemán es otro canal: sale detrás con «tele 5», no con «telecinco». */
  { q: 'tele 5', top: ['telecinco', 'tele 5/DE'] },
  { q: 'tele5', top: ['telecinco', 'tele 5/DE'] },
  { q: 'telecinco', top: ['telecinco'], fuera: ['tele 5/DE'] },
  { q: 'tele cinco', top: ['telecinco'], fuera: ['tele 5/DE'] },
  /* Antena 3. */
  { q: 'a3', top: ['antena 3', 'antena 3 internacional', 'antena 3 cnn/RO'] },
  { q: 'antena 3', top: ['antena 3', 'antena 3 internacional', 'antena 3 cnn/RO'] },
  { q: 'antena3', top: ['antena 3', 'antena 3 internacional'] },
  { q: 'a3 series', top: ['atreseries'] },
  /* Movistar y LaLiga. */
  {
    q: 'm+ laliga',
    top: ['movistar laliga', 'movistar laliga 2', 'movistar laliga 2|movistar laliga 3'],
    nunca: ['laliga hypermotion', 'dazn laliga'],
  },
  {
    q: 'movistar laliga',
    top: ['movistar laliga', 'movistar laliga 2', 'movistar laliga 2|movistar laliga 3'],
  },
  { q: 'M. LALIGA', top: ['movistar laliga', 'movistar laliga 2'] },
  { q: 'm laliga', top: ['movistar laliga', 'movistar laliga 2'] },
  { q: 'm+ laliga 2', top: ['movistar laliga 2'], nunca: ['dazn laliga 2', 'laliga 2'] },
  {
    q: 'hypermotion',
    top: [
      'laliga hypermotion',
      'laliga hypermotion 2',
      'laliga hypermotion 2|laliga hypermotion 3',
    ],
  },
  { q: 'laliga tv hypermotion', top: ['laliga hypermotion', 'laliga hypermotion 2'] },
  /* DAZN, los de aquí antes que los de fuera. */
  { q: 'dazn', top: ['dazn 1', 'dazn 2', 'dazn 3'] },
  /* Detrás, «DAZN PPV 1» (de aquí, con las dos palabras en orden) y los DAZN 1 de fuera. */
  {
    q: 'dazn 1',
    top: ['dazn 1', 'dazn 1 bar', 'dazn 1/DE|dazn 1/IT|dazn 1/PT|dazn ppv 1'],
    fuera: ['dazn f1'],
  },
  { q: 'dazn 2', top: ['dazn 2'] },
  { q: 'dazn laliga', top: ['dazn laliga', 'dazn laliga 2'] },
  { q: 'dazn la liga', top: ['dazn laliga', 'dazn laliga 2'] },
  { q: 'dazn f1', top: ['dazn f1'] },
  { q: 'dazn cuatro', top: ['dazn 4'] },
  /* #Vamos, #0 y Movistar Plus+. */
  { q: '#vamos', top: ['vamos', 'movistar vamos'] },
  { q: 'vamos', top: ['vamos', 'movistar vamos'] },
  { q: 'm+ vamos', top: ['movistar vamos', 'vamos'] },
  { q: '#0', top: ['0', 'movistar 0'] },
  { q: 'cero', top: ['0', 'movistar 0'] },
  { q: 'm+ cero', top: ['movistar 0'] },
  { q: 'movistar plus', top: ['movistar'] },
  { q: 'movistar plus+', top: ['movistar'] },
  /* La Liga de Campeones como la llama la gente. */
  {
    q: 'champions',
    top: ['movistar liga de campeones', 'movistar liga de campeones 2'],
  },
  {
    q: 'm+ liga de campeones',
    top: ['movistar liga de campeones', 'movistar liga de campeones 2'],
  },
  { q: 'liga de campeones', top: ['movistar liga de campeones'] },
  /* Las de siempre. */
  { q: 'cuatro', top: ['cuatro'], fuera: ['dazn 4'] },
  { q: 'la sexta', top: ['lasexta'] },
  { q: 'lasexta', top: ['lasexta'] },
  { q: 'laSexta', top: ['lasexta'] },
  { q: 'sexta', top: ['lasexta'] },
  { q: '24 horas', top: ['24h'] },
  { q: '24h', top: ['24h'] },
  { q: 'teledeporte', top: ['teledeporte'] },
  { q: 'tdp', top: ['teledeporte'] },
  { q: 'tv3', top: ['tv3', 'tv3 cat', 'tv3/SE|tv3/DK|tv3/NO|tv3/LT'] },
  { q: 'tv 3', top: ['tv3'] },
  { q: 'real madrid', top: ['real madrid'] },
  { q: 'eurosport', top: ['eurosport 1', 'eurosport 2'] },
  { q: 'gol', top: ['gol', 'gol play'] },
  { q: 'canal sur', top: ['sur'] },
  { q: 'bein', top: ['bein sports'] },
  { q: 'barca', top: ['barca'] },
  { q: 'barça', top: ['barca'] },
  /* Otros países con el mismo nombre corto; el país pedido delante va el primero. */
  { q: 'rai 1', top: ['rai 1/IT'] },
  { q: 'rai uno', top: ['rai 1/IT'] },
  { q: 'bbc 1', top: ['bbc 1/UK'] },
  /* Los números escritos con letra, solos o a medio teclear. */
  { q: 'bbc on', top: ['bbc 1/UK'] },
  { q: 'one', top: ['bbc 1/UK'] },
  { q: 'rai u', top: ['rai 1/IT'] },
  { q: 'uno', top: ['rai 1/IT', 'sky sport 1/IT'] },
  { q: 'uk: laliga tv', top: ['laliga/UK'] },
  { q: 'de: dazn 1', top: ['dazn 1/DE', 'dazn 1'] },
  { q: 'sport 1', top: ['sport 1/DE|sport 1/PT', 'sport 1/DE|sport 1/PT'] },
];

/** Comprueba una fila de esperados.ts contra una lista ya ordenada de etiquetas. */
export function checkEsperado(
  found: readonly string[],
  esperado: { top: readonly string[]; nunca?: readonly string[]; fuera?: readonly string[] },
): void {
  esperado.top.forEach((want, position) => {
    expect(
      want.split('|'),
      `puesto ${position + 1} de ${JSON.stringify(found.slice(0, 6))}`,
    ).toContain(found[position]);
  });
  const first = found.indexOf(
    found.find((item) => esperado.top[0]?.split('|').includes(item)) ?? '',
  );
  for (const never of esperado.nunca ?? []) {
    const at = found.indexOf(never);
    if (at >= 0) expect(at, `«${never}» antes del primero`).toBeGreaterThan(first);
  }
  for (const out of esperado.fuera ?? []) expect(found, `«${out}» no sale`).not.toContain(out);
}
