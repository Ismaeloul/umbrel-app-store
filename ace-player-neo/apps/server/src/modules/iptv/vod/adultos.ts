/* Títulos para adultos en Películas y series: DÓNDE salen (docs/vod.md §4.9,
   D-VOD7). Este es el único sitio que lo decide; cambiar un `true` por
   `false` aquí basta (y sus pruebas en search.test.ts y vod-service.test.ts
   dicen qué cambia).

   Qué es «para adultos» (`is_adult` del panel o el nombre de la categoría)
   lo decide `parse.ts` y no cambia: la tarjeta, la ficha y la categoría
   llevan `adult: true` y la web les pone la cápsula «+18». En la búsqueda y
   dentro de su categoría salen SIEMPRE (D25, «todo desbloqueado»).

   Decisión de Isma (3-oct-2026, cambia D-VOD7): «salen en la portada como
   los demás». Antes estaban fuera de la portada y de «Todas» y sus
   categorías iban al final. */

export interface VodAdultPolicy {
  /** En la portada: «Novedades en películas» y «Series actualizadas». */
  readonly home: boolean;
  /** En «Todas» sin texto buscado (la rejilla de cada tipo) y en sus distintivos. */
  readonly all: boolean;
  /** Sus categorías, al final de la lista (`false`: en el orden del panel, como las demás). */
  readonly categoriesLast: boolean;
}

export const VOD_ADULT_POLICY: VodAdultPolicy = {
  home: true,
  all: true,
  categoriesLast: false,
};
