import SwiftUI

/// Vista previa del menú del vídeo (b-arquitectura §0.1, riesgo 12): la tesela del canal, su nombre y la fase
/// («Sonando», «En pausa»…). Nunca un `VistaVideo`: robaría la capa de vídeo al escenario.
struct VistaPreviaVideo: View {
    let titulo: String
    let fase: FaseReproductor

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            MarcaCanal(nombre: titulo, forma: .tesela, tamano: 90)
            Text(titulo)
                .estilo(EstiloTexto(tamano: 15, peso: 650, anchura: 88, altoLinea: 1.1))
                .foregroundStyle(Palco.text)
                .lineLimit(1)
            Capsula(EstadoEscenario.rotuloMini(fase), tamano: .sm)
        }
        .padding(12)
        .frame(width: 184, alignment: .leading)
        .background(Palco.surface)
    }
}
