import Foundation

/* Descriptor puro de una opción de menú (b-arquitectura §2.1.3, I0). Las reglas de cada menú
   (OpcionesPartido, OpcionesCanal, OpcionesFuente, OpcionesReproductor, OpcionesDispositivo) devuelven
   listas de esto; `AccionMenu` (Armazon/Menus.swift) le pone la acción y lo pinta como `Menu`,
   `.contextMenu` y `accessibilityActions` a la vez. */

struct OpcionMenu: Identifiable, Hashable, Sendable {
    var id: String
    var titulo: String
    var icono: NombreIcono?
    var peligro = false
    var marcada = false  // se pinta como Toggle
    var deshabilitada = false
    var separadaAntes = false  // abre una Section nueva
    var haptica: TipoHaptico?  // la de la ACCIÓN (abrir el menú no suena)
}
