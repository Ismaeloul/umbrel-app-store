import SwiftUI

/* MiniReproductor (b-arquitectura §2.8, M6; a2 §7, a4 §19). STUB de I0 (fase 0.3b): Color.clear con su IDUI
   para que la app navegue. M6 la escribe entera; lee sus objetos del entorno, nunca por init. */

struct MiniReproductor: View {
    var body: some View {
        Color.clear
            .overlay { Text("Reproductor") }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(IDUI.mini)
    }
}
