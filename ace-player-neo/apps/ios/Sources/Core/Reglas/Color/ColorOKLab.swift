import Foundation

/* Color de lib/color.ts (b-arquitectura §2.1.3, dueño M2). ESQUELETO de la fase 0.4: P necesita el tipo
   `RGB` (firma del contrato, tal cual) para `DatosEquipo`, `RGB.color` y las primitivas de Palco. El port
   de lib/color.ts (sRGB ⇄ OKLCH, mezclas, `versusPair`…) lo escribe M2 en este mismo fichero. */

/// sRGB 0…1 (lib/color.ts).
struct RGB: Hashable, Sendable { var r: Double, g: Double, b: Double }
