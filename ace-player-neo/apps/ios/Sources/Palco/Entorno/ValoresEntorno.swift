import SwiftUI

// Valores de entorno de la app (b-arquitectura §2.2.10, contrato I0→P; canario C4). Los objetos
// (@Observable) van por `.environment(objeto)`; aquí solo valores.

extension EnvironmentValues {
    @Entry var maquetacion: Maquetacion = .referencia
    /// false en las pestañas ocultas: sondeos, relojes y animaciones continuas parados.
    @Entry var vistaActiva: Bool = true
    @Entry var modoDemo: Bool = false
    /// Transparencia reducida del sistema O de la app (Ajustes › Apariencia).
    @Entry var cristalOpaco: Bool = false
    /// Movimiento reducido del sistema O -AceNeoMovimientoReducido (capturas).
    @Entry var movimientoReducido: Bool = false
    @Entry var radioInterior: CGFloat = 8
    @Entry var cacheImagenes: CacheImagenes? = nil
}
