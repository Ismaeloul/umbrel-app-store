import SwiftUI

/* EscenarioVideo (b-arquitectura §2.8, M6; a4 §5). STUB de I0 (fase 0.3b): Color.clear con su IDUI
   para que la app navegue. M6 la escribe entera; lee sus objetos del entorno, nunca por init. */

struct EscenarioVideo: View {
    let inmersivo: Bool

    var body: some View {
        Color.clear
            .overlay { Text("Vídeo") }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(IDUI.videoTeatro)
    }
}
