import SwiftUI

/* Cabecera del canal suelto (ChannelCenter.tsx; a4 §16): la tesela 128×72 con su sigla y su tono, «CANAL», el
   nombre (22/800/125) y de dónde viene («En tus favoritos · 3 fuentes del mismo canal») y «Reproducir» (oro)
   solo cuando hace falta: ni con el canal en pantalla ni mientras va a arrancar solo. */

struct CabeceraCanal: View {
    let hash: String
    let titulo: String
    let origen: String
    let hermanas: Int
    let ih: Bool
    let video = EntornoVideo()

    /// «Reproducir» se ve si el canal no suena/conecta y no va a arrancar solo (reposo desde el inicio).
    private var mostrarReproducir: Bool {
        let r = video.reproductor
        let reposo = r.fase == .idle || r.fase == .error
        if r.canal?.id == hash && !reposo { return false }
        let arrancaSolo = r.fase == .idle && r.canal?.id != hash && r.motivoParada == nil
        return !arrancaSolo
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 16) {
                MarcaCanal(nombre: titulo, forma: .tesela, tamano: 72)
                    .sombra(.s3, forma: RoundedRectangle(cornerRadius: 11.5, style: .circular))
                textos
            }
            if mostrarReproducir {
                BotonPalco("Reproducir", icono: .play) {
                    video.reproductor.reproducir(CanalReproducible(id: hash, titulo: titulo, ih: ih))
                }
                .accessibilityIdentifier(IDUI.botonReproducirCanal)
            }
        }
        .padding(.top, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.cabeceraCanal)
    }

    private var textos: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Canal")
                .estilo(EstiloTexto(tamano: 13, peso: 650, trackingEm: 0.14, altoLinea: 1.45, mayusculas: true))
                .foregroundStyle(Palco.text2)
            Text(titulo)
                .estilo(EstiloTexto(tamano: 22, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.1))
                .foregroundStyle(Palco.text)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(hermanas > 0 ? "\(origen) · \(hermanas) fuentes del mismo canal" : origen)
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                .foregroundStyle(Palco.text2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
