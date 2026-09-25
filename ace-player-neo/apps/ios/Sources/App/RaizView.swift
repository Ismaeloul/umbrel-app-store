import SwiftUI

/// Raíz de la app (b-arquitectura §2.3, I0→M4). PROVISIONAL de la poda (fase 0.2, §4.1.2): «Ace Neo»
/// sobre el fondo de la app, para que el objetivo compile sin la interfaz vieja. La fase 0.3b escribe
/// la raíz del contrato (emparejar ↔ app, entorno, háptica y fuente raíz).
struct RaizView: View {
    var body: some View {
        ZStack {
            Palco.bg.ignoresSafeArea()
            Text("Ace Neo")
                .foregroundStyle(Palco.text)
        }
    }
}
