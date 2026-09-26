import UIKit

/* Lo poco que Emparejar y Ajustes leen fuera de SwiftUI. Todo lo demás sale del entorno (b-arquitectura §2.8):
   el núcleo de red de `SesionApp.entorno`, el reloj de `DatosApp.reloj`, las zonas seguras de `Maquetacion` y el
   repartidor de eventos de `\.repartidor`. Ya no se lee `ContenedorApp.actual`. */

@MainActor enum AccesoProceso {
    /// El id de este iPhone: el prefijo del token antes del punto (a7 §7), si aún no ha llegado el arranque. Lee
    /// el Llavero: se llama una vez al aparecer, no en cada `body`.
    static func idDelToken(_ entorno: Entorno) -> String? {
        guard let token = try? entorno.tokens.leerToken() else { return nil }
        return IdentidadDispositivo.id(token: token)
    }

    /// El nombre de este iPhone para el canje («iPhone» si iOS no deja leerlo).
    static var nombreDispositivo: String { UIDevice.current.name }
}
