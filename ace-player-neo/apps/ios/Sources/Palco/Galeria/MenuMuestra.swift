import SwiftUI
import UIKit

/// El menú «Más opciones» de la galería (a1 §10.19): el `Menu` del sistema con las opciones de la web.
struct MenuMuestra: View {
    let galeria: EstadoGaleria

    var body: some View {
        Menu {
            Section {
                boton("Guardar en favoritos", .star) { galeria.avisar("«DAZN 1» guardado en favoritos", tono: .ok) }
                boton("Copiar hash", .copy) { galeria.avisar("Hash copiado", tono: .ok) }
                boton("Abrir en…", .externo) { galeria.avisar("Abriendo en el reproductor externo…", tono: .info) }
                Toggle(isOn: .constant(false)) { etiqueta("Datos técnicos", .nerd) }
            }
            Section {
                Button(role: .destructive) {
                    galeria.avisar("Fuente reportada", tono: .warn)
                } label: {
                    etiqueta("Reportar la fuente", .flag)
                }
            }
        } label: {
            IconoPalco(.more, tamano: 24).frame(width: 44, height: 44).foregroundStyle(Palco.text2)
        }
        .menuOrder(.fixed)
        .accessibilityLabel("Más opciones")
    }

    private func boton(_ titulo: String, _ icono: NombreIcono, accion: @escaping () -> Void) -> some View {
        Button(action: accion) { etiqueta(titulo, icono) }
    }

    private func etiqueta(_ titulo: String, _ icono: NombreIcono) -> some View {
        Label {
            Text(titulo)
        } icon: {
            Image(uiImage: IconoImagen.imagen(icono, tamano: 20))
        }
    }
}
