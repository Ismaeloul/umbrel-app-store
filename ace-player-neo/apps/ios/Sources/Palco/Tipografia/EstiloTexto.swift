import SwiftUI

/// Un estilo de texto de la web como datos (b-arquitectura §2.2.3; a1 §3.4).
struct EstiloTexto: Hashable, Sendable {
    var tamano: Double
    var peso: Double
    var anchura: Double = 100
    var trackingEm: Double = 0
    var altoLinea: Double? = nil  // múltiplo del tamaño (1,45 = 145 %); nil = el natural de Palco Sans (1 em)
    var mayusculas = false
    var mono = false

    // a1 §3.4, tal cual. Los que en la web no fijan `line-height` heredan el del cuerpo (1,45, base.css `body`):
    // se calibró en el laboratorio (fase 0.4) porque la etiqueta del campo y el rótulo de la barra movían 2-6 pt.
    static let cuerpo = EstiloTexto(tamano: 15, peso: 450, altoLinea: 1.45)
    static let titularVista = EstiloTexto(tamano: 30, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.1)
    static let titularVistaAncha = EstiloTexto(tamano: 44, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.1)
    static let subtituloVista = EstiloTexto(tamano: 13, peso: 560, altoLinea: 1.45)
    static let tituloHoja = EstiloTexto(tamano: 22, peso: 800, anchura: 125, trackingEm: -0.01, altoLinea: 1.25)
    static let tituloVacio = EstiloTexto(tamano: 22, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.25)
    static let tituloSeccion = EstiloTexto(tamano: 17, peso: 720, anchura: 125, altoLinea: 1.45)
    static let kicker = EstiloTexto(tamano: 13, peso: 700, trackingEm: 0.14, altoLinea: 1.45, mayusculas: true)
    static let boton = EstiloTexto(tamano: 15, peso: 650, altoLinea: 1.1)
    static let botonSm = EstiloTexto(tamano: 13, peso: 650, altoLinea: 1.1)
    static let chip = EstiloTexto(tamano: 12, peso: 650, anchura: 88, altoLinea: 1.45)
    static let capsula = EstiloTexto(tamano: 13, peso: 640, anchura: 88, altoLinea: 1)
    static let capsulaSm = EstiloTexto(tamano: 11, peso: 640, anchura: 88, trackingEm: 0.02, altoLinea: 1)
    static let senal = EstiloTexto(tamano: 12, peso: 620, anchura: 88, altoLinea: 1.15)
    static let senalLg = EstiloTexto(tamano: 13, peso: 620, anchura: 88, altoLinea: 1.15)
    static let anillo = EstiloTexto(tamano: 12, peso: 640, anchura: 88, altoLinea: 1.15)
    static let segmento = EstiloTexto(tamano: 13, peso: 620, altoLinea: 1.45)
    static let menu = EstiloTexto(tamano: 15, peso: 560, altoLinea: 1.45)
    static let toast = EstiloTexto(tamano: 15, peso: 560, altoLinea: 1.25)
    static let lineaEstado = EstiloTexto(tamano: 15, peso: 560, altoLinea: 1.45)
    static let etiquetaCampo = EstiloTexto(tamano: 13, peso: 650, altoLinea: 1.45)
    static let campo = EstiloTexto(tamano: 16, peso: 450)
    static let pista = EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45)
    static let errorCampo = EstiloTexto(tamano: 13, peso: 560, altoLinea: 1.45)
    static let pestanaBarra = EstiloTexto(tamano: 11, peso: 620, anchura: 88, altoLinea: 1.45)
    static let destinoBarraSuperior = EstiloTexto(tamano: 13, peso: 620, anchura: 88, altoLinea: 1.45)
    static let modoDemo = EstiloTexto(tamano: 11, peso: 650, anchura: 88, altoLinea: 1.45)
    static let motor = EstiloTexto(tamano: 12, peso: 600, anchura: 88, altoLinea: 1.45)
    static let mono = EstiloTexto(tamano: 12, peso: 400, anchura: 87.5, mono: true)
    static func cifras(_ tamano: Double) -> EstiloTexto { EstiloTexto(tamano: tamano, peso: 780, anchura: 75) }

    /// `letter-spacing` en pt (em × tamaño; a1 §3.4).
    var trackingPt: Double { trackingEm * tamano }
    /// `line-height` en pt, o el natural de Palco Sans (1 em).
    var altoLineaPt: Double { (altoLinea ?? 1) * tamano }

    /// El mismo estilo con otro tamaño, peso o anchura (variantes de una primitiva).
    func con(tamano: Double? = nil, peso: Double? = nil, anchura: Double? = nil) -> EstiloTexto {
        var copia = self
        if let tamano { copia.tamano = tamano }
        if let peso { copia.peso = peso }
        if let anchura { copia.anchura = anchura }
        return copia
    }
}

extension View {
    /// Fuente + tracking + mayúsculas + alto de línea de la web. La única forma de dar estilo a un Text.
    func estilo(_ e: EstiloTexto) -> some View { modifier(ModificadorEstilo(estilo: e)) }

    /// line-height CSS: lineSpacing((lh − 1)·t) + padding vertical (lh − 1)·t / 2 (primera y última línea).
    /// Con Palco Sans cada línea mide 1 em y el glifo queda donde lo pone el navegador (media interlínea).
    func altoDeLinea(_ lh: Double, tamano: Double) -> some View {
        lineSpacing((lh - 1) * tamano).padding(.vertical, (lh - 1) * tamano / 2)
    }
}

extension View {
    /// line-height CSS para Martian Mono, cuya caja natural es de 1,2 em (no 1 em como Palco Sans): el sobrante
    /// `lh·t − caja` se reparte como en el navegador (mitad arriba, mitad abajo, y entre renglones).
    func altoDeLineaMartian(_ lh: Double, tamano: Double) -> some View {
        let sobrante = lh * tamano - Martian.altoNatural(tamano)
        return lineSpacing(max(0, sobrante)).padding(.vertical, sobrante / 2)
    }
}

private struct ModificadorEstilo: ViewModifier {
    let estilo: EstiloTexto

    func body(content: Content) -> some View {
        content
            .font(Mona.fuente(estilo))
            .tracking(estilo.trackingPt)
            .textCase(estilo.mayusculas ? .uppercase : nil)
            .modifier(AltoLineaEstilo(estilo: estilo))
    }
}

/// Palco Sans: caja de 1 em; Martian: su caja real (solo si el estilo pide un alto de línea).
private struct AltoLineaEstilo: ViewModifier {
    let estilo: EstiloTexto

    func body(content: Content) -> some View {
        if estilo.mono, let lh = estilo.altoLinea {
            content.altoDeLineaMartian(lh, tamano: estilo.tamano)
        } else {
            content.altoDeLinea(estilo.altoLinea ?? 1, tamano: estilo.tamano)
        }
    }
}
