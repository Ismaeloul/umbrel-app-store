import SwiftUI

/* Fila de arriba de los controles (a4 §5.2 y §18): a la izquierda ⌄ Minimizar (círculo de cristal, «compacto»)
   o la cápsula «canal que suena» (inmersivo fuera de «compacto»), y el hueco de la cápsula del marcador (solo
   en un partido); a la derecha, con canal, ☆ · PiP · ⋯. La cápsula de la derecha nunca cede: el marcador sí. */

struct FilaSuperiorControles: View {
    let variante: VarianteEscenario
    let partido: FootballMatch?
    let marcador: LiveScore?
    let ahora: Date
    let video = EntornoVideo()

    var body: some View {
        let foto = video.foto
        HStack(spacing: 8) {
            HStack(spacing: 8) {
                izquierda(foto)
                if let partido {
                    CapsulaMarcadorVideo(partido: partido, marcador: marcador, ahora: ahora, variante: variante)
                }
            }
            .layoutPriority(0)
            Spacer(minLength: 0)
            if foto.hayCanal { derecha.layoutPriority(1) }
        }
    }

    @ViewBuilder private func izquierda(_ foto: FotoReproductor) -> some View {
        if variante.minimizarVisible {
            BotonIcono(.chevD, etiqueta: "Minimizar el reproductor", variante: .video) { video.minimizar() }
                .cristal(.video, en: Circle())
                .bordeInterior(Color.white.opacity(0.16), forma: Circle())
                .accessibilityIdentifier(IDUI.botonMinimizar)
        } else if let titulo = foto.titulo {
            CapsulaCanalSonando(titulo: titulo, subtitulo: video.subtitulo, sonando: foto.fase == .reproduciendo)
        }
    }

    /// ☆ · PiP · ⋯ (a4 §5.2): favorito sin hoja, PiP si el sistema puede, «Más opciones» con las 14 opciones.
    private var derecha: some View {
        let favorito = video.esFavorito
        return CapsulaVideo {
            BotonIcono(
                .star, etiqueta: favorito ? "Quitar de favoritos" : "Añadir a favoritos", variante: .video,
                pulsado: favorito, iconoPulsado: .starF, relleno: favorito
            ) { video.alternarFavorito() }
            .accessibilityIdentifier(IDUI.botonFavorito)
            if video.pip.soportado {
                BotonIcono(.pip, etiqueta: "Imagen dentro de imagen", variante: .video, pulsado: video.pip.activo) {
                    video.alternarPiP()
                }
                .accessibilityIdentifier(IDUI.botonPip)
            }
            BotonMas(estilo: .video) { video.accionesMenu() }
                .accessibilityIdentifier(IDUI.botonMasOpciones)
        }
    }
}
