import SwiftUI

/// La cápsula «canal que suena» del inmersivo fuera de «compacto» (`.player-now`, a4 §18): cristal de vídeo, alto
/// 44, relleno 0 16 0 14, separación 10: ecualizador + canal (13/650) + subtítulo (12/520 al 85 %, cede antes).
struct CapsulaCanalSonando: View {
    let titulo: String
    let subtitulo: String?
    let sonando: Bool

    var body: some View {
        HStack(spacing: 10) {
            Ecualizador(sonando: sonando)
            Text(titulo).estilo(EstiloTexto(tamano: 13, peso: 650, altoLinea: 1)).lineLimit(1).layoutPriority(1)
            if let subtitulo {
                Text(subtitulo).estilo(EstiloTexto(tamano: 12, peso: 520, altoLinea: 1)).opacity(0.85).lineLimit(1)
            }
        }
        .foregroundStyle(Palco.onVideo)
        .padding(.leading, 14)
        .padding(.trailing, 16)
        .frame(minHeight: 44)
        .frame(maxWidth: 520, alignment: .leading)
        .fixedSize(horizontal: true, vertical: false)
        .cristal(.video, en: Capsule())
        .accessibilityElement(children: .combine)
    }
}

/// Barras de «sonando» (`.player-eq`): tres barras de 2×10 en una caja de 9×10 que laten `scaleY .35 ↔ 1` en
/// 1,1 s escalonadas 0,2 s; quietas si no suena o con movimiento reducido.
struct Ecualizador: View {
    let sonando: Bool
    var color: Color = Palco.onVideo
    @Environment(\.movimientoReducido) private var reducido
    @Environment(\.vistaActiva) private var vistaActiva

    var body: some View {
        TimelineView(.animation(minimumInterval: nil, paused: !sonando || reducido || !vistaActiva)) { contexto in
            let t: Double = contexto.date.timeIntervalSinceReferenceDate
            HStack(alignment: .bottom, spacing: 1.5) {
                ForEach(0..<3, id: \.self) { i in
                    Rectangle()
                        .fill(color)
                        .frame(width: 2, height: 10)
                        .scaleEffect(x: 1, y: escala(t, indice: i), anchor: .bottom)
                }
            }
        }
        .frame(width: 9, height: 10)
        .accessibilityHidden(true)
    }

    private func escala(_ t: Double, indice: Int) -> CGFloat {
        guard sonando && !reducido else { return 0.35 }
        let fase: Double = ((t - Double(indice) * 0.2) / 1.1).truncatingRemainder(dividingBy: 1)
        let angulo: Double = 2 * Double.pi * fase
        let onda: Double = 0.5 - 0.5 * cos(angulo)
        return CGFloat(0.35 + 0.65 * onda)
    }
}
