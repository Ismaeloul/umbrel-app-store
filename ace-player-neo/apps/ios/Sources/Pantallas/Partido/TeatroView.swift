import SwiftUI

/* TeatroView (b-arquitectura §2.8, M6; a4 (.partido o .canal)). STUB de I0 (fase 0.3b): Color.clear con su IDUI
   para que la app navegue. M6 la escribe entera; lee sus objetos del entorno, nunca por init. */

struct TeatroView: View {
    let destino: Destino

    var body: some View {
        Color.clear
            .overlay { Text("Partido") }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(IDUI.teatro)
    }
}
