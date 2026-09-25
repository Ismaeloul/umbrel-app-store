import SwiftUI

/* ContenidoAyuda (b-arquitectura §2.8, M7; a6). STUB de I0 (fase 0.3b): Color.clear con su IDUI
   para que la app navegue. M7 la escribe entera; lee sus objetos del entorno, nunca por init. */

struct ContenidoAyuda: View {
    var body: some View {
        Color.clear
            .overlay { Text("Atajos de teclado") }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(IDUI.hojaAyuda)
    }
}
