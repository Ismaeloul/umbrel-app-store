#if DEBUG
    import SwiftUI
    import UIKit

    /// Un bloque del banco: título de sección y contenido.
    struct BloqueLab<Contenido: View>: View {
        let numero: Int
        let titulo: String
        let contenido: Contenido

        init(_ numero: Int, _ titulo: String, @ViewBuilder contenido: () -> Contenido) {
            self.numero = numero
            self.titulo = titulo
            self.contenido = contenido()
        }

        var body: some View {
            VStack(alignment: .leading, spacing: S.s3) {
                Text("\(numero). \(titulo)").estilo(.tituloSeccion).foregroundStyle(Palco.text).accessibilityAddTraits(.isHeader)
                contenido
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
#endif
