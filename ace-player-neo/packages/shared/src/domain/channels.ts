/* Emparejado de nombres de canal, portado FIELMENTE de server.js:496-638.
   Hasta la 0.6.59 había dos copias (servidor e index.html) y un test (T-088)
   que comprobaba que no divergieran; ya pasó una vez y el botón decía
   "Buscar canal" mientras el servidor sí encontraba el canal. Ahora hay una
   sola implementación que importan servidor y web, y la matriz de la 0.6.59
   queda congelada en test/fixtures para que nadie la cambie sin querer. */

/**
 * "Es ese canal, sin duda" (server.js:143). Decide el nivel máximo de la
 * resolución, si existe el canal exacto (y por tanto si se descartan las
 * hermanas numeradas), el filtro de los vínculos guardados, su puntuación
 * mínima y la cabecera de candidatos. Un único umbral con nombre (T-087).
 *
 * Ojo al acoplamiento con la IA: `SEMANTIC_MAX_SCORE` (94) está por encima,
 * así que una promoción semántica cuenta como canal exacto y descarta la
 * familia (T-084). Es a propósito.
 */
export const RESOLUTION_EXACT_SCORE = 92;
/** Puntuación máxima que da la IA a un acierto (server.js:144). */
export const SEMANTIC_MAX_SCORE = 94;
/** Similitud mínima para que la IA promocione (0,86 y no 0,82: server.js:127-131). */
export const SEMANTIC_MIN_SIMILARITY = 0.86;
/** Ventaja mínima sobre el mejor canal no pedido (server.js:146). */
export const SEMANTIC_OTHER_CHANNEL_MARGIN = 0.035;

/** Palabras que sobran o faltan sin cambiar de qué canal hablamos (server.js:513-523). */
export const CHANNEL_FILLER_TOKENS: ReadonlySet<string> = new Set([
  'tv',
  'canal',
  'channel',
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'y',
  'and',
  'en',
  'the',
  'directo',
  'live',
  'senal',
  'opcion',
  /* El operador dice por dónde te llega, no qué estás viendo: "M+ Liga de
     Campeones" y "LIGA DE CAMPEONES" son el mismo canal. Contarlo como
     palabra propia topaba la puntuación en 58 y dejaba fuera media
     biblioteca. Ojo: aquí van PLATAFORMAS, no marcas de canal. DAZN no entra:
     ahí la marca sí es el canal. */
  'movistar',
  'm',
  'orange',
  'vodafone',
  'telecable',
  'plus',
]);

/**
 * Techo para nombres que difieren en una palabra propia: quedan por debajo de
 * recomendar (70) y de reproducir solo (92), pero siguen siendo elegibles.
 */
export const CHANNEL_VARIANT_MAX_SCORE = 58;

/**
 * Pedir "DAZN" a secas no es pedir un canal, es pedir la familia entera: la
 * agenda anuncia así 151 de 661 partidos. Se puntúa 78, que pasa el umbral de
 * recomendado (70) pero NO el de reproducir a ciegas (92).
 */
export const CHANNEL_FAMILY_SCORE = 78;

/**
 * Para ofrecer un canal de TU biblioteca hace falta superar el techo de
 * variante: si no, cualquier canal de la misma familia se cuela.
 */
export const LIBRARY_MIN_SCORE = 70;

export function normalizeChannelKey(value: unknown): string {
  return (
    String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      /* "LIGA DE CAMPEONES --> ELCANO": lo que va tras la flecha es QUIÉN lo
         sirve, no qué canal es. Y los asteriscos solo marcan la copia.
         Tratarlo como parte del nombre convertía al proveedor en palabra
         distintiva y topaba la puntuación en 58. */
      .replace(/\s*(?:--?>|={1,2}>|[→⇒➜➝⟶⟹])\s*.*$/, ' ')
      .replace(/[*#]+/g, ' ')
      .replace(/\bm\s*\+/g, ' movistar ')
      .replace(/\bmovistar\s*plus\+?\b/g, ' movistar ')
      .replace(/\b(full\s*hd|fhd|uhd|hd|sd|4k|1080p|720p)\b/g, ' ')
      .replace(/\b(espana|spain)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  );
}

/* Un token presente en un nombre y ausente en el otro, si no es relleno, es
   justo lo que separa dos canales de la misma familia: "LaLiga TV" es Primera
   y "LaLiga TV Hypermotion" es Segunda. */
export function distinctiveTokens(from: readonly string[], other: readonly string[]): string[] {
  const known = new Set(other);
  return from.filter((token) => !known.has(token) && !CHANNEL_FILLER_TOKENS.has(token));
}

/* Familia: un nombre es el otro más un número de canal -"DAZN" y "DAZN 1"-.
   Si lo que sobra es una PALABRA -"Hypermotion"- no es familia sino otra
   competición. */
export function esCoincidenciaDeFamilia(
  a: string,
  b: string,
  tokensA: readonly string[],
  tokensB: readonly string[],
): boolean {
  if (!(a.includes(b) || b.includes(a))) return false;
  const soloSobranNumeros = (from: readonly string[], other: readonly string[]): boolean => {
    const known = new Set(other);
    const extra = from.filter((token) => !known.has(token));
    return extra.length > 0 && extra.every((token) => /^[0-9]+$/.test(token));
  };
  return soloSobranNumeros(tokensA, tokensB) || soloSobranNumeros(tokensB, tokensA);
}

/** ¿Es `right` de la familia numerada de `left` (o al revés)? Las coletillas de calidad no cuentan (T-059). */
export function esFamiliaDe(left: unknown, right: unknown): boolean {
  const a = normalizeChannelKey(left);
  const b = normalizeChannelKey(right);
  if (!a || !b || a === b) return false;
  return esCoincidenciaDeFamilia(a, b, a.split(' '), b.split(' '));
}

/**
 * Puntuación 0..100 de que `left` y `right` sean el mismo canal
 * (server.js:566-609). 100 = mismo canal; 78 = familia numerada; ≤58 =
 * variante por palabra; 0 = números distintos o nada en común.
 */
export function channelMatchScore(left: unknown, right: unknown): number {
  const a = normalizeChannelKey(left);
  const b = normalizeChannelKey(right);
  if (!a || !b) return 0;
  if (a === b) return 100;
  const numsA = (a.match(/\d+/g) || []).join(',');
  const numsB = (b.match(/\d+/g) || []).join(',');
  /* Dos canales numerados distintos nunca son el mismo: DAZN 1 no es DAZN 2.
     Pero basta con que UN lado lleve número para NO descartar: "DAZN" contra
     los 59 canales DAZN de la biblioteca tiene que dar familia. */
  if (numsA && numsB && numsA !== numsB) return 0;
  const tokensA = a.split(' ');
  const tokensB = b.split(' ');
  /* futbolenlatv usa el nombre comercial ("M+ Liga de Campeones") y las
     listas "M. Liga de Campeones" o "Liga de Campeones": al quitar artículos
     y operador queda el mismo núcleo. Los números siguen dentro del núcleo. */
  const coreA = tokensA.filter((token) => !CHANNEL_FILLER_TOKENS.has(token)).join(' ');
  const coreB = tokensB.filter((token) => !CHANNEL_FILLER_TOKENS.has(token)).join(' ');
  if (coreA && coreA === coreB) return 100;
  if (esCoincidenciaDeFamilia(a, b, tokensA, tokensB)) return CHANNEL_FAMILY_SCORE;
  const variant =
    distinctiveTokens(tokensA, tokensB).length || distinctiveTokens(tokensB, tokensA).length;
  let score: number;
  if (a.includes(b) || b.includes(a)) {
    const shortest = Math.min(tokensA.length, tokensB.length);
    score = shortest >= 2 ? 86 - Math.min(14, Math.abs(a.length - b.length)) : 58;
  } else {
    const setB = new Set(tokensB);
    const shared = tokensA.filter((token) => token.length > 1 && setB.has(token)).length;
    const ratio = shared / Math.max(tokensA.length, tokensB.length);
    score = shared >= 2 && ratio >= 0.6 ? Math.round(58 + ratio * 24) : 0;
  }
  /* Sin descartarlo: "DAZN Eventos" sigue siendo una opción válida cuando
     buscas "DAZN". Pero al topar en 58 no alcanza ni recomendado (70) ni
     reproducir solo (92). */
  return variant ? Math.min(score, CHANNEL_VARIANT_MAX_SCORE) : score;
}

/* La IA no decide si un 1 es un 3. Para el embedding se quitan operador,
   artículos, calidad, proveedor y dial: "M+ LIGA DE CAMPEONES 1 FHD -->
   ELCANO" queda "liga campeones" (server.js:611-615). */
export function semanticChannelText(value: unknown): string {
  return normalizeChannelKey(value)
    .split(' ')
    .filter((token) => token && !CHANNEL_FILLER_TOKENS.has(token) && !/^\d+$/.test(token))
    .join(' ');
}

export function channelDialNumbers(value: unknown): string[] {
  return normalizeChannelKey(value)
    .split(' ')
    .filter((token) => /^\d+$/.test(token));
}

/** ¿Deja la regla de diales que la IA empareje este candidato con este canal programado? (server.js:621-632) */
export function semanticNumbersCompatible(
  programChannel: unknown,
  candidateName: unknown,
): boolean {
  const wanted = channelDialNumbers(programChannel);
  const offered = channelDialNumbers(candidateName);
  if (wanted.length && offered.length) return wanted.join(',') === offered.join(',');
  /* Un nombre programado sin dial es el canal principal: la IA nunca puede
     convertirlo en el 2 o el 3. */
  if (!wanted.length && offered.length) return false;
  /* "... 1" y el rótulo sin número suelen ser la misma señal principal. */
  if (wanted.length && !offered.length) return wanted.every((number) => number === '1');
  return true;
}

/* futbolenlatv usa "DAZN" como marca paraguas sin dial. "M+ LALIGA" o "M+
   Liga de Campeones" son canales concretos: su 2 y su 3 emiten otros
   partidos y no son un sustituto válido (server.js:634-639). */
export function channelAllowsFamilyFallback(value: unknown): boolean {
  return semanticChannelText(value) === 'dazn';
}
