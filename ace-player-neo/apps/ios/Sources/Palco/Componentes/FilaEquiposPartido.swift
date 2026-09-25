import SwiftUI

/// Cabecera del partido bajo el vídeo (a4 §10; MatchHead.tsx): escudos de 34 juntos (el visitante solapa 10)
/// y «Local – Visitante» a 22/800/125, −0,02 em, lh 1,1, con la raya en `--text-3` a 500. Destino del vuelo.
struct FilaEquiposPartido: View {
    let local: DatosEquipo
    let visitante: DatosEquipo
    let encendido: Bool

    init(local: DatosEquipo, visitante: DatosEquipo) {
        self.init(local: local, visitante: visitante, encendido: false)
    }

    /// Con los escudos encendidos (en directo).
    init(local: DatosEquipo, visitante: DatosEquipo, encendido: Bool) {
        self.local = local
        self.visitante = visitante
        self.encendido = encendido
    }

    private static let estiloNombres = EstiloTexto(tamano: 22, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.1)

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            HStack(spacing: -10) {
                MarcaEquipo(local, tamano: 34, encendido: encendido)
                MarcaEquipo(visitante, tamano: 34, encendido: encendido)
            }
            nombres
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(local.nombre) vs \(visitante.nombre)")
        .accessibilityAddTraits(.isHeader)
    }

    private var nombres: some View {
        let raya: Text = Text(" – ").foregroundStyle(Palco.text3).font(Mona.fuente(22, peso: 500, anchura: 125))
        let primero: Text = Text(verbatim: local.nombre)
        let segundo: Text = Text(verbatim: visitante.nombre)
        return Text("\(primero)\(raya)\(segundo)")
            .estilo(FilaEquiposPartido.estiloNombres)
            .foregroundStyle(Palco.text)
            .fixedSize(horizontal: false, vertical: true)
    }
}
