import SwiftUI

/// `<Skeleton>` de la web (a1 §10.24; ui/Skeleton.css): bloque `--text-3` al 16 % con un brillo (`--surface` al
/// 55 % entre dos transparentes) que cruza de −100 % a +100 % en 1,6 s con `--ease-out`. Quieto con movimiento
/// reducido. Decorativo.
struct Esqueleto: View {
    let ancho: CGFloat?
    let alto: CGFloat
    let radio: CGFloat

    init(ancho: CGFloat? = nil, alto: CGFloat, radio: CGFloat = R.xs) {
        self.ancho = ancho
        self.alto = alto
        self.radio = radio
    }

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: radio, style: .circular)
        forma
            .fill(Palco.text3.opacity(0.16))
            .overlay { BrilloEsqueleto().clipShape(forma) }
            .frame(width: ancho, height: alto)
            .frame(maxWidth: ancho == nil ? .infinity : nil, alignment: .leading)
            .accessibilityHidden(true)
    }
}

private struct BrilloEsqueleto: View {
    @Environment(\.movimientoReducido) private var reducido
    @Environment(\.vistaActiva) private var vistaActiva
    @State private var ancho: CGFloat = 0

    var body: some View {
        Group {
            if !reducido {
                TimelineView(.animation(minimumInterval: nil, paused: !vistaActiva)) { contexto in
                    franja.offset(x: BrilloEsqueleto.desplazamiento(contexto.date.timeIntervalSinceReferenceDate) * ancho)
                }
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { ancho = $0 }
    }

    private var franja: some View {
        LinearGradient(colors: [Palco.surface.opacity(0), Palco.surface.opacity(0.55), Palco.surface.opacity(0)],
                       startPoint: .leading, endPoint: .trailing)
    }

    /// −1 → +1 del ancho en 1,6 s con la curva de salida.
    static func desplazamiento(_ t: Double) -> CGFloat {
        let fase = t.truncatingRemainder(dividingBy: Movimiento.giro) / Movimiento.giro
        return CGFloat(-1 + 2 * Movimiento.curvaSalida(fase))
    }
}
