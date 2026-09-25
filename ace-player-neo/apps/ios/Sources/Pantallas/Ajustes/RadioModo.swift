import SwiftUI

/* Elegir el modo de reproducción (a6 §1.8; settings/ModePicker.tsx): tres tarjetas-botón en columna
   (separación 8; tres columnas desde 640 de ancho), de menos a más colchón. Tarjeta: [punto | texto],
   separación 12, relleno 14 16, radio 18, `--bg` con borde `--line-soft`; la elegida, oro lavado con borde 1,5
   `--accent-edge`. Punto de 22 con aro de 2 `--line-strong`; elegido, aro `--accent-ink` y el relleno de 12 que
   crece con el muelle rápido. Texto: rótulo 15/650 y frase 13 en `--text-2` (1,25). */

struct RadioModo: View {
    let elegido: PlaybackMode
    let alElegir: (PlaybackMode) -> Void
    @Environment(\.maquetacion) private var maquetacion

    /// Orden en pantalla (`PLAYBACK_MODE_ORDER`) y frase de cada modo (`MODE_BLURB`).
    static let orden: [PlaybackMode] = [.low, .balanced, .stable]
    static func frase(_ modo: PlaybackMode) -> String {
        switch modo {
        case .low: "Más cerca del directo; asume más riesgo de cortes."
        case .balanced: "Colchón moderado. El recomendado."
        case .stable: "Prioriza la continuidad en canales con pocos pares."
        }
    }

    var body: some View {
        let columnas = maquetacion.ancho >= 640
        Group {
            if columnas {
                HStack(alignment: .top, spacing: 8) { tarjetas }
            } else {
                VStack(spacing: 8) { tarjetas }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Modo de reproducción")
    }

    private var tarjetas: some View {
        ForEach(Self.orden, id: \.self) { (modo: PlaybackMode) in
            TarjetaModo(modo: modo, elegido: modo == elegido) { alElegir(modo) }
        }
    }
}

private struct TarjetaModo: View {
    let modo: PlaybackMode
    let elegido: Bool
    let accion: () -> Void
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.l, style: .circular)
        Button(action: accion) {
            HStack(alignment: .top, spacing: 12) {
                punto.padding(.top, 1)
                VStack(alignment: .leading, spacing: 3) {
                    Text(modo.etiqueta).estilo(EstiloTexto(tamano: 15, peso: 650, altoLinea: 1.45)).foregroundStyle(Palco.text)
                    Text(RadioModo.frase(modo))
                        .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.25))
                        .foregroundStyle(Palco.text2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .multilineTextAlignment(.leading)
            }
            .padding(.vertical, 14)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(elegido ? Palco.accentWash : Palco.bg, in: forma)
            .bordeInterior(elegido ? Palco.accentEdge : Palco.lineSoft, ancho: elegido ? 1.5 : 1, forma: forma)
        }
        .buttonStyle(EstiloPulsar())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(elegido ? [.isButton, .isSelected] : .isButton)
    }

    private var punto: some View {
        ZStack {
            Circle().strokeBorder(elegido ? Palco.accentInk : Palco.lineStrong, lineWidth: 2)
            Circle()
                .fill(Palco.accentInk)
                .padding(5)
                .scaleEffect(elegido ? 1 : 0)
                .animation(Movimiento.rapido(reducido), value: elegido)
        }
        .frame(width: 22, height: 22)
    }
}
