import SwiftUI

/* El velo inferior (b-arquitectura §2.4.6, M4; a2 §5; shell.css `.bottom-veil`; z 39): funde la lista antes de la
   barra para que no asome texto alrededor de la píldora de cristal. De lado a lado, pegado abajo, sin toques;
   alto safeB + 100 (con mini, + 180); `linear-gradient(to top, --bg 58 %, transparent)`: opaco hasta el 58 % de
   su alto desde abajo y de ahí a transparente. No se anima. */

struct VeloInferior: View {
    let mini: Bool
    @Environment(\.maquetacion) private var maquetacion

    var body: some View {
        let alto: Double = maquetacion.altoVelo(mini: mini)
        LinearGradient(
            stops: [
                .init(color: Palco.bg, location: 0),
                .init(color: Palco.bg, location: 0.58),
                .init(color: Palco.bg.opacity(0), location: 1),
            ],
            startPoint: .bottom, endPoint: .top
        )
        .frame(width: maquetacion.ancho, height: alto)
        .offset(y: maquetacion.alto - alto)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
