/* «Idioma preferido» de la portada de Ajustes (rediseño, sección 7). Es la
   elección de idiomas de Películas y series que ya guarda el servidor
   (vodLanguages, por casa: vale en el PC y en el iPhone), con la misma hoja
   que la cabecera de Pelis y series. Va en su propio trozo de JS porque
   arrastra la hoja y la demo de cine; Overview lo carga solo si hay
   películas y series. */

import { useState } from 'react';
import { haptic } from '../../lib/haptics.ts';
import { Icon } from '../../ui/index.ts';
import { useVodLanguages } from '../cine/data.ts';
import { LanguageSheet } from '../cine/Languages.tsx';
import { langSummary } from '../cine/texts.ts';

export default function LangRow() {
  const languages = useVodLanguages(true);
  const [open, setOpen] = useState(false);
  const prefs = languages.data;
  const langs = prefs?.chosen ? prefs.langs : [];
  return (
    <>
      <button
        type="button"
        className="ajx-row ajx-row--link"
        aria-haspopup="dialog"
        disabled={!prefs}
        onClick={() => {
          haptic('selection');
          setOpen(true);
        }}
      >
        <span className="ajx-row__ic" aria-hidden="true">
          <Icon name="idioma" size={20} />
        </span>
        <span className="ajx-row__t">
          <b>Idioma preferido</b>
          <small>Películas y series</small>
        </span>
        <span className="ajx-row__v">
          {prefs ? langSummary(langs) : languages.isError ? 'No se pudo leer' : 'Cargando…'}
          <Icon name="chevron" size={16} className="ajx-row__chev" />
        </span>
      </button>
      <LanguageSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
