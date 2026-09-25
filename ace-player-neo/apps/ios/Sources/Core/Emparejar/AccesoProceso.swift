import UIKit

/* Lo que Emparejar y Ajustes necesitan del proceso y no está en el entorno de SwiftUI (b-arquitectura §2.8:
   las pantallas leen sus objetos del entorno; el `Entorno` del núcleo, el `Reloj` y el visor viven en
   `ContenedorApp`): el cliente y las direcciones para el canje y los códigos, el reloj (R14: nada de
   `Date()` en las pantallas) y las zonas seguras de la ventana clave. Solo lectura. */

@MainActor enum AccesoProceso {
    /// El núcleo de red (real, demo o simulado).
    static var entorno: Entorno? { ContenedorApp.actual?.entorno }

    /// El reloj de la app (`-AceNeoReloj` en Debug).
    static var reloj: any Reloj { ContenedorApp.actual?.reloj ?? RelojSistema() }

    /// Las zonas seguras de la ventana clave (no con GeometryReader + ignoresSafeArea: §5 y a2 §27.1).
    static var zonasSeguras: UIEdgeInsets {
        let escenas = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let ventana = escenas.flatMap(\.windows).first(where: \.isKeyWindow) ?? escenas.first?.windows.first
        return ventana?.safeAreaInsets ?? .zero
    }

    /// El id de este iPhone: el prefijo del token antes del punto (a7 §7), si aún no ha llegado el arranque.
    static var idDelToken: String? {
        guard let token = try? entorno?.tokens.leerToken() else { return nil }
        return IdentidadDispositivo.id(token: token)
    }

    /// El repartidor de eventos del SSE (`escuchar`, b-arquitectura §2.5.3): no es observable, no va en el entorno.
    static var repartidor: RepartidorEventos? { ContenedorApp.actual?.repartidor }

    /// El nombre de este iPhone para el canje («iPhone» si iOS no deja leerlo).
    static var nombreDispositivo: String { UIDevice.current.name }
}
