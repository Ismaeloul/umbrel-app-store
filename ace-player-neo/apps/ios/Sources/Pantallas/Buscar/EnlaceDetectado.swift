import SwiftUI

/* «Enlace detectado» (M5; a5 §4.4): si lo escrito lleva un Content ID, no se pregunta al motor: la tarjeta
   verde con la tesela, el nombre (el tuyo o «Es un Content ID de AceStream»), la explicación, el hash y
   «Reproducir» / «Limpiar». Entra con `ace-aparece` (fundido con movimiento reducido). */

struct EnlaceDetectado: View {
    let hash: String
    let conocido: Item?
    let reproducir: () -> Void
    let limpiar: () -> Void
    @Environment(\.maquetacion) private var maquetacion

    private var nombreTesela: String { conocido?.title ?? ModeloBusqueda.tituloPegado(hash, conocido: nil) }

    private var explicacion: String {
        guard let conocido else {
            return "Se reproduce como fuente externa, sin guardarlo en favoritos ni vincularlo a ningún partido."
        }
        return conocido.category.isEmpty ? "Ya lo tienes: se reproduce ese canal." : "Ya lo tienes en \(conocido.category): se reproduce ese canal."
    }

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.xl, style: .circular)
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                Capsula("Enlace detectado", tono: .ok, icono: .link)
                Text(conocido == nil ? "Fuente externa" : "En tu biblioteca")
                    .estilo(EstiloTexto(tamano: 13, peso: 560, altoLinea: 1.45))
                    .foregroundStyle(Palco.text2)
            }
            HStack(alignment: .top, spacing: 16) {
                MarcaCanal(nombre: nombreTesela, forma: .tesela, tamano: 44)
                    .shadow(color: Color.black.opacity(0.5), radius: 8, y: 6)
                textos
            }
            botones
        }
        .padding(16)
        .background(PalcoMezcla.ok10SobreSurface, in: forma)
        .bordeInterior(Palco.ok.opacity(0.35), forma: forma)
        .sombra(.s1, forma: forma)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.enlaceDetectado)
    }

    private var textos: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(conocido?.title ?? "Es un Content ID de AceStream")
                .estilo(EstiloTexto(tamano: 22, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.1))
                .foregroundStyle(Palco.text)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(explicacion)
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                .foregroundStyle(Palco.text2)
                .fixedSize(horizontal: false, vertical: true)
            Text(hash).estilo(.mono).foregroundStyle(Palco.text2).padding(.top, 4)
        }
    }

    /// `< 480`: cada botón crece (dos mitades); desde 480, a su ancho.
    @ViewBuilder private var botones: some View {
        let estirar = maquetacion.ancho < 480
        HStack(spacing: 8) {
            BotonPalco("Reproducir", icono: .play, bloque: estirar, accion: reproducir)
            BotonPalco("Limpiar", icono: .x, variante: .quieto, bloque: estirar, accion: limpiar)
        }
    }
}
