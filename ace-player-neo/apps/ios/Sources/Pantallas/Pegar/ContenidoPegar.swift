import SwiftUI

/* ContenidoPegar (b-arquitectura §2.8, M5; a5 §5). STUB de I0 (fase 0.3b): Color.clear con su IDUI
   para que la app navegue. M5 la escribe entera; lee sus objetos del entorno, nunca por init. */

struct ContenidoPegar: View {
    let contexto: ContextoPegar

    var body: some View {
        Color.clear
            .overlay { Text("Reproducir otro hash") }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(IDUI.hojaPegar)
    }
}
