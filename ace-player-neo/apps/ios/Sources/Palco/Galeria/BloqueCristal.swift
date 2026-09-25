import SwiftUI

/// Los tres cristales sobre la retransmisión de mentira (paneles de 72, texto 650 centrado).
struct BloqueCristal: View {
    var body: some View {
        VStack(spacing: S.s3) {
            panel("Regular (sobre contenido)", .regular)
            panel("Denso (sobre listas)", .denso)
            panel("Sobre vídeo (siempre oscuro)", .video)
        }
        .padding(.vertical, S.s6)
        .padding(.horizontal, S.s4)
        .background(FondoRetransmision())
        .clipShape(RoundedRectangle(cornerRadius: R.xl, style: .circular))
    }

    private func panel(_ titulo: String, _ tipo: TipoCristal) -> some View {
        Text(titulo)
            .estilo(EstiloTexto(tamano: 15, peso: 650, altoLinea: 1.45))
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 72 - 2 * S.s3)
            .panelCristal(tipo)
    }
}
