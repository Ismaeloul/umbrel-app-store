/* «Ver juntos» en la demo (`?demo=1`): sin red no hay salas. La lista de salas
   abiertas (`partyList`) no tiene ejemplo para la demo (sus ejemplos son de la
   web de casa, fixtures/web/v1) y daba `not_found`: la portada habría dicho
   «No se pueden cargar las salas». Aquí, vacía. */

import { registerDemoHandlers } from '../../api/index.ts';

registerDemoHandlers({
  partyList: () => ({ rooms: [] }),
});
