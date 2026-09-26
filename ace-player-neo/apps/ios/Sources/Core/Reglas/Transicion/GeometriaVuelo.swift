import Foundation

/* Geometría de la transición tarjeta → teatro y de los vuelos (b-arquitectura §3.5, M4; decisión 3 de Isma;
   a1 §7.5 y a2 §11). Puro [L]: la capa del teatro, el vuelo de escudos y la pestaña de debajo solo leen
   estos números; las vistas no calculan nada. Todo en pt y en coordenadas de la ventana. */

/// Lo que hay que aplicar a una vista del tamaño de `destino` para que se vea dentro de `origen`:
/// escala uniforme (la tarjeta no se deforma) y desplazamiento de su esquina superior izquierda.
struct TransformacionVuelo: Hashable, Sendable {
    var escala: Double
    var dx: Double
    var dy: Double

    static let identidad = TransformacionVuelo(escala: 1, dx: 0, dy: 0)
}

enum GeometriaVuelo {
    /// Interpolación lineal de dos números (`p` sin recortar: los muelles se pasan de 1 y vuelven).
    static func mezclar(_ a: Double, _ b: Double, _ p: Double) -> Double { a + (b - a) * p }

    /// Marco intermedio entre dos marcos.
    static func marco(desde a: Marco, hasta b: Marco, progreso p: Double) -> Marco {
        Marco(x: mezclar(a.x, b.x, p), y: mezclar(a.y, b.y, p),
              ancho: mezclar(a.ancho, b.ancho, p), alto: mezclar(a.alto, b.alto, p))
    }

    /// Escala uniforme que mete `destino` en `origen` por el ancho (la capa del teatro crece desde la tarjeta
    /// sin deformarse: §3.5 «escala uniformemente desde el marco de origen»), con los bordes de arriba
    /// alineados: dentro de la tarjeta asoma lo alto del teatro (el vídeo). El recorte lo pone `marco(…)` entre
    /// el origen y la ventana. Con `p` = 0 la capa empieza en el origen; con `p` = 1 es la identidad.
    static func zoom(origen: Marco, destino: Marco, progreso p: Double) -> TransformacionVuelo {
        guard destino.ancho > 0, destino.alto > 0, origen.ancho > 0 else { return .identidad }
        let escalaInicial = origen.ancho / destino.ancho
        let xInicial = origen.x - destino.x * escalaInicial
        let yInicial = origen.y - destino.y * escalaInicial
        return TransformacionVuelo(escala: mezclar(escalaInicial, 1, p), dx: mezclar(xInicial, 0, p),
                                   dy: mezclar(yInicial, 0, p))
    }

    /// Radio de las esquinas del recorte durante el zoom, en pt de pantalla: el del origen (tarjeta 14, héroe
    /// 24, mini 18) → 0 (§3.5). Nunca negativo aunque el muelle se pase de 1.
    static func radio(inicial: Double, progreso p: Double) -> Double {
        max(0, mezclar(inicial, 0, min(1, max(0, p))))
    }

    /// El contenido de la tarjeta se funde sobre la capa que crece: `1 − min(1, 2p)` (§3.5).
    static func opacidadContenidoTarjeta(_ p: Double) -> Double { 1 - min(1, max(0, 2 * p)) }

    /// La pestaña de debajo durante el arrastre del borde: opacidad 1 y `x = −16·(1 − min(1, dx/ancho))`
    /// (a2 §2.4: la entrada «atrás» de §11 con el dedo).
    static func entradaPestanaConBorde(dx: Double, ancho: Double) -> Double {
        guard ancho > 0 else { return -16 }
        let p = min(1, max(0, dx / ancho))
        return -16 * (1 - p)
    }

    /// El arrastre del borde nunca va a la izquierda de 0 (a2 §2.4: «hacia la izquierda no pasa de 0»).
    static func arrastreBorde(_ dx: Double) -> Double { max(0, dx) }

    /// Desplazamiento de entrada de una vista (a2 §11): +16 al ir adelante, −16 atrás, 0 con movimiento reducido.
    static func entradaVista(_ sentido: Sentido, reducido: Bool) -> Double {
        guard !reducido else { return 0 }
        return sentido == .adelante ? 16 : -16
    }

    /// Radio del origen de cada apertura (§3.5; a2 §7 para el mini).
    static func radioOrigen(heroe: Bool, mini: Bool) -> Double {
        if mini { return 18 }
        return heroe ? 24 : 14
    }
}
