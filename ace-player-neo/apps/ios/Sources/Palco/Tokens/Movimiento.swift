import SwiftUI

/// Muelles de la web (b-arquitectura §2.2.2; a1 §7). Cada `linear()` de tokens.css es la respuesta de
/// estos mismos muelles de SwiftUI muestreada (a1 §7.1); con movimiento reducido, `ease-out` corto (a1 §7.6).
enum Movimiento {
    /// `--ease-rapido` 340 ms: pulsar, anillo de señal, menús.
    static func rapido(_ reducido: Bool) -> Animation {
        reducido ? .easeOut(duration: 0.12) : .spring(duration: 0.25, bounce: 0)
    }
    /// `--ease-estandar` 520 ms: gota de la barra y del segmentado, hojas, pulgar, toasts, escalonado.
    static func estandar(_ reducido: Bool) -> Animation {
        reducido ? .easeOut(duration: 0.15) : .spring(duration: 0.4, bounce: 0.15)
    }
    /// `--ease-heroe` 800 ms: entrar a un partido, gol.
    static var heroe: Animation { .spring(duration: 0.55, bounce: 0.3) }
    /// La curva estándar estirada a 800 ms (barra de progreso; a1 §7.1).
    static var progreso: Animation { .spring(duration: 0.615, bounce: 0.15) }
    /// `--ease-out` / `--dur-fade` 320 ms: fundidos de salida.
    static var salida: Animation { .timingCurve(0.2, 0.7, 0.3, 1, duration: 0.32) }
    /// Fundido de vista (`ace-funde` 340 ms; reducido 120 ms).
    static func vista(_ reducido: Bool) -> Animation { .easeOut(duration: reducido ? 0.12 : 0.34) }
    /// Soltar un gesto con la velocidad del dedo (muelle estándar).
    static func soltar(velocidad: Double) -> Animation {
        .interpolatingSpring(duration: 0.4, bounce: 0.15, initialVelocity: velocidad)
    }
    /// Retraso del escalonado: `min(i, 10) × 36 ms` (a1 §7.2, §7.5).
    static func escalonado(_ i: Int) -> Double { Double(min(i, 10)) * 0.036 }

    /// `--dur-pulse`: latido de la onda y del punto de directo (a1 §7.2).
    static let pulso: Double = 2
    /// Comprobando: relleno de las barras del medidor (a1 §10.7).
    static let comprobando: Double = 1.4
    /// Giro del anillo «comprobando» y brillo del esqueleto (a1 §7.2).
    static let giro: Double = 1.6

    /// `cubic-bezier(0.2, 0.7, 0.3, 1)` evaluada en `x` ∈ [0, 1] (la curva de `--ease-out`), para las
    /// animaciones continuas que se pintan con `TimelineView` (ondas, brillo, comprobando).
    static func curvaSalida(_ x: Double) -> Double {
        let objetivo = min(1, max(0, x))
        var t = objetivo
        for _ in 0..<8 {
            let actual = bezier(t, 0.2, 0.3) - objetivo
            let derivada = derivadaBezier(t, 0.2, 0.3)
            if abs(derivada) < 1e-6 { break }
            t = min(1, max(0, t - actual / derivada))
        }
        return bezier(t, 0.7, 1)
    }

    private static func bezier(_ t: Double, _ p1: Double, _ p2: Double) -> Double {
        let u = 1 - t
        let a = 3 * u * u * t * p1
        let b = 3 * u * t * t * p2
        return a + b + t * t * t
    }

    private static func derivadaBezier(_ t: Double, _ p1: Double, _ p2: Double) -> Double {
        let u = 1 - t
        let a = 3 * u * u * p1
        let b = 6 * u * t * (p2 - p1)
        let c = 3 * t * t * (1 - p2)
        return a + b + c
    }

    /// `ace-onda` (base.css): 0 % escala 1 y opacidad 0,75 → 70 % escala `maxima` y opacidad 0 → 100 % igual.
    /// `t` = segundos desde el origen común (todas las ondas laten a la vez, como en la web).
    static func onda(_ t: Double, maxima: Double) -> (escala: Double, opacidad: Double) {
        let fase = t.truncatingRemainder(dividingBy: pulso) / pulso
        guard fase < 0.7 else { return (maxima, 0) }
        let p = curvaSalida(fase / 0.7)
        return (1 + (maxima - 1) * p, 0.75 * (1 - p))
    }
}
