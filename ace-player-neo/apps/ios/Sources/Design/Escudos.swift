import SwiftUI
import UIKit

/* Escudos y colores de club de Palco: el escudo real si el servidor lo da
   (`TeamBadge.crest`, cacheado sin parpadeo) y, si no, uno generado con la
   forma de escudo, el color del club y un monograma. Los colores de la
   tarjeta «versus» salen de `TeamBadge.colors` y, si faltan, del nombre. */

// MARK: - Color

/// Un color sRGB (0…1) con lo que hace falta para decidir si dos chocan.
public struct RGB: Hashable, Sendable {
    public var r: Double
    public var g: Double
    public var b: Double

    public init(r: Double, g: Double, b: Double) {
        self.r = min(1, max(0, r))
        self.g = min(1, max(0, g))
        self.b = min(1, max(0, b))
    }

    /// `#rrggbb` (con o sin almohadilla, mayúsculas o minúsculas).
    public init?(hex: String) {
        var limpio = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if limpio.hasPrefix("#") { limpio.removeFirst() }
        guard limpio.count == 6, let valor = UInt32(limpio, radix: 16) else { return nil }
        self.init(
            r: Double((valor >> 16) & 0xFF) / 255, g: Double((valor >> 8) & 0xFF) / 255,
            b: Double(valor & 0xFF) / 255)
    }

    /// Del tono derivado de un nombre (`ColorEquipo.tono`).
    public init(tono: Double, saturacion: Double = 0.62, brillo: Double = 0.66) {
        var r: CGFloat = 0
        var g: CGFloat = 0
        var b: CGFloat = 0
        var a: CGFloat = 0
        UIColor(hue: tono, saturation: saturacion, brightness: brillo, alpha: 1).getRed(&r, green: &g, blue: &b, alpha: &a)
        self.init(r: Double(r), g: Double(g), b: Double(b))
    }

    public var color: Color { Color(red: r, green: g, blue: b) }

    private static func lineal(_ c: Double) -> Double {
        c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
    }

    /// Luminancia relativa (0 negro … 1 blanco).
    public var luminancia: Double {
        0.2126 * Self.lineal(r) + 0.7152 * Self.lineal(g) + 0.0722 * Self.lineal(b)
    }

    /// Distancia euclídea en RGB lineal (0…√3).
    public func distancia(a otro: RGB) -> Double {
        let dr = Self.lineal(r) - Self.lineal(otro.r)
        let dg = Self.lineal(g) - Self.lineal(otro.g)
        let db = Self.lineal(b) - Self.lineal(otro.b)
        return (dr * dr + dg * dg + db * db).squareRoot()
    }

    /// Tono en grados (0…360); nil si es gris.
    public var tono: Double? {
        let maximo = max(r, g, b)
        let minimo = min(r, g, b)
        let delta = maximo - minimo
        guard delta > 0.04 else { return nil }
        var h: Double
        if maximo == r {
            h = (g - b) / delta
        } else if maximo == g {
            h = 2 + (b - r) / delta
        } else {
            h = 4 + (r - g) / delta
        }
        h *= 60
        if h < 0 { h += 360 }
        return h
    }

    /// Más oscuro (`factor` 0,3 = un 30 % más oscuro).
    public func oscurecido(_ factor: Double) -> RGB {
        RGB(r: r * (1 - factor), g: g * (1 - factor), b: b * (1 - factor))
    }

    /// Texto blanco o negro que se lea encima.
    public var textoEncima: Color { luminancia > 0.5 ? .black : .white }
}

/// Los dos colores de la tarjeta «versus»: local a la izquierda, visitante a la derecha.
public enum ColoresVersus {
    public struct Eleccion: Hashable, Sendable {
        public var local: RGB
        public var visitante: RGB
        /// La mitad derecha se ha oscurecido porque los dos colores chocaban.
        public var oscurecida: Bool
    }

    /// Distancia en RGB lineal por debajo de la cual dos colores «chocan».
    public static let distanciaMinima = 0.18

    /// Chocan si están muy cerca, o si tienen casi el mismo tono con parecida luminosidad.
    public static func chocan(_ a: RGB, _ b: RGB) -> Bool {
        if a.distancia(a: b) < distanciaMinima { return true }
        if let ta = a.tono, let tb = b.tono {
            let diferencia = abs(ta - tb)
            let tonoCerca = min(diferencia, 360 - diferencia) < 25
            let luzParecida = abs(a.luminancia - b.luminancia) < 0.22
            return tonoCerca && luzParecida
        }
        return false
    }

    /// El color principal del club o, si falta, el derivado del nombre.
    public static func principal(_ colores: TeamColors?, nombre: String) -> RGB {
        colores.flatMap { RGB(hex: $0.primary) } ?? RGB(tono: ColorEquipo.tono(nombre))
    }

    /// Regla de choque: si chocan, el visitante usa su secundario; si aún
    /// chocan (o no hay secundario), la mitad derecha se oscurece un 30 %.
    public static func elegir(local: TeamColors?, visitante: TeamColors?, nombreLocal: String, nombreVisitante: String)
        -> Eleccion
    {
        let izquierda = principal(local, nombre: nombreLocal)
        var derecha = principal(visitante, nombre: nombreVisitante)
        guard chocan(izquierda, derecha) else {
            return Eleccion(local: izquierda, visitante: derecha, oscurecida: false)
        }
        if let secundario = visitante?.secondary.flatMap({ RGB(hex: $0) }), !chocan(izquierda, secundario) {
            return Eleccion(local: izquierda, visitante: secundario, oscurecida: false)
        }
        derecha = derecha.oscurecido(0.3)
        return Eleccion(local: izquierda, visitante: derecha, oscurecida: true)
    }
}

// MARK: - Equipo

/// Lo que necesita un escudo: el nombre y, si el servidor lo sabe, su ficha.
public struct EquipoEscudo: Hashable, Sendable {
    public var nombre: String
    public var ficha: TeamBadge?

    public init(nombre: String, ficha: TeamBadge? = nil) {
        self.nombre = nombre
        self.ficha = ficha
    }

    /// Monograma de 2-3 letras: la abreviatura del servidor o las iniciales.
    public var monograma: String {
        if let corto = ficha?.short?.trimmingCharacters(in: .whitespaces), !corto.isEmpty {
            return String(corto.prefix(3)).uppercased()
        }
        let palabras = nombre.split(whereSeparator: { $0 == " " || $0 == "-" || $0 == "." })
            .filter { $0.count > 2 || $0.uppercased() == $0 }
        if palabras.count >= 3 {
            let letras = palabras.prefix(3).compactMap(\.first).map(String.init).joined()
            if letras.count == 3 { return letras.uppercased() }
        }
        return ColorEquipo.iniciales(nombre)
    }

    /// Color del club.
    public var color: RGB { ColoresVersus.principal(ficha?.colors, nombre: nombre) }
}

extension FootballMatch {
    public var equipoLocal: EquipoEscudo { EquipoEscudo(nombre: home, ficha: homeTeam) }
    public var equipoVisitante: EquipoEscudo { EquipoEscudo(nombre: away, ficha: awayTeam) }
}

// MARK: - Vistas

/// Forma de escudo clásico: recto arriba, redondeado abajo hasta la punta.
/// Es `InsettableShape` para que `strokeBorder` (borde por dentro) exista.
public struct FormaEscudo: InsettableShape {
    private var margen: CGFloat = 0

    public init() {}

    public func inset(by cantidad: CGFloat) -> FormaEscudo {
        var copia = self
        copia.margen += cantidad
        return copia
    }

    public func path(in marco: CGRect) -> Path {
        let rect = marco.insetBy(dx: margen, dy: margen)
        let w = rect.width
        let h = rect.height
        let x = rect.minX
        let y = rect.minY
        var camino = Path()
        let radioSuperior = w * 0.12
        camino.move(to: CGPoint(x: x + radioSuperior, y: y))
        camino.addLine(to: CGPoint(x: x + w - radioSuperior, y: y))
        camino.addQuadCurve(to: CGPoint(x: x + w, y: y + radioSuperior), control: CGPoint(x: x + w, y: y))
        camino.addLine(to: CGPoint(x: x + w, y: y + h * 0.55))
        camino.addCurve(
            to: CGPoint(x: x + w / 2, y: y + h), control1: CGPoint(x: x + w, y: y + h * 0.82),
            control2: CGPoint(x: x + w * 0.72, y: y + h * 0.96))
        camino.addCurve(
            to: CGPoint(x: x, y: y + h * 0.55), control1: CGPoint(x: x + w * 0.28, y: y + h * 0.96),
            control2: CGPoint(x: x, y: y + h * 0.82))
        camino.addLine(to: CGPoint(x: x, y: y + radioSuperior))
        camino.addQuadCurve(to: CGPoint(x: x + radioSuperior, y: y), control: CGPoint(x: x, y: y))
        camino.closeSubpath()
        return camino
    }
}

/// Escudo generado: forma de escudo con el color del club, borde y monograma.
struct EscudoGenerado: View {
    let equipo: EquipoEscudo
    var tamano: CGFloat = 40

    var body: some View {
        let color = equipo.color
        let monograma = equipo.monograma
        ZStack {
            FormaEscudo()
                .fill(
                    LinearGradient(
                        colors: [color.color.opacity(0.95), color.oscurecido(0.28).color], startPoint: .top,
                        endPoint: .bottom))
            FormaEscudo()
                .strokeBorder(.white.opacity(0.55), lineWidth: max(1, tamano * 0.045))
            Text(monograma)
                .font(.system(size: tamano * (monograma.count > 2 ? 0.3 : 0.36), weight: .heavy).width(.compressed))
                .foregroundStyle(color.textoEncima.opacity(0.95))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.horizontal, tamano * 0.08)
                .offset(y: -tamano * 0.04)
        }
        .frame(width: tamano * 0.88, height: tamano)
        .accessibilityHidden(true)
    }
}

/// El escudo del equipo: la imagen real cacheada si el servidor la da, y
/// mientras llega (o si no hay), el generado. Nunca un hueco vacío.
struct EscudoView: View {
    @Environment(AppModel.self) private var app
    let equipo: EquipoEscudo
    var tamano: CGFloat = 40
    var sombra = true

    var body: some View {
        ImagenCacheada(url: app.urlImagen(equipo.ficha?.crest)) {
            EscudoGenerado(equipo: equipo, tamano: tamano)
        }
        .frame(width: tamano, height: tamano)
        .shadow(color: .black.opacity(sombra ? 0.35 : 0), radius: sombra ? 8 : 0, y: sombra ? 4 : 0)
        .accessibilityHidden(true)
    }
}
