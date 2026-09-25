import SwiftUI

/// `<EngineIndicator>` (a2 §6.5): botón de 44 (relleno 0 10, cápsula) con el rayo de 16 y el texto 12/600/88;
/// color según el estado. ≤ 380 de ancho: solo el rayo (el texto queda para VoiceOver).
struct IndicadorMotor: View {
    let estado: EstadoMotorVista
    let soloIcono: Bool
    let accion: () -> Void

    init(_ estado: EstadoMotorVista, soloIcono: Bool = false, accion: @escaping () -> Void) {
        self.estado = estado
        self.soloIcono = soloIcono
        self.accion = accion
    }

    /// Textos de `summarizeEngine` (api/hooks.ts).
    var texto: String {
        switch estado {
        case .enLinea: "Motor en línea"
        case .arrancando: "Motor arrancando…"
        case .apagado: "Motor apagado"
        case .comprobando: "Motor: comprobando…"
        case .sinRespuesta: "Motor sin respuesta"
        }
    }

    private var tinta: Color {
        switch estado {
        case .enLinea, .comprobando: Palco.text2
        case .arrancando: Palco.weakInk
        case .apagado, .sinRespuesta: Palco.failInk
        }
    }

    var body: some View {
        Button(action: accion) {
            HStack(spacing: 6) {
                IconoPalco(.motor, tamano: 16)
                if !soloIcono { Text(texto).estilo(.motor).lineLimit(1) }
            }
            .padding(.horizontal, 10)
            .frame(minWidth: 44, minHeight: 44)
        }
        .buttonStyle(EstiloPulsar())
        .foregroundStyle(tinta)
        .accessibilityLabel(texto)
        .accessibilityHint("Salud del sistema")
    }
}
