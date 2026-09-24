import SwiftUI

/// Estado vacío dentro de una lista que sigue desplazándose (el
/// `ContentUnavailableView` ocupa toda la pantalla; este va en su sitio).
struct EstadoVacio<Acciones: View>: View {
    let icono: String
    let titulo: String
    let texto: String
    @ViewBuilder let acciones: () -> Acciones

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icono)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(Tinta.texto3)
                .accessibilityHidden(true)
            Text(titulo)
                .font(.headline)
                .foregroundStyle(Tinta.texto)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            Text(texto)
                .font(.subheadline)
                .foregroundStyle(Tinta.texto2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                acciones()
            }
            .font(.subheadline.weight(.semibold))
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 20)
        .background(Tinta.superficie, in: RoundedRectangle(cornerRadius: Medida.radioL, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("estado-vacio")
    }
}

/// Aviso del motor para la barra de navegación: SOLO cuando algo va mal
/// («Sin motor», «Reiniciando», «Sin conexión»). Con todo en orden no se
/// enseña nada (inventario §4.1.3).
struct IndicadorMotor: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        if let estado = aspecto {
            Label(estado.texto, systemImage: estado.icono)
                .labelStyle(.titleAndIcon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(estado.color)
                .symbolEffect(.pulse, isActive: app.motor?.status == .restarting)
                .accessibilityLabel("Motor: \(estado.texto)")
                .accessibilityIdentifier("indicador-motor")
        }
    }

    private var aspecto: (texto: String, icono: String, color: Color)? {
        if case .sinConexion = app.conexion { return ("Sin conexión", "wifi.slash", Tinta.falloTinta) }
        switch app.motor?.status {
        case .offline:
            return ("Sin motor", "bolt.slash.fill", Tinta.falloTinta)
        case .restarting:
            return ("Reiniciando", "arrow.triangle.2.circlepath", Tinta.flojaTinta)
        default:
            return nil
        }
    }
}
