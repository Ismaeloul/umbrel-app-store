Buscar en el motor AceStream. Entrada del armazón: `index.tsx`. El código
está en `src/features/search/` (reutiliza la tarjeta y la lista de
`src/features/library/`).

En el móvil (por debajo de 768; maqueta buscar-ajustes.html) la misma vista
lleva el campo en la cabecera y busca también en la Agenda y en Películas y
series (`wide-results.ts`, `MobileParts.tsx`): sin texto, Recientes, Atajos y
«Pegar un enlace»; con texto, grupos con chips. Desde 768 no cambia.
