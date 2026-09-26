/* Lo que se le pregunta al motor AceStream desde la pestaña Buscar
   (docs/iptv.md §20). Puro.

   El motor busca por el texto tal cual: con una errata («telecinko») o un
   alias («t5», «champions») no encuentra nada o encuentra otra cosa. Se le
   pregunta SIEMPRE lo escrito y, además (como mucho una consulta más):
   - si la consulta lleva un alias, el nombre de siempre del grupo («t5» →
     «Telecinco», «champions» → «Liga de Campeones»);
   - si no, y alguna palabra no casa con nada de lo que conocemos (tu IPTV,
     tu biblioteca y los nombres «de verdad» de la tabla de alias), la
     consulta con la errata corregida («telecinko» → «telecinco»). Con menos
     de 6 letras solo si suena igual («dasn» → «dazn»): el motor conoce
     canales que nosotros no («roma» nunca pasa a ser otra cosa).
   Lo escrito va primero y lo añadido detrás, sin repetir.

   Solo para la pestaña Buscar (`/api/v1/search`). Las búsquedas de la
   resolución de un partido (`search.search` con `via: 'auto'`) no pasan por
   aquí: el emparejado automático sigue estricto y sin erratas. */

import {
  FuzzyVocabulary,
  SEARCH_ALIASES,
  aliasDisplayWords,
  canonicalAliasText,
  displayQuery,
  searchFold,
  searchWords,
  type SearchResult,
} from '@ace/shared';

export interface EngineQueryPlan {
  /** La consulta con las erratas corregidas, o null si no hay nada que corregir. */
  readonly corrected: string | null;
  /** El nombre de siempre del alias que lleva la consulta, o null. */
  readonly alias: string | null;
  /** Lo que se pregunta además de lo escrito (el alias o, si no hay, lo corregido), o null. */
  readonly extra: string | null;
}

let NAMES_VOCABULARY: FuzzyVocabulary | null = null;

/** Las palabras de los nombres «de verdad» de la tabla de alias (sin los «~»: códigos y apodos). */
export function aliasNamesVocabulary(): FuzzyVocabulary {
  NAMES_VOCABULARY ??= new FuzzyVocabulary(
    SEARCH_ALIASES.flatMap((group) =>
      group.names.filter((name) => !name.startsWith('~')).flatMap((name) => searchWords(name)),
    ),
  );
  return NAMES_VOCABULARY;
}

/** Vocabulario de unos títulos (la biblioteca): sus palabras, con su frecuencia. */
export function titlesVocabulary(titles: Iterable<string>): FuzzyVocabulary {
  const weights = new Map<string, number>();
  for (const title of titles) {
    for (const word of new Set(searchWords(title))) weights.set(word, (weights.get(word) ?? 0) + 1);
  }
  return new FuzzyVocabulary(weights.keys(), weights);
}

/*
 * Corrige cada palabra contra varios vocabularios: se queda si casa con
 * alguno (exacta o por el principio); si no, la corrección más cercana de
 * todos (y, a igual distancia, la del primero). `strict`: con menos de 6
 * letras, solo lo que suena igual (distancia 0).
 */
function correctAcross(
  query: string,
  vocabularies: readonly FuzzyVocabulary[],
  options: { readonly extra: number; readonly strict: boolean },
): { text: string; changed: boolean } {
  const words = searchWords(query);
  let changed = false;
  const out = words.map((word) => {
    if (/\d/.test(word) || vocabularies.some((vocabulary) => vocabulary.matchesPlain(word))) {
      return word;
    }
    let best: { token: string; distance: number } | null = null;
    for (const vocabulary of vocabularies) {
      const [found] = vocabulary.corrections(word, { max: 1, extra: options.extra });
      if (!found) continue;
      if (options.strict && word.length < 6 && found.distance > 0) continue;
      if (!best || found.distance < best.distance) best = found;
    }
    if (!best) return word;
    changed = true;
    return best.token;
  });
  return { text: out.join(' '), changed };
}

/** Qué preguntar al motor (ver la cabecera). */
export function planEngineQuery(
  query: string,
  vocabularies: readonly FuzzyVocabulary[],
): EngineQueryPlan {
  const alias = canonicalAliasText(query);
  const all = [...vocabularies, aliasNamesVocabulary()];
  const fixed = correctAcross(query, all, { extra: 0, strict: true });
  const corrected = fixed.changed ? fixed.text : null;
  const aliasOfFixed = !alias && corrected ? canonicalAliasText(corrected) : null;
  const extra = alias ?? aliasOfFixed ?? corrected;
  return {
    corrected,
    alias: alias ?? aliasOfFixed,
    extra: extra && searchFold(extra) !== searchFold(query) ? extra : null,
  };
}

/**
 * «Quizás quisiste decir» para el motor: con un error más de tolerancia;
 * null si no cambia nada. Escrito como en la tabla de alias o, si no, como
 * en `displays` (tu biblioteca, tu IPTV): «Telecinco», no «telecinco».
 */
export function suggestEngineQuery(
  query: string,
  vocabularies: readonly FuzzyVocabulary[],
  displays: readonly ReadonlyMap<string, string>[] = [],
): string | null {
  const fixed = correctAcross(query, [...vocabularies, aliasNamesVocabulary()], {
    extra: 1,
    strict: false,
  });
  return fixed.changed ? displayQuery(fixed.text, [aliasDisplayWords(), ...displays]) : null;
}

/**
 * Junta la respuesta de lo escrito con la de lo añadido: lo escrito primero,
 * lo añadido detrás y sin repetir (por id), 100 como mucho.
 */
export function mergeEngineResults(
  first: readonly SearchResult[],
  second: readonly SearchResult[],
): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const result of [...first, ...second]) {
    if (seen.has(result.id)) continue;
    seen.add(result.id);
    out.push(result);
    if (out.length >= 100) break;
  }
  return out;
}
