import SwiftUI

/// «Modo demo» (a2 §6.4): cápsula de 26, relleno 0 10, oro lavado, 11/650/88. No es interactiva.
struct EtiquetaModoDemo: View {
    var body: some View {
        Text("Modo demo")
            .estilo(.modoDemo)
            .foregroundStyle(Palco.accentInk)
            .padding(.horizontal, 10)
            .frame(minHeight: 26)
            .background(Palco.accentWash, in: Capsule())
            .fixedSize()
    }
}
