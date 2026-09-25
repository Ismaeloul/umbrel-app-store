import SwiftUI

/// La línea de estado (a1 §10.21; ui/StatusLine.css) y su cápsula sobre el vídeo (a2 §8.4; shell.css
/// `.stage__status`). Solo la vista: qué se enseña y cuánto dura es de `LineaEstado` (Core/Reglas).
struct LineaEstadoVista: View {
    enum Variante: Sendable { case tarjeta, sobreVideo }

    let contenido: ContenidoLinea
    let repeticiones: Int
    let variante: Variante

    init(_ contenido: ContenidoLinea, repeticiones: Int = 1, variante: Variante = .tarjeta) {
        self.contenido = contenido
        self.repeticiones = repeticiones
        self.variante = variante
    }

    var body: some View {
        switch variante {
        case .tarjeta: tarjeta
        case .sobreVideo: sobreVideo
        }
    }

    /// Tarjeta: fila de 44 como mínimo, relleno 8 14, radio 14, `--surface`, borde `--line-soft` y franja
    /// izquierda de 3 del tono; texto 15/560 en una línea; dato 13/650 en `--text-2`.
    private var tarjeta: some View {
        let forma = RoundedRectangle(cornerRadius: R.m, style: .circular)
        return HStack(spacing: 10) {
            izquierda(tamanoIcono: 18, tintaIcono: Palco.text2)
            texto(EstiloTexto(tamano: 15, peso: 560), veces: 15)
            if let dato = contenido.dato {
                Text(dato).estilo(EstiloTexto(tamano: 13, peso: 650)).foregroundStyle(Palco.text2).fixedSize()
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 14)
        .frame(minHeight: 44)
        .background(Palco.surface, in: forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
        .franjaIzquierda(TonoAvisoPalco.franja(contenido.tono), ancho: 3, forma: forma)
        .accessibilityElement(children: .combine)
    }

    /// Sobre el vídeo: cápsula de cristal de vídeo (alto 34, relleno 5 14 5 10, separación 8), texto 13/650,
    /// dato 12 en `--on-video-2`; el icono se tiñe con el tono. Isla oscura.
    private var sobreVideo: some View {
        HStack(spacing: 8) {
            izquierda(tamanoIcono: 18, tintaIcono: tintaSobreVideo)
            texto(EstiloTexto(tamano: 13, peso: 650), veces: 13)
            if let dato = contenido.dato {
                Text(dato).estilo(EstiloTexto(tamano: 12, peso: 450)).foregroundStyle(Palco.onVideo2).fixedSize()
            }
        }
        .padding(.leading, 10)
        .padding(.trailing, 14)
        .padding(.vertical, 5)
        .frame(minHeight: 34)
        .frame(maxWidth: 560, alignment: .leading)
        .fixedSize(horizontal: true, vertical: false)
        .foregroundStyle(Palco.onVideo)
        .cristal(.video, en: Capsule())
        .bordeInterior(Color.white.opacity(0.16), forma: Capsule())
        .sombra([CapaSombra(y: 8, desenfoque: 20, expansion: -10, color: Color.black.opacity(0.7))], forma: Capsule())
        .islaOscura()
        .accessibilityElement(children: .combine)
    }

    private var tintaSobreVideo: Color {
        switch contenido.tono {
        case .ok: Palco.ok
        case .warn: Palco.weak
        case .err: Palco.fail
        case .info: Palco.onVideo
        }
    }

    @ViewBuilder private func izquierda(tamanoIcono: CGFloat, tintaIcono: Color) -> some View {
        if let senal = contenido.senal {
            MedidorSenal(senal, tamano: .sm, ocultarPalabra: true)
        } else {
            IconoPalco(contenido.icono ?? .info, tamano: tamanoIcono).foregroundStyle(tintaIcono)
        }
    }

    private func texto(_ estilo: EstiloTexto, veces tamano: Double) -> some View {
        let veces: Text = Text(verbatim: " ×\(repeticiones)")
            .foregroundStyle(Palco.text2)
            .font(Mona.fuente(tamano, peso: 780, anchura: 75))
        let extra: Text = repeticiones > 1 ? veces : Text(verbatim: "")
        let principal: Text = Text(verbatim: contenido.texto)
        return Text("\(principal)\(extra)")
            .estilo(estilo)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
