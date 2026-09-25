import SwiftUI

/* Bloque «sin cámara» dentro del cartel (a2 §22.3.2): la geometría del estado vacío (columna centrada,
   separación 12, relleno 32 20) en colores oscuros, con la marca de la tarjeta de primer uso (círculo 56 oro
   al 16 % con filo al 40 % y el `qr` 28 en oro), título 22/800/125, texto 13 en `--text-2` y los botones:
   primario «Abrir Ajustes» (solo sin permiso) y quieto «Escribir el código». */

struct BloqueSinCamara: View {
    let titulo: String
    let texto: String
    let abrirAjustes: Bool
    let alAbrirAjustes: () -> Void
    let alEscribirCodigo: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            marca
            Text(titulo)
                .estilo(EstiloTexto(tamano: 22, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.25))
                .foregroundStyle(Palco.text)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            Text(texto)
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                .foregroundStyle(Palco.text2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 44 * 13 * 0.52)  // 44 caracteres
            botones.padding(.top, 8)
        }
        .padding(.vertical, 32)
        .padding(.horizontal, 20)
        .islaOscura()
    }

    private var marca: some View {
        IconoPalco(.qr, tamano: 28)
            .foregroundStyle(Palco.accent)
            .frame(width: 56, height: 56)
            .background(Palco.accent.opacity(0.16), in: Circle())
            .bordeInterior(Palco.accent.opacity(0.4), forma: Circle())
            .accessibilityHidden(true)
    }

    private var botones: some View {
        Flujo(horizontal: 8, vertical: 8, alineacion: .center) {
            if abrirAjustes {
                BotonPalco("Abrir Ajustes", icono: .externo, variante: .primario, accion: alAbrirAjustes)
                    .accessibilityIdentifier(IDUI.botonAjustesCamara)
            }
            BotonPalco("Escribir el código", icono: .hash, variante: .quieto, accion: alEscribirCodigo)
                .accessibilityIdentifier(IDUI.botonEscribirCodigo)
        }
    }
}
