import Foundation

/* Gestos con los números de la web (b-arquitectura §2.1.5, M2): `classifySwipe` de lib/gestures.ts, el
   soltar del borde izquierdo (a2 §27.4) y el mini de player/MiniPlayer.tsx. Solo deciden; los reconocedores
   (Palco `DeslizamientoHorizontal`, `BordeAtras`, `CapaToquesVideo`, el mini) miden y llaman.
   Velocidades en pt/s (la web mide px/ms: 0,45 px/ms = 450 pt/s). */

enum ResultadoDeslizar: Sendable { case ninguno, izquierda, derecha, arriba, abajo }

/// Ejes que interesan a un gesto (`axis` de `SwipeOptions`).
enum EjeDeslizar: Sendable { case horizontal, vertical, ambos }

enum Deslizamiento {
    /// Distancia mínima (`threshold`, 56 px) de lib/gestures.ts.
    static let distancia = 56.0
    /// Velocidad que cuenta aunque el recorrido sea corto (`velocity` 0,45 px/ms).
    static let velocidad = 450.0
    /// Recorrido mínimo para que cuente la velocidad (24 px).
    static let minimoRapido = 24.0
    /// Un eje domina si es 1,4 veces el otro.
    static let dominio = 1.4

    /// classifySwipe: distancia ≥ 56 pt o velocidad ≥ 450 pt/s con ≥ 24 pt, y eje dominante ≥ 1,4×.
    static func clasificar(dx: Double, dy: Double, vx: Double, vy: Double) -> ResultadoDeslizar {
        clasificar(dx: dx, dy: dy, vx: vx, vy: vy, eje: .ambos)
    }

    /// Igual, con los ejes que interesan y el umbral de distancia (el mini usa 72).
    static func clasificar(
        dx: Double, dy: Double, vx: Double, vy: Double, eje: EjeDeslizar, umbral: Double = distancia
    ) -> ResultadoDeslizar {
        let ax = abs(dx)
        let ay = abs(dy)
        let horizontal = ax > ay * dominio
        let vertical = ay > ax * dominio
        let recorrido = max(ax, ay)
        let rapidez = max(abs(vx), abs(vy))
        let lejos = recorrido >= umbral || (rapidez >= velocidad && recorrido >= minimoRapido)
        guard lejos else { return .ninguno }
        if horizontal && eje != .vertical { return dx < 0 ? .izquierda : .derecha }
        if vertical && eje != .horizontal { return dy < 0 ? .arriba : .abajo }
        return .ninguno
    }
}

enum Volver {
    /// Fracción del ancho que decide (a2 §27.4).
    static let fraccion = 0.35
    /// Soltar el borde izquierdo: vuelve si dx ≥ 0,35·ancho o (vx ≥ 450 y dx ≥ 24).
    static func decide(dx: Double, vx: Double, ancho: Double) -> Bool {
        dx >= fraccion * ancho || (vx >= Deslizamiento.velocidad && dx >= Deslizamiento.minimoRapido)
    }
}

/* El mini de la web (MiniPlayer.tsx): arrastre en los dos ejes; arriba ≥ 72 abre el teatro; a un lado ≥ 72
   lo descarta (detiene con «Reproducción detenida» y «Deshacer»); abajo no hay a dónde ir (la barra) y se
   frena al 25 %. Cruzar el umbral de descartar da un toque `fuerte` una vez por cruce. */
enum GestosMini {
    /// Arrastre que decide (`DISMISS_PX`).
    static let umbral = 72.0
    /// Freno del arrastre hacia abajo (`dy * 0.25`).
    static let descartarFraccion = 0.25
    /// La opacidad baja con `|dx| / 320` (mínimo 0,35); también la salida volando.
    static let salidaMs = 320.0
    /// Opacidad mínima mientras se arrastra.
    static let opacidadMinima = 0.35
    /// Salida volando al descartar (220 ms, `window.setTimeout(finish, 220)`).
    static let vueloMs = 220.0

    enum Soltar: Sendable { case volver, abrir, descartar }

    static func soltar(dx: Double, dy: Double, vx: Double, vy: Double, ancho: Double) -> Soltar {
        switch Deslizamiento.clasificar(dx: dx, dy: dy, vx: vx, vy: vy, eje: .ambos, umbral: umbral) {
        case .arriba: .abrir
        case .izquierda, .derecha: .descartar
        case .abajo, .ninguno: .volver
        }
    }

    /// ¿El arrastre está pasado el umbral de descartar? (para el toque `fuerte` al cruzarlo).
    static func pasado(dx: Double, dy: Double) -> Bool {
        abs(dx) >= umbral && abs(dx) > abs(dy)
    }

    /// Lo que se mueve el mini con el dedo: x 1:1, y frenada hacia abajo, y su opacidad.
    static func arrastre(dx: Double, dy: Double) -> (x: Double, y: Double, opacidad: Double) {
        let y = dy > 0 ? dy * descartarFraccion : dy
        return (dx, y, max(opacidadMinima, 1 - abs(dx) / salidaMs))
    }
}
