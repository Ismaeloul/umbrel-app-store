import SwiftUI

/// Un trozo de un número: una cifra suelta (va en su celda) o lo demás en bloque (`splitDigits`, ui/Num.tsx).
struct SegmentoNum: Hashable, Sendable {
    var cifra: Bool
    var texto: String
}

/// `<Num>` de la web (a1 §3.5, §10.10; ui/Num.tsx). Cada cifra en una celda fija centrada (0,49 em condensada,
/// 0,645 em en texto normal, 0,72 em el código de emparejar); los separadores a su ancho natural. Nunca
/// `.monospacedDigit()` (activa `tnum`: el cero con barra). Accesible: el número entero, una sola vez.
struct Num: View {
    enum Animacion: Sendable { case ninguna, paleta, rueda }  // paleta al destapar; rueda (.numericText) al cambiar

    let texto: String
    let estilo: EstiloTexto
    let celdaEm: Double
    let etiqueta: String?
    let animacion: Animacion

    /// Cada cifra en una celda fija (0,49 em condensada, 0,645 em normal, 0,72 em código de emparejar); nunca .monospacedDigit().
    init(_ texto: String, tamano: CGFloat, condensado: Bool = true, celda: Double? = nil, etiqueta: String? = nil,
         animacion: Animacion = .ninguna) {
        let estilo = condensado ? EstiloTexto.cifras(Double(tamano)) : EstiloTexto(tamano: Double(tamano), peso: 450)
        self.init(texto, estilo: estilo, celda: celda ?? (condensado ? Num.celdaCondensada : Num.celdaTexto),
                  etiqueta: etiqueta, animacion: animacion)
    }

    /// Cifras dentro de un texto con otro estilo (`condensed={false}`: heredan tamaño, peso y anchura).
    init(_ texto: String, estilo: EstiloTexto, celda: Double = Num.celdaTexto, etiqueta: String? = nil,
         animacion: Animacion = .ninguna) {
        self.texto = texto
        self.estilo = estilo
        self.celdaEm = celda
        self.etiqueta = etiqueta
        self.animacion = animacion
    }

    /// `--num-cell` (tokens.css:73): el «4» a wdth 75 / 780.
    static let celdaCondensada = 0.49
    /// `--num-cell-text` (tokens.css:76): el «4» a wdth 100.
    static let celdaTexto = 0.645
    /// Celdas del código de emparejar (a2 §22.4).
    static let celdaCodigo = 0.72

    /// `splitDigits`: cada cifra suelta y lo demás en bloque («90+4'» → 9 · 0 · + · 4 · ').
    static func segmentos(_ texto: String) -> [SegmentoNum] {
        var partes: [SegmentoNum] = []
        for caracter in texto {
            let cifra = caracter >= "0" && caracter <= "9"
            if !cifra, let ultima = partes.last, !ultima.cifra {
                partes[partes.count - 1].texto.append(caracter)
            } else {
                partes.append(SegmentoNum(cifra: cifra, texto: String(caracter)))
            }
        }
        return partes
    }

    /// Ancho de una celda en pt.
    static func anchoCelda(tamano: Double, celda: Double) -> Double { tamano * celda }

    private var trozos: [(indice: Int, segmento: SegmentoNum)] {
        Array(Num.segmentos(texto).enumerated()).map { (indice: $0.offset, segmento: $0.element) }
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            ForEach(trozos, id: \.indice) { trozo in
                CeldaNum(segmento: trozo.segmento, estilo: estilo, ancho: anchoCelda, animacion: animacion)
            }
        }
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(etiqueta ?? texto)
    }

    private var anchoCelda: CGFloat { CGFloat(Num.anchoCelda(tamano: estilo.tamano, celda: celdaEm)) }
}

/// Una cifra en su celda (o un separador a su ancho), con la animación pedida.
private struct CeldaNum: View {
    let segmento: SegmentoNum
    let estilo: EstiloTexto
    let ancho: CGFloat
    let animacion: Num.Animacion
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        if segmento.cifra {
            cifra
        } else {
            Text(segmento.texto).estilo(estilo).fixedSize()
        }
    }

    @ViewBuilder private var cifra: some View {
        switch animacion {
        case .ninguna:
            texto
        case .rueda:
            texto
                .contentTransition(.numericText(value: Double(segmento.texto) ?? 0))
                .animation(Movimiento.estandar(reducido), value: segmento.texto)
        case .paleta:
            texto.modifier(GiroPaleta(reducido: reducido)).id(segmento.texto)
        }
    }

    private var texto: some View {
        Text(segmento.texto).estilo(estilo).fixedSize().frame(width: ancho)
    }
}

/// «Paleta» (a3 §8.3, a4 §7): la cifra entra girando desde `perspective(240px) rotateX(−90°)` y opacidad 0,
/// con el muelle héroe; con movimiento reducido, fundido de 150 ms. Gira al aparecer (destapar) y cuando la
/// cifra cambia (la celda es otra: `.id`).
private struct GiroPaleta: ViewModifier {
    let reducido: Bool
    @State private var giro: Double = -90
    @State private var visible = false

    func body(content: Content) -> some View {
        content
            .rotation3DEffect(.degrees(reducido ? 0 : giro), axis: (x: 1, y: 0, z: 0), anchor: .center, perspective: 0.6)
            .opacity(visible ? 1 : 0)
            .onAppear {
                withAnimation(reducido ? .easeOut(duration: 0.15) : Movimiento.heroe) {
                    giro = 0
                    visible = true
                }
            }
    }
}
