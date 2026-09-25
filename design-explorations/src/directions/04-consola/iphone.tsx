/* Consola · iPhone: listas nativas compactas, pestaña de búsqueda con ámbitos,
   hoja de propiedades para el partido, mini de 44 pt. */

import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './tokens.css';
import './iphone.css';
import { PhoneShell } from './iphone/Shell';

export default function Iphone() {
  return <PhoneShell />;
}
