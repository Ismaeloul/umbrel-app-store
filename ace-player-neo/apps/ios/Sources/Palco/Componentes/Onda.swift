import SwiftUI

/// Halo de «en directo» (`ace-onda`, base.css; a1 §7.3): una copia del punto crece de 1 a `escalaMaxima` y se
/// apaga de 0,75 a 0 en el 70 % de 2 s con `--ease-out`, sin fin. Todas laten a la vez (reloj común). Parada
/// con movimiento reducido y en las pestañas ocultas.
struct Onda: View {
    let color: Color
    let escalaMaxima: CGFloat
    let diametro: CGFloat
    @Environment(\.movimientoReducido) private var reducido
    @Environment(\.vistaActiva) private var vistaActiva

    init(color: Color, escalaMaxima: CGFloat, diametro: CGFloat) {
        self.color = color
        self.escalaMaxima = escalaMaxima
        self.diametro = diametro
    }

    var body: some View {
        if !reducido {
            TimelineView(.animation(minimumInterval: nil, paused: !vistaActiva)) { contexto in
                CirculoOnda(
                    color: color, diametro: diametro,
                    fase: Movimiento.onda(contexto.date.timeIntervalSinceReferenceDate, maxima: Double(escalaMaxima)))
            }
            .frame(width: diametro, height: diametro)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}

private struct CirculoOnda: View {
    let color: Color
    let diametro: CGFloat
    let fase: (escala: Double, opacidad: Double)

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: diametro, height: diametro)
            .scaleEffect(fase.escala)
            .opacity(fase.opacidad)
    }
}

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
