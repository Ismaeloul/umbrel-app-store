/* Panel lateral de la biblioteca en escritorio (≥ 1024 px, plegable): la
   ficha del canal elegido (src/features/library/ChannelDetail.tsx). */

import type { ViewProps } from '../../app/contracts.ts';
import { ChannelDetail } from '../library/ChannelDetail.tsx';

export default function BibliotecaAside({ active }: ViewProps) {
  return <ChannelDetail active={active} />;
}
