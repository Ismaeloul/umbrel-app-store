import type { Item } from '@ace/shared';

export type VodKind = 'peliculas' | 'series';

const fold = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');

export function classifyVod(item: Pick<Item, 'title' | 'alias' | 'category'>): VodKind | null {
  const text = fold(`${item.category} ${item.title} ${item.alias ?? ''}`);
  if (/\b(series?|temporadas?|seasons?|episodes?|episodios?|capitulos?|s\d{1,2}e\d{1,2}|t\d{1,2}e\d{1,2})\b/.test(text)) {
    return 'series';
  }
  if (/\b(peliculas?|cine|movies?|films?)\b/.test(text)) return 'peliculas';
  return null;
}

const LANGUAGES = [
  { label: 'Alemán', aliases: ['aleman', 'german', 'deutsch', 'deu', 'ger', 'de', 'de-de'] },
  { label: 'Árabe', aliases: ['arabe', 'arabic', 'ara', 'ar'] },
  { label: 'Catalán', aliases: ['catalan', 'catala', 'catalan-valenciano', 'cat', 'ca', 'ca-es'] },
  { label: 'Chino', aliases: ['chino', 'chinese', 'zho', 'chi', 'zh'] },
  { label: 'Español', aliases: ['espanol', 'castellano', 'spanish', 'latino', 'latam', 'spa', 'esp', 'es', 'es-es', 'es-mx'] },
  { label: 'Francés', aliases: ['frances', 'french', 'francais', 'fra', 'fre', 'fr', 'fr-fr'] },
  { label: 'Inglés', aliases: ['ingles', 'english', 'eng', 'en', 'en-us', 'en-gb'] },
  { label: 'Italiano', aliases: ['italiano', 'italian', 'ita', 'it', 'it-it'] },
  { label: 'Japonés', aliases: ['japones', 'japanese', 'jpn', 'ja'] },
  { label: 'Neerlandés', aliases: ['neerlandes', 'dutch', 'nederlands', 'nld', 'dut', 'nl'] },
  { label: 'Polaco', aliases: ['polaco', 'polish', 'polski', 'pol', 'pl'] },
  { label: 'Portugués', aliases: ['portugues', 'portuguese', 'portugues-brasil', 'por', 'pt', 'pt-br', 'pt-pt'] },
  { label: 'Ruso', aliases: ['ruso', 'russian', 'rus', 'ru'] },
  { label: 'Turco', aliases: ['turco', 'turkish', 'tur', 'tr'] },
] as const;

const LANGUAGE_BY_ALIAS = new Map<string, string>(
  LANGUAGES.flatMap(({ label, aliases }) => aliases.map((alias) => [alias, label] as const)),
);

function languageLabel(value: string): string | null {
  const normalized = fold(value).trim().replace(/\s+/g, ' ');
  if (!normalized || normalized === 'und' || normalized === 'unknown') return null;
  const direct = LANGUAGE_BY_ALIAS.get(normalized);
  if (direct) return direct;
  for (const [alias, label] of LANGUAGE_BY_ALIAS) {
    if (alias.length < 3) continue;
    if (new RegExp(`(?:^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`).test(normalized)) {
      return label;
    }
  }
  return value.trim().replace(/\s+/g, ' ').replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toLocaleUpperCase('es'));
}

function explicitLanguages(value: string): string[] {
  return [...new Set(value.split(/[;,|/+]+/).map(languageLabel).filter((label): label is string => Boolean(label)))];
}

export function languagesFor(item: Pick<Item, 'title' | 'alias' | 'category'> & { language?: string }): string[] {
  if (item.language) {
    const declared = explicitLanguages(item.language);
    if (declared.length) return declared;
  }
  const text = fold(`${item.category} ${item.title} ${item.alias ?? ''}`);
  const inferred = new Set<string>();
  for (const { label, aliases } of LANGUAGES) {
    if (
      aliases.some((alias) => alias.length >= 3 && new RegExp(`(?:^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`).test(text))
    ) {
      inferred.add(label);
    }
  }
  return [...inferred];
}

export function vodLanguages(items: readonly (Pick<Item, 'title' | 'alias' | 'category'> & { language?: string })[]): string[] {
  return [...new Set(items.flatMap(languagesFor))].sort((a, b) => a.localeCompare(b, 'es'));
}

export function matchesVodSearch(item: Item, query: string): boolean {
  const needle = fold(query.trim());
  if (!needle) return true;
  return fold(`${item.title} ${item.alias ?? ''} ${item.category} ${languagesFor(item).join(' ')}`).includes(needle);
}
