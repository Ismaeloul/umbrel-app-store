import SwiftUI

/* La cápsula de indicación del cartel (a2 §22.3): la cápsula de estado sobre vídeo de §8.4 tal cual —alto
   34, relleno 5 14 5 10, separación 8, cristal de vídeo, filo blanco 16 %, sombra `0 8 20 −10`—, texto 13/650
   blanco en una línea con «…», icono 18 del color del estado o la ruedita (el ⟳ que gira cada 900 ms; con
   movimiento reducido, quieto al 60 %). El texto nuevo entra con escala 0,96 y opacidad 0 (340 ms) y el viejo
   se funde (320 ms). */

struct CapsulaCamaraVista: View {
    let capsula: CapsulaCamara
    let anchoMaximo: CGFloat
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        HStack(spacing: 8) {
            icono
            Text(capsula.texto)
                .estilo(EstiloTexto(tamano: 13, peso: 650))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .foregroundStyle(Palco.onVideo)
        .padding(.leading, 10)
        .padding(.trailing, 14)
        .padding(.vertical, 5)
        .frame(minHeight: 34)
        .frame(maxWidth: anchoMaximo)
        .fixedSize(horizontal: true, vertical: false)
        .cristal(.video, en: Capsule())
        .bordeInterior(Color.white.opacity(0.16), forma: Capsule())
        .sombra([CapaSombra(y: 8, desenfoque: 20, expansion: -10, color: Color.black.opacity(0.7))], forma: Capsule())
        .islaOscura()
        .id(capsula.texto)
        .transition(.asymmetric(
            insertion: .scale(scale: 0.96).combined(with: .opacity).animation(.easeOut(duration: 0.34)),
            removal: .opacity.animation(Movimiento.salida)))
    }

    @ViewBuilder private var icono: some View {
        if capsula.ruedita {
            Ruedita(reducido: reducido)
        } else if let nombre = capsula.icono {
            IconoPalco(nombre, tamano: 18).foregroundStyle(tinta)
        }
    }

    private var tinta: Color {
        switch capsula.tinta {
        case .blanco: Palco.onVideo
        case .ambar: Palco.weakInk
        case .rojo: Palco.fail
        case .verde: Palco.ok
        }
    }
}

/// El ⟳ que gira 360° cada 900 ms lineal (a2 §22.3, el de la agenda ocupada); reducido: quieto al 60 %.
private struct Ruedita: View {
    let reducido: Bool
    @State private var girando = false

    var body: some View {
        IconoPalco(.refresh, tamano: 18)
            .rotationEffect(.degrees(girando ? 360 : 0))
            .opacity(reducido ? 0.6 : 1)
            .animation(reducido ? nil : .linear(duration: 0.9).repeatForever(autoreverses: false), value: girando)
            .onAppear { girando = !reducido }
    }
}
