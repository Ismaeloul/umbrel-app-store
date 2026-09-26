import SwiftUI

/* La tarjeta versus de la agenda (M5; a3 §4.2, §6.4.1, §7, §12): la `TarjetaVersus` de Palco con lo que la web
   cambia en agenda.css (`DisposicionVersus`): la de las filas (240 × 150, 16:10, escudos al 45 %), el héroe XL a
   sangre (alto de la ventana, escudos de 84 al 52 % y a escala 1, fila de arriba a safeTop + 76, esquinas de abajo
   de 24, velo bajo la cabecera) y la valla ancha desde 768 (radio 24, escudos al 44 %, nombres de 30, su velo). */

/// `fila` (240 × 150), `heroe` (vertical, a sangre) y `valla` (el héroe desde 768: dentro del margen, radio 24
/// en las cuatro esquinas, escudos al 44 %, nombres de 30 y el velo de la valla ancha; a3 §12).
enum TamanoVersusAgenda: Sendable { case fila, heroe, valla }

/// Lo que pinta la tarjeta, ya resuelto desde el partido.
struct DatosTarjetaAgenda: Equatable {
    var versus: DatosVersus
    var cuando: CuandoVersus
    var partido: String

    @MainActor
    static func de(
        _ partido: FootballMatch, reloj: RelojMadrid, marcador: LiveScore?, mio: Bool, enPantalla: Bool
    ) -> DatosTarjetaAgenda {
        let estado = ReglasAgenda.estado(partido, reloj: reloj, marcador: marcador)
        let mitades = TarjetasAgenda.mitades(partido)
        let versus = DatosVersus(
            local: equipo(TarjetasAgenda.lado(partido, local: true)),
            visitante: equipo(TarjetasAgenda.lado(partido, local: false)),
            mitadLocal: mitades.local, mitadVisitante: mitades.visitante,
            competicion: TarjetasAgenda.competicion(partido),
            logoCompeticion: RecursosServidor.imagen(TarjetasAgenda.logoCompeticion(partido)),
            cuando: TarjetasAgenda.cuando(partido, reloj: reloj, marcador: marcador).rotulo,
            enDirecto: estado?.fase == .directo, terminado: estado?.fase == .terminado, tuEquipo: mio,
            enPantalla: enPantalla)
        return DatosTarjetaAgenda(
            versus: versus, cuando: TarjetasAgenda.cuando(partido, reloj: reloj, marcador: marcador), partido: partido.id)
    }

    @MainActor
    private static func equipo(_ lado: LadoVersus) -> DatosEquipo {
        DatosEquipo(
            nombre: lado.nombre, siglas: lado.siglas, primario: lado.primario, secundario: lado.secundario,
            escudo: RecursosServidor.imagen(lado.escudo), halo: lado.luz)
    }
}

struct VersusAgenda<Senal: View>: View {
    let datos: DatosTarjetaAgenda
    let tamano: TamanoVersusAgenda
    /// Alto del héroe (a3 §4.7); en las filas lo marca la proporción.
    let alto: CGFloat
    /// Fila de arriba del héroe: safeTop + 76 (a3 §4.2).
    let arriba: CGFloat
    /// Sitio libre a la derecha de los nombres (60 con la cápsula «Marcador», a3 §6.4.1).
    let reservaNombres: CGFloat
    /// Solo la tarjeta desde la que se abre lleva la transición (única en la página, a3 §4.8).
    let origenVuelo: Bool
    let senal: Senal

    init(
        _ datos: DatosTarjetaAgenda, tamano: TamanoVersusAgenda, alto: CGFloat = 0, arriba: CGFloat = 12,
        reservaNombres: CGFloat = 0, origenVuelo: Bool = false, @ViewBuilder senal: () -> Senal
    ) {
        self.datos = datos
        self.tamano = tamano
        self.alto = alto
        self.arriba = arriba
        self.reservaNombres = reservaNombres
        self.origenVuelo = origenVuelo
        self.senal = senal()
    }

    var body: some View {
        TarjetaVersus(datos.versus, tamano: tamano == .fila ? .md : .xl, disposicion: disposicion) { senal }
            .overlay { if tamano == .heroe { VeloCabecera(arriba: arriba) } }
    }

    private var disposicion: DisposicionVersus {
        var d = DisposicionVersus()
        d.reservaNombres = reservaNombres
        d.origenVuelo = origenVuelo ? datos.partido : nil
        switch tamano {
        case .fila:
            d.proporcion = 16 / 10  // `.agenda-row .versus`
            d.centroEscudos = 0.45
        case .heroe:
            d.proporcion = nil
            d.alto = alto
            d.centroEscudos = 0.52
            d.escalaEscudos = 1
            d.radioArriba = 0
            d.rellenoArriba = arriba
            d.sombraGrande = true
        case .valla:
            d.proporcion = nil
            d.alto = alto
            d.veloValla = true
            d.sombraGrande = true
        }
        return d
    }
}

/// Velo extra bajo la cabecera «Agenda»: alto safeTop + 96, `linear(180°, .55 → transparente)` (a3 §4.2).
private struct VeloCabecera: View {
    let arriba: CGFloat

    var body: some View {
        LinearGradient(colors: [Color.black.opacity(0.55), Color.black.opacity(0)], startPoint: .top, endPoint: .bottom)
            .frame(height: arriba + 20)  // safeTop + 96 = (safeTop + 76) + 20
            .frame(maxHeight: .infinity, alignment: .top)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

