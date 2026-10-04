/* Los idiomas que se están viendo en Películas y series (docs/vod.md §4.10):
   los elegidos, o el de «3 en latino · Ver» en la rejilla. La cápsula de
   idioma de cada tarjeta los mira (con uno solo no se dice: todas dirían lo
   mismo). Vacío = todos los idiomas. */

import type { VodLang } from '@ace/shared';
import { createContext } from 'react';

export const CineLangs = createContext<readonly VodLang[]>([]);
