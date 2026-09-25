import SwiftUI

/// Las hojas de muestra de la galería y del banco. Pasan por la única puerta de hojas de la app
/// (`Hoja.muestra` → `CentroHojas` → `hojasDeLaApp`, b-arquitectura §2.4.2), con sus detents y su fondo.
enum HojaMuestra: String, Hashable, Sendable {
    /// «Reproducir otro hash» (hoja medida, sm).
    case reproducirOtroHash
    /// «Atajos de ejemplo»: el panel lateral de la web; aquí, la hoja grande.
    case atajos
    /// «Háptica con hoja» (banco, bloque 6): vibrar con una hoja abierta y en horizontal.
    case haptica

    var tamano: TamanoHoja { self == .reproducirOtroHash ? .sm : .md }
}

/// Qué pinta cada hoja de muestra (textos de SistemaPage.tsx).
struct ContenidoHojaMuestra: View {
    let muestra: HojaMuestra
    @Environment(CentroHojas.self) private var hojas

    var body: some View {
        switch muestra {
        case .reproducirOtroHash: reproducir
        case .atajos: atajos
        case .haptica: haptica
        }
    }

    private var reproducir: some View {
        ContenidoHoja(titulo: "Reproducir otro hash", descripcion: "Pega un Content ID o un enlace acestream://",
                      tamano: .sm, alCerrar: { hojas.cerrar() }) {
            CampoTexto("Content ID o enlace", texto: .constant(""), marcador: "acestream://…",
                       pista: "40 caracteres hexadecimales.")
        } pie: {
            BotonPalco("Cancelar", variante: .quieto, bloque: true) { hojas.cerrar() }
            BotonPalco("Reproducir", icono: .play, bloque: true) { hojas.cerrar() }
        }
    }

    private var atajos: some View {
        ContenidoHoja(titulo: "Atajos de ejemplo", alCerrar: { hojas.cerrar() }) {
            HStack(spacing: 4) {
                Text("Pulsa").estilo(.cuerpo)
                Tecla("?")
                Text("en cualquier sitio para ver los atajos de verdad.").estilo(.cuerpo)
            }
            .foregroundStyle(Palco.text2)
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private var haptica: some View {
        ContenidoHoja(titulo: "Háptica con hoja", alCerrar: { hojas.cerrar() }) { BotonesHaptica() }
    }
}
