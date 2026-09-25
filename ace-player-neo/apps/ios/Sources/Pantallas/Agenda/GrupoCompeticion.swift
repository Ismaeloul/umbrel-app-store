import SwiftUI

/* Un bloque por competición (M5; a3 §6.2, §6.3): cabecera (logo solo si el servidor lo da, nombre 17/800/125,
   recuento) y el carril horizontal a sangre de tarjetas de 240 (300 desde 768) con imán al inicio. */

struct GrupoCompeticion<Celda: View>: View {
    let grupo: GrupoLiga
    let logo: URL?
    let celda: (FootballMatch) -> Celda
    @Environment(\.maquetacion) private var maquetacion

    init(grupo: GrupoLiga, logo: URL?, @ViewBuilder celda: @escaping (FootballMatch) -> Celda) {
        self.grupo = grupo
        self.logo = logo
        self.celda = celda
    }

    private var anchoTarjeta: CGFloat { maquetacion.tipo == .movil ? 240 : 300 }  // --agenda-card-w

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            cabecera
            CarrilCarteles(
                grupo.partidos, anchoCelda: anchoTarjeta, sangrado: CGFloat(maquetacion.rellenoIzquierdo),
                etiqueta: "Partidos de \(grupo.competicion)", celda: celda
            )
            .padding(.leading, -CGFloat(maquetacion.rellenoIzquierdo))
            .padding(.trailing, -CGFloat(maquetacion.rellenoDerecho))
        }
    }

    private var cabecera: some View {
        HStack(spacing: 10) {
            if let logo { PastillaCompeticion(nombre: grupo.competicion, logo: logo, tamano: 22) }
            Text(grupo.competicion)
                .estilo(EstiloTexto(tamano: maquetacion.tipo == .movil ? 17 : 22, peso: 800, anchura: 125, trackingEm: -0.01, altoLinea: 1.25))
                .foregroundStyle(Palco.text)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            Num("\(grupo.partidos.count)", estilo: EstiloTexto(tamano: 13, peso: 600), etiqueta: FormatoAgenda.partidos(grupo.partidos.count))
                .foregroundStyle(Palco.text3)
        }
        .padding(.horizontal, 2)
        .accessibilityElement(children: .combine)
    }
}
