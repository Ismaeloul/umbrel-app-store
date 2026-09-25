import SwiftUI

/* Pie de la biblioteca (M5; a5 §3.6): el icono `list` y «6 canales en biblioteca · lista sincronizada 23 sept
   · demo», 12 `--text-3`. */

struct PieBiblioteca: View {
    let biblioteca: LibraryView
    @Environment(\.modoDemo) private var modoDemo

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            IconoPalco(.list, tamano: 16)
            Text(ReglasBiblioteca.pie(biblioteca, demo: modoDemo))
                .estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45))
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(Palco.text3)
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
