import SwiftUI

/* Sistema de diseño «Palco» en SwiftUI (design-explorations/src/directions/03-palco/DESIGN.md).
   Negro cine con un solo acento de acción (oro), rojo para «directo» y el
   semáforo de la señal (verde · ámbar · rojo). La app no imita el cristal:
   usa el del sistema (Liquid Glass con el SDK de iOS 26) y, en iOS 17-25,
   materiales. Cada color es un colorset del catálogo con su valor claro
   («matinal») y oscuro (scripts/generar-recursos.mjs). */

/// Tokens de color. Los nombres antiguos se conservan; los de Palco se añaden.
public enum Tinta {
    /// Fondo de la app (#f3f3f4 / #05070a) y de la pantalla de arranque.
    public static var fondo: Color { Color("Bg") }
    /// Caja del vídeo sin señal.
    public static var fondoHundido: Color { Color("BgSunk") }
    /// Tarjetas y filas.
    public static var superficie: Color { Color("Surface") }
    /// Chips sin marcar, cabeceras, fila pulsada.
    public static var superficie2: Color { Color("Surface2") }
    public static var linea: Color { Color("Line") }
    public static var lineaFuerte: Color { Color("LineStrong") }
    public static var texto: Color { Color("Text") }
    public static var texto2: Color { Color("Text2") }
    public static var texto3: Color { Color("Text3") }
    /// Relleno de la acción principal (oro).
    public static var acento: Color { Color("Accent") }
    /// Texto sobre el oro.
    public static var sobreAcento: Color { Color("OnAccent") }
    /// Oro como texto y tinte global (más oscuro en claro para que se lea).
    public static var acentoTinta: Color { Color("AccentInk") }
    /// Borde del chip marcado y de la fuente activa.
    public static var acentoBorde: Color { Color("AccentEdge") }
    /// Oro de Palco: «Ver ahora», el anillo de la fuente en pantalla, la gota de la tira de días.
    public static var oro: Color { Color("Gold") }
    /// Rojo de «en directo».
    public static var directo: Color { Color("Live") }
    /// Velo sobre la imagen (negro 55 % en oscuro, blanco 70 % en claro).
    public static var velo: Color { Color("Veil") }
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

/// Los muelles del sistema.
public enum Muelle {
    /// Pulsar, estados.
    public static var rapido: Animation { .spring(duration: 0.25, bounce: 0) }
    /// Gota de la tira de días y del segmentado, hojas, paneles.
    public static var estandar: Animation { .spring(duration: 0.4, bounce: 0.15) }
    /// Entrar a un partido, un gol, progreso del partido.
    public static var heroe: Animation { .spring(duration: 0.55, bounce: 0.3) }
    /// Fundido cruzado entre escenarios (420 ms).
    public static var fundido: Animation { .smooth(duration: 0.42) }
    /// Con «Reducir movimiento»: fundido corto y sin rebote.
    public static var reducido: Animation { .easeInOut(duration: 0.12) }
}

/// Medidas base (rejilla de 4 pt; objetivo táctil de 44 pt).
public enum Medida {
    public static let toque: CGFloat = 44
    /// Márgenes laterales de Palco.
    public static let margen: CGFloat = 20
    public static let radioL: CGFloat = 20
    /// Tarjetas 16:9.
    public static let radioM: CGFloat = 14
    /// Hojas modales.
    public static let radioHoja: CGFloat = 24
    /// Alto del mini-reproductor.
    public static let altoMini: CGFloat = 72
}

/// Apariencia elegida en Ajustes (`@AppStorage`): la del sistema, clara u oscura.
public enum Apariencia: String, CaseIterable, Identifiable, Sendable {
    case sistema, claro, oscuro

    public static let clave = "es.ismaeloul.aceplayerneo.apariencia"

    public var id: String { rawValue }

    public var titulo: String {
        switch self {
        case .sistema: "Sistema"
        case .claro: "Claro"
        case .oscuro: "Oscuro"
        }
    }

    /// `preferredColorScheme` (nil = la del sistema).
    public var esquema: ColorScheme? {
        switch self {
        case .sistema: nil
        case .claro: .light
        case .oscuro: .dark
        }
    }
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

/// Cristal «claro» para lo que va sobre el vídeo (la HIG pide Clear sobre
/// medios): un velo negro debajo, siempre, para que se lea.
private struct CristalSobreVideo<Forma: Shape>: ViewModifier {
    let forma: Forma
    @Environment(\.accessibilityReduceTransparency) private var sinTransparencia

    func body(content: Content) -> some View {
        if sinTransparencia {
            content.background(Color.black.opacity(0.72), in: forma)
        } else {
            #if compiler(>=6.2)
                if #available(iOS 26.0, *) {
                    content
                        .background(Color.black.opacity(0.3), in: forma)
                        .glassEffect(.clear, in: forma)
                } else {
                    content.background(Color.black.opacity(0.3), in: forma).background(.ultraThinMaterial, in: forma)
                }
            #else
                content.background(Color.black.opacity(0.3), in: forma).background(.ultraThinMaterial, in: forma)
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

    /// Cristal claro sobre la imagen del vídeo.
    public func cristalSobreVideo<Forma: Shape>(en forma: Forma) -> some View {
        modifier(CristalSobreVideo(forma: forma))
    }

    public func cristalSobreVideo() -> some View {
        modifier(CristalSobreVideo(forma: Capsule()))
    }
}

extension Font {
    /// Números grandes (marcador, horas): SF Pro comprimida con cifras de ancho fijo.
    public static func numeros(_ estilo: Font.TextStyle = .title3, peso: Font.Weight = .semibold) -> Font {
        .system(estilo, design: .default, weight: peso).width(.compressed).monospacedDigit()
    }

    /// Titulares: SF Pro expandida (el Bricolage Grotesque del prototipo).
    public static func titular(_ estilo: Font.TextStyle = .largeTitle, peso: Font.Weight = .bold) -> Font {
        .system(estilo, design: .default, weight: peso).width(.expanded)
    }

    /// Antetítulos en mayúsculas («EN DIRECTO · LALIGA»).
    public static var antetitulo: Font {
        .system(.caption, design: .default, weight: .bold)
    }
}
