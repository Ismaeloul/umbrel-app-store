/* Engancha varios dispositivos a la vez (docs/multidispositivo.md §2 y §3):
   la puerta de la casa en play(), quién sabe seguir un «Cambiar en los dos»
   y los oyentes de SSE. Lo llama el armazón una vez al montarse. */

import { setFollowHandler, setHouseGate } from '../../player/api.ts';
import { followHouse, listenFollow } from './follow.ts';
import { houseGate, listenHouseGate } from './gate.ts';

export function installHouse(): () => void {
  setHouseGate(houseGate);
  setFollowHandler(followHouse);
  const offGate = listenHouseGate();
  const offFollow = listenFollow();
  return () => {
    offGate();
    offFollow();
    setHouseGate(null);
    setFollowHandler(null);
  };
}
