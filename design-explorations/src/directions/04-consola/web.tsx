/* Consola · web: herramienta pro minimalista (barra lateral + lista + inspector,
   panel de comandos, teclado en todo). */

import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './tokens.css';
import './web.css';
import { Shell } from './web/Shell';

export default function Web() {
  return <Shell />;
}
