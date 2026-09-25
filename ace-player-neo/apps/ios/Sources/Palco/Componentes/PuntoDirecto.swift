import SwiftUI

/// `<LiveDot>` de la web (a1 §10.9; ui/LiveRing.css): caja de 18 que recorta, punto de 8 `--live` y un aro
/// de 12 (1,5 de trazo) que late hasta 1,45 cada 2 s. Movimiento reducido: el aro quieto a 0,45.
/// Decorativo salvo `etiqueta`.
struct PuntoDirecto: View {
    let etiqueta: String?

    init(etiqueta: String? = nil) {
        self.etiqueta = etiqueta
    }

    var body: some View {
        ZStack {
            AroOnda(color: Palco.live, escalaMaxima: 1.45, diametro: 12, grosor: 1.5)
            Circle().fill(Palco.live).frame(width: 8, height: 8)
        }
        .frame(width: 18, height: 18)
        .clipped()
        .accessibilityHidden(etiqueta == nil)
        .accessibilityLabel(etiqueta ?? "")
    }
}
