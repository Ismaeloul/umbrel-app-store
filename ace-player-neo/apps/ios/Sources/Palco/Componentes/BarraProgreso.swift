import SwiftUI

/// `<ProgressBar>` de la web (a1 §10.11; ui/ProgressBar.css): alto 6 (fina 3), radio 6, fondo `--line-soft`
/// con borde interior `--line-soft`; el relleno crece desde la izquierda (escala X) con la curva estándar
/// estirada a 800 ms; las muescas (0,5 = descanso) cortan la barra con 2 de `--bg`.
struct BarraProgreso: View {
    /// `normal` = el tono por defecto de la web (`accent` → `--accent-edge`); `directo` = `--live`;
    /// `oro` = `--accent` (sobre fondos oscuros).
    enum Tono: Sendable { case normal, directo, oro }

    let valor: Double
    let fina: Bool
    let tono: Tono
    let muescas: [Double]
    let etiqueta: String
    @Environment(\.movimientoReducido) private var reducido

    init(valor: Double, fina: Bool = false, tono: Tono = .normal, muescas: [Double] = [], etiqueta: String) {
        self.valor = valor
        self.fina = fina
        self.tono = tono
        self.muescas = muescas
        self.etiqueta = etiqueta
    }

    private var acotado: Double { min(1, max(0, valor)) }
    private var forma: RoundedRectangle { RoundedRectangle(cornerRadius: 6, style: .circular) }

    private var relleno: Color {
        switch tono {
        case .normal: Palco.accentEdge
        case .directo: Palco.live
        case .oro: Palco.accent
        }
    }

    var body: some View {
        ZStack(alignment: .leading) {
            forma.fill(Palco.lineSoft)
            Rectangle()
                .fill(relleno)
                .scaleEffect(x: acotado, y: 1, anchor: .leading)
                .animation(reducido ? .easeOut(duration: 0.15) : Movimiento.progreso, value: acotado)
            MuescasBarra(posiciones: muescas)
        }
        .frame(height: fina ? 3 : 6)
        .clipShape(forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
        .accessibilityElement()
        .accessibilityLabel(etiqueta)
        .accessibilityValue("\(Int((acotado * 100).rounded())) %")
    }
}

private struct MuescasBarra: View {
    let posiciones: [Double]

    var body: some View {
        Canvas { contexto, tamano in
            for posicion in posiciones {
                let x = tamano.width * CGFloat(posicion) - 1
                contexto.fill(Path(CGRect(x: x, y: 0, width: 2, height: tamano.height)), with: .color(Palco.bg))
            }
        }
        .allowsHitTesting(false)
    }
}
