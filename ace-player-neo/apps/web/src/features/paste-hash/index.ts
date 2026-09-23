/* «Pegar hash» (inventario-front §7.5): la hoja para reproducir un Content ID
   o un enlace acestream:// que no está en la biblioteca. La usan la
   biblioteca y el buscador; el centro de partido puede reutilizarla con
   `onSubmit` para añadir el hash como fuente manual del partido. */

export { INVALID_HASH_MESSAGE, PasteHashSheet, pastedTitle } from './PasteHashSheet.tsx';
export type { PasteHashSheetProps } from './PasteHashSheet.tsx';
