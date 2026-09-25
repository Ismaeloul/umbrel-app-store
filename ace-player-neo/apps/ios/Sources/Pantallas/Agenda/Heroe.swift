import SwiftUI

/* El héroe de la portada (M5; a3 §4): el partido destacado como tarjeta versus XL a sangre (bajo la barra de
   estado) y, debajo, la barra con el botón oro, la cápsula «Marcador» y dónde se emite. Nunca reproduce: todo
   navega al centro de partido (`openMatch`). Mientras carga, el hueco oscuro del mismo alto (a3 §4.6). */

struct Heroe: View {
    let partido: FootballMatch
    let foto: FotoAgenda
    let canales: [InfoCanal]
    let origenVuelo: Bool
    let abrir: () -> Void
    @Environment(MarcadoresDestapados.self) private var destapados
    @Environment(Reproductor.self) private var reproductor
    @Environment(\.maquetacion) private var maquetacion

    private var marcador: LiveScore? { foto.marcadores[partido.id] }
    private var estado: EstadoPartido? { ReglasAgenda.estado(partido, reloj: foto.reloj, marcador: marcador) }
    private var viendo: Bool {
        Destapado.partidoViendo(canal: reproductor.canal, activo: reproductor.canal != nil) == partido.id
    }

    private var datos: DatosTarjetaAgenda {
        DatosTarjetaAgenda.de(
            partido, reloj: foto.reloj, marcador: marcador, mio: ParaTi.destacado(partido, foto.gustos),
            enPantalla: viendo)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            tarjeta
            BarraHeroe(
                partido: partido,
                accion: AccionHeroe.de(canales: canales, viendo: viendo, enDirecto: estado?.fase == .directo),
                canales: canales, marcador: marcador, destapado: destapados.destapado(partido.id), abrir: abrir)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(ReglasAgenda.titulo(partido))
        .accessibilityIdentifier(IDUI.heroe)
    }

    private var movil: Bool { maquetacion.tipo == .movil }

    /// Móvil: a sangre, alto de la ventana (a3 §4.7). Desde 768: `min(ancho × 9/16, 62 % del alto)`, mínimo 200.
    private var alto: CGFloat {
        guard !movil else { return CGFloat(maquetacion.altoHeroe) }
        let ancho: Double = maquetacion.ancho - maquetacion.rellenoIzquierdo - maquetacion.rellenoDerecho
        return CGFloat(max(200, min(ancho * 9 / 16, 0.62 * maquetacion.alto)))
    }

    private var tarjeta: some View {
        ConSenal(partido: partido, ahora: foto.ahora, terminado: estado?.fase == .terminado) { senal in
            VersusAgenda(
                datos, tamano: movil ? .heroe : .valla, alto: alto,
                arriba: CGFloat(maquetacion.seguras.arriba) + 76, origenVuelo: origenVuelo
            ) {
                if let senal { CapsulaSenal(senal: senal, grande: true) }
            }
        }
        .padding(.leading, movil ? -CGFloat(maquetacion.rellenoIzquierdo) : 0)
        .padding(.trailing, movil ? -CGFloat(maquetacion.rellenoDerecho) : 0)
    }
}

/// El hueco del héroe mientras carga: a sangre, alto de la ventana, radio 0 0 24 24, oscuro (a3 §4.6).
struct HeroeEsqueleto: View {
    @Environment(\.maquetacion) private var maquetacion

    private var movil: Bool { maquetacion.tipo == .movil }

    var body: some View {
        let arriba: CGFloat = movil ? 0 : R.xl
        let forma = UnevenRoundedRectangle(
            topLeadingRadius: arriba, bottomLeadingRadius: R.xl, bottomTrailingRadius: R.xl, topTrailingRadius: arriba,
            style: .circular)
        Esqueleto(alto: alto, radio: 0)
            .background(Palco.glassVideoSolid)
            .clipShape(forma)
            .islaOscura()
            .padding(.leading, movil ? -CGFloat(maquetacion.rellenoIzquierdo) : 0)
            .padding(.trailing, movil ? -CGFloat(maquetacion.rellenoDerecho) : 0)
            .accessibilityHidden(true)
    }

    /// El mismo hueco que el héroe (a3 §4.6, §12).
    private var alto: CGFloat {
        guard !movil else { return CGFloat(maquetacion.altoHeroe) }
        let ancho: Double = maquetacion.ancho - maquetacion.rellenoIzquierdo - maquetacion.rellenoDerecho
        return CGFloat(max(200, min(ancho * 9 / 16, 0.62 * maquetacion.alto)))
    }
}
