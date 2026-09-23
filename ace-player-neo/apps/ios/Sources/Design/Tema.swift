import SwiftUI

/* Sistema de diseño «Luz de focos» en SwiftUI (docs/diseno/sistema.md §5).
   La app no imita el cristal: usa el del sistema (Liquid Glass con el SDK de
   iOS 26) y, en iOS 17-25, materiales. Los colores son los tokens de la web,
   uno por colorset con su valor claro y oscuro (scripts/generar-recursos.mjs). */

/// Tokens de color (mismos nombres y significado que en la web).
public enum Tinta {
    public static var fondo: Color { Color("Bg") }
    public static var fondoHundido: Color { Color("BgSunk") }
    public static var superficie: Color { Color("Surface") }
    public static var superficie2: Color { Color("Surface2") }
    public static var linea: Color { Color("Line") }
    public static var lineaFuerte: Color { Color("LineStrong") }
    public static var texto: Color { Color("Text") }
    public static var texto2: Color { Color("Text2") }
    public static var texto3: Color { Color("Text3") }
    /// Cielo de relleno (acción principal).
    public static var acento: Color { Color("Accent") }
    public static var sobreAcento: Color { Color("OnAccent") }
    /// Cielo como texto y «en directo».
    public static var acentoTinta: Color { Color("AccentInk") }
    public static var acentoBorde: Color { Color("AccentEdge") }
    /// Verificada.
    public static var ok: Color { Color("Ok") }
    public static var okTinta: Color { Color("OkInk") }
    /// Floja (el ámbar solo significa esto).
    public static var floja: Color { Color("Weak") }
    public static var flojaTinta: Color { Color("WeakInk") }
    /// Sin señal.
    public static var fallo: Color { Color("Fail") }
    public static var falloTinta: Color { Color("FailInk") }
    /// Respaldo opaco del cristal («Reducir transparencia»).
    public static var cristalSolido: Color { Color("GlassSolid") }
}

/// Los tres muelles del sistema (los mismos que la web muestrea con `linear()`).
public enum Muelle {
    /// Pulsar, estados.
    public static var rapido: Animation { .spring(duration: 0.25, bounce: 0) }
    /// Gota de la barra y del segmentado, hojas, paneles.
    public static var estandar: Animation { .spring(duration: 0.4, bounce: 0.15) }
    /// Entrar a un partido, un gol, progreso del partido.
    public static var heroe: Animation { .spring(duration: 0.55, bounce: 0.3) }
}

/// Medidas base (rejilla de 4 pt; objetivo táctil de 44 pt).
public enum Medida {
    public static let toque: CGFloat = 44
    public static let margen: CGFloat = 16
    public static let radioL: CGFloat = 20
    public static let radioM: CGFloat = 14
}

/// Cristal para controles flotantes: Liquid Glass del sistema en iOS 26 y
/// material en iOS 17-25; opaco con «Reducir transparencia».
private struct Cristal<Forma: Shape>: ViewModifier {
    let forma: Forma
    @Environment(\.accessibilityReduceTransparency) private var sinTransparencia

    func body(content: Content) -> some View {
        if sinTransparencia {
            content.background(Tinta.cristalSolido, in: forma)
        } else {
            #if compiler(>=6.2)
                if #available(iOS 26.0, *) {
                    content.glassEffect(.regular, in: forma)
                } else {
                    content.background(.ultraThinMaterial, in: forma)
                }
            #else
                content.background(.ultraThinMaterial, in: forma)
            #endif
        }
    }
}

extension View {
    /// Cristal del sistema con respaldo (ver `Cristal`).
    public func cristal<Forma: Shape>(en forma: Forma) -> some View {
        modifier(Cristal(forma: forma))
    }

    /// Cristal en cápsula, la forma de los controles flotantes.
    public func cristal() -> some View {
        modifier(Cristal(forma: Capsule()))
    }
}

extension Font {
    /// Números grandes (marcador, horas): SF Pro comprimida con cifras de ancho fijo.
    public static func numeros(_ estilo: Font.TextStyle = .title3, peso: Font.Weight = .semibold) -> Font {
        .system(estilo, design: .default, weight: peso).width(.compressed).monospacedDigit()
    }

    /// Titulares: SF Pro expandida.
    public static func titular(_ estilo: Font.TextStyle = .largeTitle) -> Font {
        .system(estilo, design: .default, weight: .bold).width(.expanded)
    }
}
