import SwiftUI

enum EstadoAnillo: Hashable, Sendable { case senal(EstadoSenal), reportada, activa }

/// `<SignalRing>` de la web: anillo de estado de los carteles (a1 §10.8; ui/SignalRing.css). Dibujo de 32
/// escalado a `tamano` (28 por defecto): círculo r 13 con trazo 3 (activa 4) en unidades del dibujo, puntas
/// redondas, pista de la tinta al 18 %, empieza arriba. Aparece con escala 0,6 → 1 (reducido: fundido).
struct AnilloSenal: View {
    let estado: EstadoAnillo
    let tamano: CGFloat
    let palabra: String?
    @Environment(\.movimientoReducido) private var reducido
    @State private var visible = false

    init(_ estado: EstadoAnillo, tamano: CGFloat = 28, palabra: String? = nil) {
        self.estado = estado
        self.tamano = tamano
        self.palabra = palabra
    }

    var body: some View {
        HStack(spacing: 7) {
            dibujo
                .scaleEffect(visible || reducido ? 1 : 0.6)
                .opacity(visible ? 1 : 0)
                .onAppear {
                    withAnimation(Movimiento.rapido(reducido)) { visible = true }
                }
            if let palabra {
                Text(palabra).estilo(.anillo).foregroundStyle(tinta).lineLimit(1)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(palabra ?? "")
    }

    private var dibujo: some View {
        ZStack {
            Circle().inset(by: 3 * escala).stroke(tinta.opacity(0.18), lineWidth: grosor)
            AroEstado(estado: estado, escala: escala, grosor: grosor, color: color)
            MarcaAnillo(estado: estado, escala: escala, grosor: grosor, color: color)
        }
        .frame(width: tamano, height: tamano)
    }

    /// Unidades del dibujo (32) → pt.
    private var escala: CGFloat { tamano / 32 }
    private var grosor: CGFloat { (estado == .activa ? 4 : 3) * escala }

    private var color: Color {
        switch estado {
        case .senal(let s): ColoresSenal.medidor(s)
        case .reportada: Palco.weak
        case .activa: Palco.accent
        }
    }

    private var tinta: Color {
        switch estado {
        case .senal(let s): ColoresSenal.tinta(s)
        case .reportada: Palco.weakInk
        case .activa: Palco.accentInk
        }
    }
}

/// El anillo de color con su discontinuo (pathLength 100) y el giro de «comprobando» (1,6 s lineal).
private struct AroEstado: View {
    let estado: EstadoAnillo
    let escala: CGFloat
    let grosor: CGFloat
    let color: Color
    @Environment(\.movimientoReducido) private var reducido
    @Environment(\.vistaActiva) private var vistaActiva

    /// Circunferencia de r 13 en pt: los `stroke-dasharray` van sobre 100.
    private var circunferencia: CGFloat { 2 * CGFloat.pi * 13 * escala }

    private var trazos: [CGFloat] {
        switch estado {
        case .senal(.weak): [66, 34]
        case .senal(.checking): [9, 7]
        case .senal(.pending): [2, 6]
        default: []
        }
    }

    private var estiloTrazo: StrokeStyle {
        let factor = circunferencia / 100
        return StrokeStyle(lineWidth: grosor, lineCap: .round, dash: trazos.map { $0 * factor })
    }

    var body: some View {
        if estado == .senal(.checking) && !reducido {
            TimelineView(.animation(minimumInterval: nil, paused: !vistaActiva)) { contexto in
                aro.rotationEffect(.degrees(AroEstado.giro(contexto.date.timeIntervalSinceReferenceDate)))
            }
        } else {
            aro
        }
    }

    private var aro: some View {
        Circle()
            .inset(by: 3 * escala)
            .stroke(color, style: estiloTrazo)
            .rotationEffect(.degrees(-90))
            .opacity(estado == .reportada ? 0.45 : 1)
    }

    static func giro(_ t: Double) -> Double {
        t.truncatingRemainder(dividingBy: Movimiento.giro) / Movimiento.giro * 360
    }
}

/// Aspa de «Sin señal» (`M11.5 11.5 20.5 20.5 M20.5 11.5 11.5 20.5`) y raya de «Reportada» (`M8 24 24 8`).
private struct MarcaAnillo: View {
    let estado: EstadoAnillo
    let escala: CGFloat
    let grosor: CGFloat
    let color: Color

    var body: some View {
        switch estado {
        case .senal(.fail):
            camino([(11.5, 11.5, 20.5, 20.5), (20.5, 11.5, 11.5, 20.5)])
        case .reportada:
            camino([(8, 24, 24, 8)])
        default:
            EmptyView()
        }
    }

    private func camino(_ tramos: [(CGFloat, CGFloat, CGFloat, CGFloat)]) -> some View {
        var p = Path()
        for tramo in tramos {
            p.move(to: CGPoint(x: tramo.0 * escala, y: tramo.1 * escala))
            p.addLine(to: CGPoint(x: tramo.2 * escala, y: tramo.3 * escala))
        }
        return p.stroke(color, style: StrokeStyle(lineWidth: grosor, lineCap: .round))
    }
}
