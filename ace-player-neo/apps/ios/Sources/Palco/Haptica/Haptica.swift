import Observation
import SwiftUI

// Háptica (b-arquitectura §2.2.7; a1 §8; lib/haptics.ts). Un pulso central: quien quiere vibrar llama a
// `Haptica.disparar(_:)` y el único `.sensoryFeedback` de la app (HapticaRaiz, en la raíz) lo convierte en
// la sensación del sistema. La regla (selección callada con movimiento reducido, anti-ráfaga de 40 ms por
// tipo) es pura y está probada en Core/Reglas/Haptica.

/// Cada vez que cambia, la raíz vibra con `tipo`.
struct PulsoHaptico: Equatable, Sendable {
    var n: Int
    var tipo: TipoHaptico
}

@MainActor @Observable final class Haptica {
    private(set) var pulso = PulsoHaptico(n: 0, tipo: .seleccion)
    var reducirMovimiento = false
    @ObservationIgnored private var ultimo: (tipo: TipoHaptico, ms: Double)?
    private let origen = ContinuousClock.now

    /// La ÚNICA forma de hacer vibrar el iPhone.
    func disparar(_ tipo: TipoHaptico) {
        let t = ContinuousClock.now - origen
        let ms = Double(t.components.seconds) * 1000 + Double(t.components.attoseconds) / 1e15
        guard ReglaHaptica.suena(tipo, ahoraMs: ms, ultimo: ultimo, reducirMovimiento: reducirMovimiento) else { return }
        ultimo = (tipo, ms)
        pulso = PulsoHaptico(n: pulso.n &+ 1, tipo: tipo)
    }
}

extension TipoHaptico {
    /// La sensación del sistema de cada tipo de la web (a1 §8).
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
