import SwiftUI

/// Corte a negro al pasar de una fuente a OTRA (`.player-cut`, a4 §9): opacidad 1 durante el 55 % de 560 ms y
/// baja a 0 en el resto con `ease-out` (0,2 0,7 0,3 1). Con movimiento reducido, 200 ms con la misma forma.
/// Cada vez que `disparo` cambia, vuelve a empezar.
struct CorteNegro: View {
    let disparo: Int
    @Environment(\.movimientoReducido) private var reducido

    private var total: Double { reducido ? 0.2 : 0.56 }
    private static let salida = UnitCurve.bezier(
        startControlPoint: UnitPoint(x: 0.2, y: 0.7), endControlPoint: UnitPoint(x: 0.3, y: 1))

    var body: some View {
        let quieto: Double = total * 0.55
        let bajada: Double = total * 0.45
        Color.black
            .keyframeAnimator(initialValue: 0.0, trigger: disparo) { vista, opacidad in
                vista.opacity(opacidad)
            } keyframes: { _ in
                KeyframeTrack {
                    MoveKeyframe(1.0)
                    LinearKeyframe(1.0, duration: quieto)
                    LinearKeyframe(0.0, duration: bajada, timingCurve: CorteNegro.salida)
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
