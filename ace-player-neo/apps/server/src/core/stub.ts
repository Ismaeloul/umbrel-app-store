/* Servicio de esqueleto: cualquier método lanza `AppError('not_implemented')`.

   Lo usan las fábricas de los módulos mientras su agente no los porta. Así
   `createServices()` monta el árbol entero sin ciclos desde el primer día y
   cada ruta responde 501 con el formato correcto en vez de romper el
   arranque. Cuando un módulo se implementa, su fábrica deja de usarlo.

   Ojo: las interfaces de servicio solo tienen MÉTODOS (nada de propiedades
   con datos), justamente para que este stub valga para todas. */

import { notImplemented } from './errors.js';

export function notImplementedService<T extends object>(moduleName: string): T {
  return new Proxy({} as T, {
    get(_target, property) {
      /* `then` indefinido: que un `await servicio` no lo confunda con una promesa. */
      if (property === 'then' || typeof property === 'symbol') return undefined;
      return () => {
        throw notImplemented(`${moduleName}.${String(property)}`);
      };
    },
  });
}
