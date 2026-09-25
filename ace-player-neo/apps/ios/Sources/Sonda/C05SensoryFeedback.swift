import SwiftUI

// Canario C5 (b-arquitectura §5.3): `.sensoryFeedback(trigger:_:)` con un cierre que devuelve el
// feedback, tal como lo usará Palco/Haptica/HapticaRaiz.swift (§2.2.7).
// Plan B: ocho .sensoryFeedback(_:trigger:) fijos. Se borra al cerrar la fase 0.

enum SondaTipoHaptico: String, CaseIterable, Sendable {
    case seleccion, ligera, media, fuerte, rigida, exito, aviso, error

    var feedback: SensoryFeedback {
        switch self {
        case .seleccion: .selection
        case .ligera: .impact(weight: .light)
        case .media: .impact(weight: .medium)
        case .fuerte: .impact(weight: .heavy)
        case .rigida: .impact(flexibility: .rigid)
        case .exito: .success
        case .aviso: .warning
        case .error: .error
        }
    }
}

struct SondaPulsoHaptico: Equatable, Sendable {
    var n: Int
    var tipo: SondaTipoHaptico
}

@MainActor @Observable final class SondaHaptica {
    private(set) var pulso = SondaPulsoHaptico(n: 0, tipo: .seleccion)
    private let origen = ContinuousClock.now

    func disparar(_ tipo: SondaTipoHaptico) {
        let t = ContinuousClock.now - origen
        let ms = Double(t.components.seconds) * 1000 + Double(t.components.attoseconds) / 1e15
        guard ms >= 0 else { return }
        pulso = SondaPulsoHaptico(n: pulso.n &+ 1, tipo: tipo)
    }
}

struct SondaHapticaRaiz: ViewModifier {
    let haptica: SondaHaptica
    func body(content: Content) -> some View {
        content.sensoryFeedback(trigger: haptica.pulso) { _, nuevo in nuevo.tipo.feedback }
    }
}

struct SondaC5Haptica: View {
    @State private var haptica = SondaHaptica()
    var body: some View {
        Button("Vibrar") { haptica.disparar(.rigida) }
            .modifier(SondaHapticaRaiz(haptica: haptica))
    }
}
