import SwiftUI

/* PantallaEmparejar (b-arquitectura §2.8, M7; a2 §22, §23.3). STUB de I0 (fase 0.3b): Color.clear con su IDUI
   para que la app navegue. M7 la escribe entera; lee sus objetos del entorno, nunca por init. */

struct PantallaEmparejar: View {
    let motivo: MotivoEmparejar?

    var body: some View {
        Color.clear
            .overlay { Text("Emparejar") }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(IDUI.pantalla("emparejar"))
    }
}
