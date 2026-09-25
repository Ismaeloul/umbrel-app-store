import SwiftUI
import UIKit

// Canario C14 (b-arquitectura §5.3): ImageRenderer → UIImage plantilla dentro del Label de un
// Menu, tal como lo usará Palco/Iconos/IconoImagen.swift (§2.2.4) con los caminos generados.
// Plan B: UIGraphicsImageRenderer dibujando el Path. Se borra al cerrar la fase 0.

@MainActor enum SondaIconoImagen {
    static func imagen(tamano: CGFloat = 20) -> UIImage {
        let forma = Circle()
            .stroke(style: StrokeStyle(lineWidth: 1.8 * tamano / 24, lineCap: .round, lineJoin: .round))
            .frame(width: tamano, height: tamano)
        let renderizador = ImageRenderer(content: forma)
        renderizador.scale = 3
        return (renderizador.uiImage ?? UIImage()).withRenderingMode(.alwaysTemplate)
    }
}

struct SondaC14Menu: View {
    var body: some View {
        Menu {
            Button {
            } label: {
                Label {
                    Text("Copiar el hash")
                } icon: {
                    Image(uiImage: SondaIconoImagen.imagen())
                }
            }
        } label: {
            Text("Más opciones")
        }
    }
}
