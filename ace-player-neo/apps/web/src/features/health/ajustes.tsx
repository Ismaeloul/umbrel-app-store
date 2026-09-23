/* Sección «Salud del sistema» de Ajustes. Ajustes la encuentra sola
   (src/features/settings/external.tsx, import.meta.glob) y la carga en su
   propio trozo de JS. Contrato: export default de un componente con ViewProps
   y SIN cabecera propia (el título lo pone Ajustes). */

import type { ViewProps } from '../../app/contracts.ts';
import { registerHealthDemo } from './demo.ts';
import { HealthSection } from './HealthSection.tsx';

// Respuestas de la demo (salud y registro de muestra). Solo cuentan en demo.
registerHealthDemo();

export default function HealthSettings(_props: ViewProps) {
  return <HealthSection />;
}
