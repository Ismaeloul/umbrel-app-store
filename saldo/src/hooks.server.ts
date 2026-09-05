import { arrancarTareas } from '$lib/servidor/tareas';

// Un solo sitio donde arranca lo de fondo, en cuanto el servidor esta en pie.
arrancarTareas();

export async function handle({ event, resolve }) {
  return resolve(event);
}
