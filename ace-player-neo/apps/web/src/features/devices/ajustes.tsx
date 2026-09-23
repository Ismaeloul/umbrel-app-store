/* Sección «Dispositivos» de Ajustes (emparejar la app de iOS, listar y
   revocar). Ajustes la encuentra sola (src/features/settings/external.tsx) y
   la carga en su propio trozo. Contrato: export default con ViewProps y SIN
   cabecera propia (el título lo pone Ajustes). */

import type { ViewProps } from '../../app/contracts.ts';
import { registerDevicesDemo } from './demo.ts';
import { DevicesSection } from './DevicesSection.tsx';

// En la demo, un QR de muestra en vez del SVG vacío del ejemplo.
registerDevicesDemo();

export default function DevicesSettings(_props: ViewProps) {
  return <DevicesSection />;
}
