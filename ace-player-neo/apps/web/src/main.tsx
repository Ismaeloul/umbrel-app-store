/* Entrada de la web. Orden:
   1. estilos (fuentes, tokens y base);
   2. tema y teclado en pantalla (antes del primer pintado de React);
   3. React pinta el armazón YA, con esqueletos: no espera a la red;
   4. en paralelo, la capa de datos decide live/demo, siembra la caché con
      /api/v1/bootstrap y abre el SSE;
   5. atajos globales y la PWA (service worker en contexto seguro y aviso de
      versión nueva), cargada aparte (src/features/pwa/). */

import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import { createRoot } from 'react-dom/client';
import { bootApi } from './api/boot.ts';
import { queryClient } from './api/query.ts';
import { App } from './app/App.tsx';
import { installShortcutListener } from './app/shortcuts.ts';
import { installThemeWatcher } from './app/theme.ts';
import { installViewportWatcher } from './lib/viewport.ts';
import { toast } from './notices/toasts.ts';

installThemeWatcher();
installViewportWatcher();
installShortcutListener();

const container = document.getElementById('root');
if (container) createRoot(container).render(<App client={queryClient} />);

void bootApi(queryClient).then((result) => {
  if (result.notice) toast(result.notice.text, { tone: result.notice.tone, ms: 4000 });
});

// PWA (src/features/pwa/install.ts): el service worker (solo en producción y
// en contexto seguro, como la 0.6.59; en localhost, solo si hay un sw.js de
// verdad) y el aviso de versión nueva. Va en su propio trozo con import() y
// se pide al terminar de cargar la página: no pesa en el JS inicial ni
// compite con el primer pintado.
const startPwa = () => {
  void import('./features/pwa/install.ts')
    .then((pwa) => pwa.installPwa({ client: queryClient }))
    .catch(() => {
      // Si el trozo no llega, la app funciona igual (sin worker ni aviso).
    });
};
if (document.readyState === 'complete') startPwa();
else window.addEventListener('load', startPwa, { once: true });
