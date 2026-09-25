import SwiftUI

/* Las secciones de «Buscar» (M5; a5 §4.1-§4.3): el título de sección (17/800/125 con el contador en wdth 75),
   la caja de pista, «Buscando…» con su latido, y las filas de canal (de tu biblioteca o del motor). */

/// `h2.search-sec__title` con el contador (solo con resultados; 13/560/wdth 75, no es `Num`).
struct TituloSeccionBuscar: View {
    let titulo: String
    let contador: Int?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(titulo).estilo(EstiloTexto(tamano: 17, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1.45))
                .foregroundStyle(Palco.text)
            if let contador {
                Text("\(contador)").estilo(EstiloTexto(tamano: 13, peso: 560, anchura: 75)).foregroundStyle(Palco.text3)
            }
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// `.search-hint`: caja `--surface` de radio 24 con las tres frases, centradas.
struct PistaBuscar: View {
    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.xl, style: .circular)
        VStack(spacing: 4) {
            Text("Busca canales publicados en el motor AceStream.")
                .estilo(EstiloTexto(tamano: 15, peso: 650, altoLinea: 1.45)).foregroundStyle(Palco.text)
            Text("Escribe al menos 2 letras.")
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45)).foregroundStyle(Palco.text2)
            Text("Si pegas un Content ID o un enlace acestream://, se reproduce directamente.")
                .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45)).foregroundStyle(Palco.text2)
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, 24)
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity)
        .background(Palco.surface, in: forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
    }
}

/// «Buscando «q» en el motor…» con el latido de opacidad (1 ↔ 0,45 cada 1,4 s) y 4 filas de esqueleto.
struct BuscandoEnElMotor: View {
    let consulta: String
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TimelineView(.animation(paused: reducido)) { contexto in
                Text("Buscando «\(consulta)» en el motor…")
                    .estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45))
                    .foregroundStyle(Palco.text2)
                    .opacity(reducido ? 1 : latido(contexto.date.timeIntervalSinceReferenceDate))
                    .padding(.horizontal, 4)
            }
            FilasEsqueleto(4, anuncio: "Buscando «\(consulta)» en el motor…")
        }
    }

    /// Ida y vuelta de 1,4 s entre 1 y 0,45 (`ease-out`).
    private func latido(_ t: Double) -> Double {
        let fase = t.truncatingRemainder(dividingBy: 2.8) / 1.4
        let x = fase <= 1 ? fase : 2 - fase
        let curva = Movimiento.curvaSalida(x)
        return 1 - 0.55 * curva
    }
}
