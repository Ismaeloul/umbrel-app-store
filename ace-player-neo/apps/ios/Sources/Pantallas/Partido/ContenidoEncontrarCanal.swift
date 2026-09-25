import SwiftUI

/* ContenidoEncontrarCanal (b-arquitectura §2.8, M6; a4 §13.3). STUB de I0 (fase 0.3b): Color.clear con su IDUI
   para que la app navegue. M6 la escribe entera; lee sus objetos del entorno, nunca por init. */

struct ContenidoEncontrarCanal: View {
    var body: some View {
        Color.clear
            .overlay { Text("Encontrar canal") }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(IDUI.hojaEncontrarCanal)
    }
}
