/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `engine`, con los mismos nombres (comportamientos-tests.md §3.1-3.2).

   server.js no exportaba nada del motor. T-118 prueba engine-control.js
   (`createServer`, `handleRequest`, `tokenValido`), que es otro programa
   (apps/server/src/engine-control, plan E1.8) y no pasa por esta fachada.
   `scannerEnginePath` (T-072) es del módulo scanner; la misma regla para el
   motor principal está en ./paths.ts (`engineRelativePath`). */

export {};
