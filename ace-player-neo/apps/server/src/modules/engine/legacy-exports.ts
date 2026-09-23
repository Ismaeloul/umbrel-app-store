/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `engine`, con los mismos nombres (comportamientos-tests.md §3.1-3.2).

   Para qué: los tests portados y el contraste con la 0.6.59 (plan E1.4)
   llaman a estas funciones por su nombre de siempre. En el esqueleto lanzan
   `not_implemented`; el agente del módulo las implementa o las reexporta de
   su servicio (mismas entradas y salidas que la 0.6.59). Las firmas son las
   de server.js con tipos de @ace/shared donde se conocen.

   server.js no exportaba nada del motor. T-118 prueba engine-control.js
   (`createServer`, `handleRequest`, `tokenValido`), que es otro programa
   (apps/server/src/engine-control, plan E1.8) y no pasa por esta fachada. */

export {};
