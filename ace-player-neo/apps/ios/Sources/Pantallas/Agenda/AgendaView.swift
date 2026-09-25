import SwiftUI

/* AgendaView (b-arquitectura §2.8, M5; a3). STUB de I0 (fase 0.3b): Color.clear con su IDUI
   para que la app navegue. M5 la escribe entera; lee sus objetos del entorno, nunca por init. */

struct AgendaView: View {
    var body: some View {
        Color.clear
            .overlay { Text("Agenda") }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(IDUI.pantalla("agenda"))
    }
}
