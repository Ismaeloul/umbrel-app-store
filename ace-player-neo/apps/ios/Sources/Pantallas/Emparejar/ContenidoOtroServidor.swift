import SwiftUI

/* ContenidoOtroServidor (b-arquitectura §2.8, M7; a2 §22.8). STUB de I0 (fase 0.3b): Color.clear con su IDUI
   para que la app navegue. M7 la escribe entera; lee sus objetos del entorno, nunca por init. */

struct ContenidoOtroServidor: View {
    let enlace: PairingLink

    var body: some View {
        Color.clear
            .overlay { Text("¿Emparejar con otro servidor?") }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(IDUI.hojaOtroServidor)
    }
}
