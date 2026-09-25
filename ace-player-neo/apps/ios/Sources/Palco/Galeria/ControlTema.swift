import SwiftUI

/// Tema y transparencia de la galería y del banco: los de la app (`PreferenciasLocales`), como `setTheme` y
/// `setTransparency` en SistemaPage.tsx. `HostingRaiz` pone el tema en la ventana; la raíz pasa la transparencia
/// a `cristalOpaco`.
struct ControlTema: View {
    let descripcion: String
    @Environment(PreferenciasLocales.self) private var preferencias

    var body: some View {
        VStack(alignment: .leading, spacing: S.s4) {
            Segmentado(EstadoGaleria.opcionesTema, seleccion: tema, etiqueta: "Tema")
            FilaInterruptor("Reducir transparencia", descripcion: descripcion, activo: transparencia)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var tema: Binding<TemaApp> {
        let preferencias = self.preferencias
        return Binding(get: { preferencias.tema }, set: { preferencias.cambiarTema($0) })
    }

    private var transparencia: Binding<Bool> {
        let preferencias = self.preferencias
        return Binding(get: { preferencias.transparenciaReducida }, set: { preferencias.cambiarTransparencia($0) })
    }
}
