import SwiftUI

/// Degradados de CSS traducidos a SwiftUI (a1 §13.9 riesgo 8).
enum Degradado {
    /// `linear-gradient(<grados>deg, …)` sobre una caja de `ancho`×`alto`: 0° = hacia arriba, sentido horario;
    /// la línea del degradado mide `|ancho·sen a| + |alto·cos a|` (las esquinas quedan en 0 % y 100 %).
    static func lineal(_ grados: Double, _ colores: [Color], ancho: CGFloat, alto: CGFloat) -> LinearGradient {
        let puntos = extremos(grados, ancho: Double(ancho), alto: Double(alto))
        return LinearGradient(colors: colores, startPoint: puntos.inicio, endPoint: puntos.fin)
    }

    /// Lo mismo con paradas (`color pos%`).
    static func lineal(_ grados: Double, paradas: [Gradient.Stop], ancho: CGFloat, alto: CGFloat) -> LinearGradient {
        let puntos = extremos(grados, ancho: Double(ancho), alto: Double(alto))
        return LinearGradient(stops: paradas, startPoint: puntos.inicio, endPoint: puntos.fin)
    }

    static func extremos(_ grados: Double, ancho: Double, alto: Double) -> (inicio: UnitPoint, fin: UnitPoint) {
        let r = grados * Double.pi / 180
        let s = sin(r)
        let c = cos(r)
        let largo = abs(ancho * s) + abs(alto * c)
        let dx = ancho > 0 ? s * largo / (2 * ancho) : 0
        let dy = alto > 0 ? c * largo / (2 * alto) : 0
        return (UnitPoint(x: 0.5 - dx, y: 0.5 + dy), UnitPoint(x: 0.5 + dx, y: 0.5 - dy))
    }

    /// `radial-gradient(<radioX> <radioY> at <centro>, color, transparent <hasta>)`: una elipse de radios en pt
    /// (un círculo escalado en vertical). El transparente es el mismo color a opacidad 0 (premultiplicado).
    static func elipse(_ color: Color, radioX: CGFloat, radioY: CGFloat, hasta: CGFloat, centro: UnitPoint) -> some View {
        let escalaY: CGFloat = radioX > 0 ? radioY / radioX : 1
        return RadialGradient(colors: [color, color.opacity(0)], center: centro, startRadius: 0, endRadius: radioX * hasta)
            .scaleEffect(x: 1, y: escalaY, anchor: centro)
    }

    /// Lo mismo con paradas propias (velos de la tarjeta versus).
    static func elipse(paradas: [Gradient.Stop], radioX: CGFloat, radioY: CGFloat, centro: UnitPoint) -> some View {
        let escalaY: CGFloat = radioX > 0 ? radioY / radioX : 1
        return RadialGradient(stops: paradas, center: centro, startRadius: 0, endRadius: radioX)
            .scaleEffect(x: 1, y: escalaY, anchor: centro)
    }
}
