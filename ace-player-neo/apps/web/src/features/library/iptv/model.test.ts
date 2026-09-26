/* Pestaña IPTV de Canales, reglas puras (docs/iptv.md §16.6 y §16.7): el
   estado de la URL, la consulta, las etiquetas, los textos y la demo. */

import { IptvBrowseResponseSchema } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { demoCategoryId, demoIptvBrowse, DEMO_BROWSE_TOTAL } from './demo.ts';
import {
  ALL_CATEGORY,
  browseScope,
  categoriesMatching,
  categoryName,
  channelSubtitle,
  clearIptvState,
  facetLabel,
  NO_FILTERS,
  qualityTags,
  readIptvState,
  screenOf,
  selectedCount,
  selectedValues,
  toggleFilter,
  topTypes,
  visibleFacetValues,
  writeIptvState,
} from './model.ts';
import {
  categoryLabel,
  channelsText,
  facetValueLabel,
  filtersButtonLabel,
  iptvLiveText,
  rootHeaderText,
  seeAllCountries,
  seeChannelsText,
} from './texts.ts';

describe('estado de la URL', () => {
  it('lee categoría y filtros; lo que no vale se ignora', () => {
    const state = readIptvState(
      '?vista=biblioteca&pestana=iptv&cat=3f9a1c7e5b20&pais=ES,UK,es,ES&idioma=es&tipo=deportes,telenovelas&deporte=futbol,f1&calidad=fhd,4k',
    );
    expect(state.category).toBe('3f9a1c7e5b20');
    expect(state.filters).toEqual({
      country: ['ES', 'UK'],
      language: ['es'],
      type: ['deportes'],
      sport: ['futbol', 'f1'],
      quality: ['fhd'],
    });
    expect(readIptvState('?cat=ES%20%7C%20DAZN').category).toBeNull();
    expect(readIptvState('?cat=todos').category).toBe(ALL_CATEGORY);
    expect(readIptvState('?cat=none').category).toBe('none');
  });

  it('escribe sin tocar el resto de parámetros, con comas y sin vacíos', () => {
    const search = writeIptvState('?vista=biblioteca&pestana=iptv', {
      category: 'none',
      filters: { ...NO_FILTERS, country: ['ES', 'UK'], sport: ['futbol'] },
    });
    expect(search).toBe('?vista=biblioteca&pestana=iptv&cat=none&pais=ES,UK&deporte=futbol');
    expect(readIptvState(search).filters.country).toEqual(['ES', 'UK']);
    expect(clearIptvState(search)).toBe('?vista=biblioteca&pestana=iptv');
  });

  it('elegir y quitar un valor; como mucho 16 por faceta', () => {
    let filters = toggleFilter(NO_FILTERS, 'country', 'ES');
    filters = toggleFilter(filters, 'type', 'deportes');
    expect(selectedCount(filters)).toBe(2);
    filters = toggleFilter(filters, 'country', 'ES');
    expect(filters.country).toEqual([]);
    let many = NO_FILTERS;
    for (let i = 0; i < 20; i += 1)
      many = toggleFilter(many, 'country', `C${String.fromCharCode(65 + i)}`);
    expect(many.country).toHaveLength(16);
  });
});

describe('consulta y pantalla', () => {
  it('«todos» no manda categoría; los filtros van separados por comas', () => {
    const filters = { ...NO_FILTERS, country: ['ES'], quality: ['fhd', 'hd'] };
    expect(browseScope({ category: ALL_CATEGORY, filters }, '')).toEqual({
      country: 'ES',
      quality: 'fhd,hd',
    });
    expect(browseScope({ category: 'none', filters: NO_FILTERS }, 'acb')).toEqual({
      category: 'none',
      q: 'acb',
    });
  });

  it('raíz, raíz con texto, todos y categoría', () => {
    expect(screenOf({ category: null, filters: NO_FILTERS }, '')).toBe('root');
    expect(screenOf({ category: null, filters: NO_FILTERS }, 'dazn')).toBe('search');
    expect(screenOf({ category: ALL_CATEGORY, filters: NO_FILTERS }, '')).toBe('all');
    expect(screenOf({ category: '3f9a1c7e5b20', filters: NO_FILTERS }, 'x')).toBe('category');
  });
});

describe('etiquetas y textos (§16.4 y §16.7)', () => {
  it('países, idiomas, tipos, deportes y calidades; un código desconocido, tal cual', () => {
    expect(facetLabel('country', 'ES')).toBe('España');
    expect(facetLabel('country', 'UK')).toBe('Reino Unido');
    expect(facetLabel('country', 'EXYU')).toBe('Balcanes');
    expect(facetLabel('country', 'HU')).toBe('HU');
    expect(facetLabel('country', 'none')).toBe('Sin país');
    expect(facetLabel('language', 'ca')).toBe('Catalán');
    expect(facetLabel('language', 'hu')).toBe('HU');
    expect(facetLabel('language', 'none')).toBe('Sin idioma');
    expect(facetLabel('type', 'musica')).toBe('Música');
    expect(facetLabel('type', 'none')).toBe('Sin tipo');
    expect(facetLabel('sport', 'futbol-americano')).toBe('Fútbol americano');
    expect(facetLabel('sport', 'padel')).toBe('Pádel');
    expect(facetLabel('quality', 'uhd')).toBe('4K');
    expect(facetLabel('quality', 'none')).toBe('Sin marca');
    expect(qualityTags(['hd', 'uhd', 'fhd'])).toEqual(['4K', '1080p', '720p']);
    expect(qualityTags([])).toEqual([]);
  });

  it('plurales, «{n} de {N}» y los números a la española', () => {
    expect(channelsText(1)).toBe('1 canal');
    expect(channelsText(27687)).toBe('27.687 canales');
    expect(
      rootHeaderText({ total: 0, catalogTotal: 27687, categories: 312, narrowed: false }),
    ).toBe('27.687 canales · 312 categorías');
    expect(rootHeaderText({ total: 1, catalogTotal: 1, categories: 1, narrowed: false })).toBe(
      '1 canal · 1 categoría',
    );
    expect(
      rootHeaderText({ total: 2310, catalogTotal: 27687, categories: 9, narrowed: true }),
    ).toBe('2310 de 27.687 canales');
    expect(categoryLabel('ES | DAZN', 18)).toBe('ES | DAZN, 18 canales');
    expect(facetValueLabel('Fútbol', 1)).toBe('Fútbol, 1 canal');
    expect(seeChannelsText(0)).toBe('Sin canales');
    expect(seeChannelsText(1)).toBe('Ver 1 canal');
    expect(seeChannelsText(12500)).toBe('Ver 12.500 canales');
    expect(seeAllCountries(112)).toBe('Ver todos los países (112)');
    expect(filtersButtonLabel(0)).toBe('Filtros');
    expect(filtersButtonLabel(2)).toBe('Filtros, 2 elegidos');
    expect(iptvLiveText(0, '')).toBe('Ningún canal con estos filtros.');
    expect(iptvLiveText(7, 'acb')).toBe('7 canales con «acb»');
    expect(iptvLiveText(812, '')).toBe('812 canales');
  });

  it('nombres de categoría, subtítulos y categorías con el texto', () => {
    expect(categoryName('none', '')).toBe('Sin categoría');
    expect(categoryName(ALL_CATEGORY, undefined)).toBe('Todos los canales');
    const names = new Map([['3f9a1c7e5b20', 'ES | DAZN']]);
    const channel = { country: 'ES', category: '3f9a1c7e5b20' };
    expect(
      channelSubtitle(channel, { inCategory: true, provider: 'Casa', categoryNames: names }),
    ).toBe('España');
    expect(
      channelSubtitle(
        { country: null, category: 'none' },
        { inCategory: true, provider: 'Casa', categoryNames: names },
      ),
    ).toBe('Casa');
    expect(
      channelSubtitle(channel, { inCategory: false, provider: 'Casa', categoryNames: names }),
    ).toBe('ES | DAZN');
    const cats = ['ES | DAZN', 'UK | DAZN', 'ES | DEPORTES', 'DAZN IT', 'DAZN DE', 'DAZN PT'].map(
      (name) => ({ name }),
    );
    expect(categoriesMatching(cats, 'dázn').map((c) => c.name)).toHaveLength(5);
    expect(categoriesMatching(cats, 'deportes').map((c) => c.name)).toEqual(['ES | DEPORTES']);
    expect(categoriesMatching(cats, '')).toEqual([]);
  });

  it('valores a la vista (los elegidos siempre), atajos y elegidos para la fila del móvil', () => {
    const values = ['a', 'b', 'c', 'd'].map((value, i) => ({
      value,
      count: 10 - i,
      selected: value === 'd',
    }));
    const { shown, hidden } = visibleFacetValues(values, 2);
    expect(shown.map((v) => v.value)).toEqual(['a', 'b', 'd']);
    expect(hidden.map((v) => v.value)).toEqual(['c']);
    const facets = {
      country: [],
      language: [],
      quality: [],
      sport: [],
      type: [
        { value: 'none', count: 900, selected: false },
        { value: 'cine', count: 5, selected: false },
        { value: 'deportes', count: 50, selected: false },
      ],
    };
    expect(topTypes(facets).map((v) => v.value)).toEqual(['deportes', 'cine']);
    expect(selectedValues({ ...NO_FILTERS, sport: ['f1'], country: ['ES'] })).toEqual([
      { facet: 'country', value: 'ES', label: 'España' },
      { facet: 'sport', value: 'f1', label: 'F1' },
    ]);
  });
});

describe('la IPTV de ejemplo de la demo (§16.10)', () => {
  const dazn = demoCategoryId('ES | DAZN');

  it('la raíz: categorías del proveedor en su orden, facetas y la forma del contrato', () => {
    const root = demoIptvBrowse({ limit: 0 });
    expect(IptvBrowseResponseSchema.safeParse(root).success).toBe(true);
    expect(root.catalogTotal).toBe(DEMO_BROWSE_TOTAL);
    expect(root.channels).toEqual([]);
    expect(root.categories?.[0]?.name).toBe('ES | DEPORTES');
    expect(root.categories?.at(-1)?.id).toBe('none');
    expect(root.facets?.type.some((v) => v.value === 'adultos')).toBe(true);
  });

  it('una categoría por páginas: recorrerlas da `total` filas sin repetir', () => {
    const seen = new Set<string>();
    const totals: number[] = [];
    let cursor: string | undefined;
    do {
      const page = demoIptvBrowse({ ...(cursor ? { cursor } : {}), limit: 60 });
      expect(IptvBrowseResponseSchema.safeParse(page).success).toBe(true);
      totals.push(page.total);
      for (const channel of page.channels) seen.add(channel.id);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(totals)).toEqual(new Set([DEMO_BROWSE_TOTAL]));
    expect(seen.size).toBe(DEMO_BROWSE_TOTAL);
    const category = demoIptvBrowse({ category: dazn });
    expect(category.category?.name).toBe('ES | DAZN');
    expect(category.channels.map((c) => c.title)).toContain('DAZN F1');
  });

  it('facetas disyuntivas: «España» cuenta con «Fútbol» elegido y «Fútbol» sin su propio filtro', () => {
    const both = demoIptvBrowse({ country: 'ES', sport: 'futbol', limit: 0 });
    const onlyFutbol = demoIptvBrowse({ sport: 'futbol', limit: 0 });
    const onlySpain = demoIptvBrowse({ country: 'ES', limit: 0 });
    expect(both.facets?.country.find((v) => v.value === 'ES')?.count).toBe(both.total);
    expect(both.facets?.sport.find((v) => v.value === 'futbol')?.count).toBe(both.total);
    // «Italia» con «Fútbol» elegido: lo que habría si se suma Italia.
    expect(both.facets?.country.find((v) => v.value === 'IT')?.count).toBe(
      onlyFutbol.facets?.country.find((v) => v.value === 'IT')?.count,
    );
    expect(both.facets?.sport.find((v) => v.value === 'futbol')?.count).toBe(
      onlySpain.facets?.sport.find((v) => v.value === 'futbol')?.count,
    );
  });

  it('texto: «acb» da los 7 «DAZN ACB»; un valor elegido sale aunque cuente 0', () => {
    const acb = demoIptvBrowse({ q: 'acb' });
    expect(acb.total).toBe(7);
    const none = demoIptvBrowse({ q: 'acb', country: 'FR', limit: 0 });
    expect(none.total).toBe(0);
    expect(none.facets?.country).toContainEqual({ value: 'FR', count: 0, selected: true });
  });

  it('adultos es un tipo más y excluyente; «UK: DAZN 1» es otra fila que «ES: DAZN 1»', () => {
    const adults = demoIptvBrowse({ type: 'adultos' });
    expect(adults.total).toBe(5);
    expect(adults.channels.every((c) => c.title.startsWith('HOT'))).toBe(true);
    const dazn1 = demoIptvBrowse({ q: 'dazn 1' }).channels.filter((c) => c.title === 'DAZN 1');
    expect(new Set(dazn1.map((c) => c.country))).toEqual(new Set(['ES', 'UK', 'DE']));
    expect(new Set(dazn1.map((c) => c.id)).size).toBe(3);
  });

  it('cursor de otro catálogo: primera página con `stale`; categoría que no existe: `category: null`', () => {
    const cursor = btoa('otro.60').replace(/=+$/, '');
    const stale = demoIptvBrowse({ cursor });
    expect(stale.stale).toBe(true);
    expect(stale.facets).toBeDefined();
    const gone = demoIptvBrowse({ category: 'abcdefabcdef' });
    expect(gone.category).toBeNull();
    expect(gone.total).toBe(0);
  });
});
