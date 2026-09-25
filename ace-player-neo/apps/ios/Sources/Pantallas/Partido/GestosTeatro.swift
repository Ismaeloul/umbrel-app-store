import Foundation

/* Umbrales de los gestos del teatro y del mini, con los números de la web (lib/gestures.ts › classifySwipe,
   MiniPlayer.tsx; a4 §3.3, §19.3). Puros. Cuando M2 publique `Deslizamiento` y `GestosMini`
   (Core/Reglas/Gestos) con estos mismos números, se sustituyen por ellos sin tocar las vistas. */

enum DireccionGesto: Sendable, Equatable { case ninguna, izquierda, derecha, arriba, abajo }

enum GestosTeatro {
    /// Distancia que cuenta como deslizamiento (56; 72 en el mini).
    static let umbral = 56.0
    static let umbralMini = 72.0
    /// O rápido: ≥ 450 pt/s (0,45 pt/ms) con ≥ 24 pt de recorrido.
    static let velocidad = 450.0
    static let recorridoRapido = 24.0
    /// Eje dominante: 1,4 veces el otro.
    static let dominio = 1.4
    /// Bloqueo de eje a los 8 pt.
    static let bloqueoEje = 8.0

    /// `classifySwipe` con la velocidad al soltar.
    static func clasificar(dx: Double, dy: Double, vx: Double, vy: Double, umbral: Double = umbral) -> DireccionGesto {
        let ax = abs(dx)
        let ay = abs(dy)
        let recorrido = max(ax, ay)
        let rapido = max(abs(vx), abs(vy)) >= velocidad && recorrido >= recorridoRapido
        guard recorrido >= umbral || rapido else { return .ninguna }
        if ax > ay * dominio { return dx < 0 ? .izquierda : .derecha }
        if ay > ax * dominio { return dy < 0 ? .arriba : .abajo }
        return .ninguna
    }

    /// El texto de «Emitiendo» y el vídeo se desplazan `clamp(dx/3, −60, 60)` mientras se arrastra (a4 §12.5).
    static func desplazamientoTexto(_ dx: Double) -> Double { max(-60, min(60, dx / 3)) }

    /// La siguiente o anterior en bucle entre las visibles (`stepSource`): si la activa no está, la primera
    /// (o la última hacia atrás).
    static func paso(_ ids: [String], activa: String?, delta: Int) -> String? {
        guard !ids.isEmpty else { return nil }
        guard let activa, let i = ids.firstIndex(of: activa) else { return delta >= 0 ? ids.first : ids.last }
        return ids[((i + delta) % ids.count + ids.count) % ids.count]
    }

    // MARK: Mini (MiniPlayer.tsx)

    /// Durante el arrastre: hacia abajo frena al 25 % (no hay a dónde ir) y la opacidad baja con el lado.
    static func desplazamientoMini(dx: Double, dy: Double) -> (x: Double, y: Double, opacidad: Double) {
        (dx, dy > 0 ? dy * 0.25 : dy, max(0.35, 1 - abs(dx) / 320))
    }

    /// Ha cruzado el umbral de quitarlo (háptica fuerte, una vez por cruce).
    static func cruzaDescarte(dx: Double, dy: Double) -> Bool { abs(dx) >= umbralMini && abs(dx) > abs(dy) }

    enum SoltarMini: Sendable, Equatable { case volver, abrir, descartarIzquierda, descartarDerecha }

    static func soltarMini(dx: Double, dy: Double, vx: Double, vy: Double) -> SoltarMini {
        switch clasificar(dx: dx, dy: dy, vx: vx, vy: vy, umbral: umbralMini) {
        case .arriba: .abrir
        case .izquierda: .descartarIzquierda
        case .derecha: .descartarDerecha
        case .abajo, .ninguna: .volver
        }
    }
}
