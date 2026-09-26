import Foundation

/* A quién va un arrastre que empieza sobre algo que se desplaza de lado (prueba de Isma en su iPhone: en la
   agenda, empezar sobre un partido movía el carril en vez de subir y bajar). Lo vertical manda: un carril o un
   pan horizontal solo se quedan el gesto si lo horizontal es CLARAMENTE mayor; si no, la página se desplaza.
   Solo decide; los reconocedores de Palco (`DeslizamientoHorizontal`, la guarda de los carriles) miden. */

enum EjeGesto {
    /// Lo horizontal tiene que ser al menos 1,2 veces lo vertical (≈ 40° desde la horizontal).
    static let dominioHorizontal = 1.2

    /// ¿Es un gesto claramente horizontal? Con recorrido nulo se mira la velocidad (el primer toque del pan).
    static func horizontal(dx: Double, dy: Double, vx: Double = 0, vy: Double = 0) -> Bool {
        let usarVelocidad = abs(dx) + abs(dy) < 0.5
        let ax = usarVelocidad ? abs(vx) : abs(dx)
        let ay = usarVelocidad ? abs(vy) : abs(dy)
        guard ax > 0 else { return false }
        return ax >= ay * dominioHorizontal
    }
}
