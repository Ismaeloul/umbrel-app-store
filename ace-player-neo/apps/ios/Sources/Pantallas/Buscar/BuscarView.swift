import SwiftUI

/* BuscarView (b-arquitectura §2.8, M5; a5 §4). STUB de I0 (fase 0.3b): Color.clear con su IDUI
   para que la app navegue. M5 la escribe entera; lee sus objetos del entorno, nunca por init. */

struct BuscarView: View {
    var body: some View {
        Color.clear
            .overlay { Text("Buscar") }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(IDUI.pantalla("buscar"))
    }
}
