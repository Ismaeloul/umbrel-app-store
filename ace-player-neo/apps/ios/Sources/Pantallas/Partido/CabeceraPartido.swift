import SwiftUI

/* Cabecera del teatro bajo el vídeo (MatchHead.tsx; a4 §10): el kicker «● AMISTOSO · EN DIRECTO · 61'» (13/650,
   +0,14 em, mayúsculas; `--live-ink` con el punto que late en directo) y los dos escudos de 34 con «Local –
   Visitante» (destino del vuelo de escudos, `.piezaVuelo(.filaEquipos)`). Lo que se lee es «Local vs Visitante». */

struct CabeceraPartido: View {
    let partido: FootballMatch
    let marcador: LiveScore?
    let ahora: Date
    @State private var base: URL?

    private var enDirecto: Bool { DatosTeatro.estado(partido, marcador: marcador, ahora: ahora)?.fase == .directo }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if enDirecto { PuntoDirecto() }
                Text(DatosTeatro.kicker(partido, marcador: marcador, ahora: ahora))
                    .estilo(EstiloTexto(tamano: 13, peso: 650, trackingEm: 0.14, altoLinea: 1.45, mayusculas: true))
                    .foregroundStyle(enDirecto ? Palco.liveInk : Palco.text2)
                    .lineLimit(1)
            }
            .accessibilityElement(children: .combine)
            equipos
                .piezaVuelo(.filaEquipos, partido: partido.id)
        }
        .padding(.top, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(BaseServidor(base: $base))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.cabeceraPartido)
    }

    @ViewBuilder private var equipos: some View {
        let local = EquiposTeatro.equipo(partido, local: true, base: base)
        if partido.away.isEmpty {
            HStack(spacing: 10) {
                MarcaEquipo(local, tamano: 34, encendido: enDirecto)
                Text(partido.home)
                    .estilo(EstiloTexto(tamano: 22, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.1))
                    .foregroundStyle(Palco.text)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(DatosTeatro.tituloLectura(partido))
            .accessibilityAddTraits(.isHeader)
        } else {
            FilaEquiposPartido(
                local: local, visitante: EquiposTeatro.equipo(partido, local: false, base: base), encendido: enDirecto)
        }
    }
}
