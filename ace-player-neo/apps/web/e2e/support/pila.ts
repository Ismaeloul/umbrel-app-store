/* Dónde deja la pila (stack.ts) su carpeta de trabajo, para que los
   recorridos puedan leer sus datos y logs: un fichero en la carpeta temporal
   con el puerto de la web en el nombre (cada pila tiene el suyo). */

import os from 'node:os';
import path from 'node:path';
import type { E2EPorts } from './puertos.ts';

export function carpetaDeLaPila(ports: E2EPorts): string {
  return path.join(os.tmpdir(), `ace-e2e-pila-${ports.web}.txt`);
}
