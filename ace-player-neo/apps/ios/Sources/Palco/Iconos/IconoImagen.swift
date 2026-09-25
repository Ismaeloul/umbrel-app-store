import Synchronization
import SwiftUI
import UIKit

/// Los iconos de la web como `UIImage` plantilla, para lo que pinta el sistema (`Menu`, `.contextMenu`,
/// `Label`): allí no entra una vista, solo una imagen (b-arquitectura §2.2.4; canario C14).
@MainActor enum IconoImagen {
    /// Caché de dibujo por nombre y tamaño, sin estado global mutable: un `Mutex` inmutable (como `EstadoDemo`,
    /// canario C16). No es estado de la app: si se vacía, se rehace igual.
    private static let cache = Mutex<[String: UIImage]>([:])

    /// UIImage plantilla (para Menu, contextMenu y Label del sistema). Caché por nombre y tamaño.
    static func imagen(_ nombre: NombreIcono, tamano: CGFloat = 20) -> UIImage {
        let clave = "\(nombre.rawValue)@\(tamano)"
        if let hecha = cache.withLock({ $0[clave] }) { return hecha }
        let renderizador = ImageRenderer(content: IconoPalco(nombre, tamano: tamano).foregroundStyle(Color.black))
        renderizador.scale = 3
        let imagen: UIImage = (renderizador.uiImage ?? UIImage()).withRenderingMode(.alwaysTemplate)
        cache.withLock { $0[clave] = imagen }
        return imagen
    }
}
