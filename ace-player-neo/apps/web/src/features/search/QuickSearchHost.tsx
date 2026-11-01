/* El sitio de la ventana rápida de buscar (Ctrl K) en el armazón. La ventana
   (QuickSearch.tsx, con la agenda, los canales y el catálogo) es un trozo
   aparte: solo se descarga la primera vez que se abre, y luego se queda. */

import { lazy, Suspense, useState } from 'react';
import { closeQuickSearch, useQuickSearch } from '../../app/search-open.ts';

const QuickSearch = lazy(() => import('./QuickSearch.tsx'));

export function QuickSearchHost() {
  const { open, nonce } = useQuickSearch();
  const [loaded, setLoaded] = useState(open);
  if (open && !loaded) setLoaded(true);
  if (!loaded) return null;
  return (
    <Suspense fallback={null}>
      <QuickSearch open={open} nonce={nonce} onClose={closeQuickSearch} />
    </Suspense>
  );
}
