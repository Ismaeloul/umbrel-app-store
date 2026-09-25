#if DEBUG
    import SwiftUI

    /// Bloque 6: cada tipo de háptica por el pulso central (el único `.sensoryFeedback` de la raíz, canario C5),
    /// también desde una hoja abierta (la de `CentroHojas`) y en horizontal.
    struct LabHaptica: View {
        @Environment(CentroHojas.self) private var hojas

        var body: some View {
            BloqueLab(6, "Háptica") {
                VStack(alignment: .leading, spacing: S.s3) {
                    BotonesHaptica()
                    BotonPalco("Abrir una hoja y vibrar desde ella", icono: .plus, variante: .quieto) {
                        hojas.abrir(.muestra(.haptica))
                    }
                    Text("Gira el iPhone a horizontal y vuelve a probar (el pulso sale del único .sensoryFeedback de la raíz).")
                        .estilo(.subtituloVista)
                        .foregroundStyle(Palco.text2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .tarjeta()
            }
        }
    }
#endif
