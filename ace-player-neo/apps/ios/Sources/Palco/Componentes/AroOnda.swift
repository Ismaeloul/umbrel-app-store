import SwiftUI

/// Aro que late (el del `LiveDot` y el del anillo): mismo reloj que `Onda`, con trazo en vez de relleno.
struct AroOnda: View {
    let color: Color
    let escalaMaxima: CGFloat
    let diametro: CGFloat
    let grosor: CGFloat
    @Environment(\.movimientoReducido) private var reducido
    @Environment(\.vistaActiva) private var vistaActiva

    var body: some View {
        if reducido {
            // LiveDot reducido: aro fijo a opacidad 0,45 (a1 §7.6).
            Circle().strokeBorder(color, lineWidth: grosor).frame(width: diametro, height: diametro).opacity(0.45)
        } else {
            TimelineView(.animation(minimumInterval: nil, paused: !vistaActiva)) { contexto in
                AroFase(
                    color: color, diametro: diametro, grosor: grosor,
                    fase: Movimiento.onda(contexto.date.timeIntervalSinceReferenceDate, maxima: Double(escalaMaxima)))
            }
            .frame(width: diametro, height: diametro)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}

private struct AroFase: View {
    let color: Color
    let diametro: CGFloat
    let grosor: CGFloat
    let fase: (escala: Double, opacidad: Double)

    var body: some View {
        Circle()
            .strokeBorder(color, lineWidth: grosor)
            .frame(width: diametro, height: diametro)
            .scaleEffect(fase.escala)
            .opacity(fase.opacidad)
    }
}
