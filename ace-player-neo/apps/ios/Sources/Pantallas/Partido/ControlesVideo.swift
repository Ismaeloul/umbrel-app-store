import SwiftUI

/* Los controles sobre el vídeo (`.player-chrome` de PlayerSurface.tsx y player.css; a4 §5.2): un velo negro de
   seis paradas bajo las cápsulas, la fila de arriba y la de abajo (solo con canal y fuera de `error`),
   separadas con `space-between`. Aparecen y se van con opacidad (muelle estándar); invisibles no reciben
   toques. Con VoiceOver no se esconden nunca (a4 §5.7-4). */

struct ControlesVideo: View {
    let variante: VarianteEscenario
    let relleno: Margenes
    let partido: FootballMatch?
    let marcador: LiveScore?
    let ahora: Date
    let video = EntornoVideo()
    @Environment(\.movimientoReducido) private var reducido
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver

    private var visibles: Bool { video.presentacion.controlesVisibles || voiceOver }

    var body: some View {
        let foto = video.foto
        VStack(spacing: 8) {
            FilaSuperiorControles(variante: variante, partido: partido, marcador: marcador, ahora: ahora)
            Spacer(minLength: 0)
            if foto.hayCanal && foto.fase != .error {
                FilaInferiorControles(variante: variante)
            }
        }
        .padding(.top, CGFloat(relleno.arriba))
        .padding(.leading, CGFloat(relleno.izquierda))
        .padding(.bottom, CGFloat(relleno.abajo))
        .padding(.trailing, CGFloat(relleno.derecha))
        .background { VeloControles() }
        .opacity(visibles ? 1 : 0)
        .allowsHitTesting(visibles)
        .accessibilityHidden(!visibles)
        .animation(Movimiento.estandar(reducido), value: visibles)
    }
}

/// `linear-gradient(rgba(0,0,0,.55) 0%, .30 18%, transparent 36%, transparent 60%, .30 80%, .55 100%)`.
private struct VeloControles: View {
    private static let paradas: [Gradient.Stop] = [
        .init(color: .black.opacity(0.55), location: 0), .init(color: .black.opacity(0.3), location: 0.18),
        .init(color: .black.opacity(0), location: 0.36), .init(color: .black.opacity(0), location: 0.6),
        .init(color: .black.opacity(0.3), location: 0.8), .init(color: .black.opacity(0.55), location: 1),
    ]

    var body: some View {
        LinearGradient(stops: VeloControles.paradas, startPoint: .top, endPoint: .bottom)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// Cápsula de cristal de vídeo (`.player-cap.glass--video`): sin relleno propio (la forman los botones de 44),
/// borde 1 blanco al 16 % y la sombra `0 6 18 −8 rgba(2,8,18,.55)`.
struct CapsulaVideo<Contenido: View>: View {
    @ViewBuilder let contenido: () -> Contenido

    var body: some View {
        HStack(spacing: 0) { contenido() }
            .cristal(.video, en: Capsule())
            .bordeInterior(Color.white.opacity(0.16), forma: Capsule())
            .sombra(.video, forma: Capsule())
    }
}
