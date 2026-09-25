import SwiftUI

/// Un título de sección de la galería (17/720/125) y su contenido con separación 12.
struct SeccionGaleria<Contenido: View>: View {
    let titulo: String
    let contenido: Contenido

    init(_ titulo: String, @ViewBuilder contenido: () -> Contenido) {
        self.titulo = titulo
        self.contenido = contenido()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: S.s3) {
            Text(titulo).estilo(.tituloSeccion).foregroundStyle(Palco.text).accessibilityAddTraits(.isHeader)
            contenido
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
