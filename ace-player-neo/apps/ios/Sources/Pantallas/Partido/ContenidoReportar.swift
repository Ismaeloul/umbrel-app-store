import SwiftUI

/* ContenidoReportar (b-arquitectura §2.8, M6; a4 §13.2). STUB de I0 (fase 0.3b): Color.clear con su IDUI
   para que la app navegue. M6 la escribe entera; lee sus objetos del entorno, nunca por init. */

struct ContenidoReportar: View {
    let hash: String
    let numero: Int

    var body: some View {
        Color.clear
            .overlay { Text("Reportar fuente") }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(IDUI.hojaReportar)
    }
}
