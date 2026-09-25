import SwiftUI

/// `.press` de la web (a1 §7.4): al pulsar, escala 0,975 y un velo del color del texto al 10 % con la forma
/// del control, con el muelle rápido (340 ms). El color del texto llega por `.foregroundStyle` desde fuera
/// del botón (así el velo lo hereda).
struct EstiloPulsar: ButtonStyle {
    /// La forma del velo (la del control: cápsula, círculo, rectángulo redondeado…).
    var forma = AnyShape(Capsule())
    /// Escala al pulsar (0,975; las tarjetas versus también).
    var escala: CGFloat = 0.975
    @Environment(\.movimientoReducido) private var reducido

    init(forma: AnyShape = AnyShape(Capsule()), escala: CGFloat = 0.975) {
        self.forma = forma
        self.escala = escala
    }

    func makeBody(configuration: Configuration) -> some View {
        let pulsado = configuration.isPressed
        return configuration.label
            .overlay(forma.fill(.foreground).opacity(pulsado ? 0.1 : 0).allowsHitTesting(false))
            .scaleEffect(pulsado ? escala : 1)
            .animation(Movimiento.rapido(reducido), value: pulsado)
            .contentShape(forma)
    }
}

/// Un botón sin efecto propio (el que pinta todo él mismo: la barra, filas enteras…).
struct EstiloPlano: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { configuration.label }
}
