import SwiftUI

/* La tarjeta versus de la agenda (M5; a3 §4.2, §6.4.1, §7): dos tamaños que la web fija con su CSS de
   agenda (agenda.css): la de las filas (240 × 150, 16:10, escudos al 45 %) y el héroe XL a sangre (alto de
   la ventana, escudos de 84 al 52 % y a escala 1, fila de arriba a safeTop + 76, esquinas de abajo de 24).
   Las mitades, el velo y las piezas son las de ui/VersusCard.tsx; SIN marcador en las mitades. Isla oscura. */

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
    /// Solo el bloque de escudos desde el que se abre lleva la transición (único en la página, a3 §4.8).
    let origenVuelo: Bool
    let senal: Senal
    @Environment(\.maquetacion) private var maquetacion

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

    private var heroe: Bool { tamano != .fila }
    private var valla: Bool { tamano == .valla }
    private var relleno: CGFloat { heroe ? 16 : 12 }  // --versus-pad
    private var forma: UnevenRoundedRectangle {
        let r: CGFloat = heroe ? R.xl : R.m
        return UnevenRoundedRectangle(
            topLeadingRadius: tamano == .heroe ? 0 : r, bottomLeadingRadius: r, bottomTrailingRadius: r,
            topTrailingRadius: tamano == .heroe ? 0 : r, style: .circular)
    }

    var body: some View {
        ZStack {
            FondoVersusAgenda(datos: datos.versus, valla: valla)
            ColocarEnFraccion(x: 0.5, y: centroEscudos) {  // --versus-crest-y
                BloqueEscudos(datos.versus, tamano: heroe ? 84 : 56)
                    .modifier(PiezaVueloSi(activa: origenVuelo, partido: datos.partido))
            }
            filaArriba
            pie
            if datos.versus.enPantalla { enPantalla }
        }
        .modifier(MarcoVersus(heroe: heroe, alto: alto))
        .clipShape(forma)
        .overlay { if tamano == .heroe { VeloCabecera(arriba: arriba) } }
        .background { if datos.versus.enPantalla { forma.stroke(Palco.accent, lineWidth: 4) } }
        .sombra(heroe ? .s2 : .s3, forma: forma)
        .foregroundStyle(Color.white)
        .islaOscura()
    }

    private var centroEscudos: CGFloat {
        switch tamano {
        case .fila: 0.45
        case .heroe: 0.52
        case .valla: 0.44
        }
    }

    private var filaArriba: some View {
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                ChipCuando(cuando: datos.cuando, enDirecto: datos.versus.enDirecto)
                if datos.versus.tuEquipo { MarcaTuEquipoAgenda(grande: heroe) }
            }
            .fixedSize()
            Spacer(minLength: 0)
            senal
        }
        .padding(.horizontal, relleno)
        .padding(.top, tamano == .heroe ? arriba : relleno)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var pie: some View {
        PieVersusAgenda(datos: datos.versus, heroe: heroe, valla: valla)
            .padding(.trailing, datos.versus.enPantalla && heroe ? 0.34 * anchoTarjeta : reservaNombres)
            .padding(relleno)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
    }

    private var anchoTarjeta: CGFloat {
        let margenes: Double = valla ? maquetacion.rellenoIzquierdo + maquetacion.rellenoDerecho : 0
        return CGFloat(maquetacion.ancho - margenes)
    }

    private var enPantalla: some View {
        Capsula("En pantalla", tono: .oro, tamano: .sm, punto: true)
            .padding(relleno)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
    }
}

/// Héroe: alto fijo (a3 §4.7). Fila: proporción 16:10 (agenda.css `.agenda-row .versus`).
private struct MarcoVersus: ViewModifier {
    let heroe: Bool
    let alto: CGFloat

    func body(content: Content) -> some View {
        if heroe {
            content.frame(height: alto)
        } else {
            content.aspectRatio(16 / 10, contentMode: .fit)
        }
    }
}

/// `.piezaVuelo(.escudos…)` solo en el elemento desde el que se abre el partido.
struct PiezaVueloSi: ViewModifier {
    let activa: Bool
    let partido: String

    func body(content: Content) -> some View {
        if activa {
            content.piezaVuelo(.escudos, partido: partido)
        } else {
            content
        }
    }
}

/// Las dos mitades con sus luces y el velo (ui/VersusCard.css `.versus__half--*`, `.versus__veil`).
private struct FondoVersusAgenda: View {
    let datos: DatosVersus
    let valla: Bool
    @State private var caja = CGSize(width: 1, height: 1)

    private var coloresLocal: [Color] {
        [datos.mitadLocal.color, MezclaOKLab.mezclar(datos.mitadLocal, PalcoFijo.tintaOscura, p: 0.78).color]
    }
    private var coloresVisitante: [Color] {
        [MezclaOKLab.mezclar(datos.mitadVisitante, RGB(r: 1, g: 1, b: 1), p: 0.88).color, datos.mitadVisitante.color]
    }

    var body: some View {
        let mitad = CGSize(width: caja.width / 2, height: caja.height)
        ZStack {
            HStack(spacing: 0) {
                MitadAgenda(colores: coloresLocal, local: true, caja: mitad)
                MitadAgenda(colores: coloresVisitante, local: false, caja: mitad)
            }
            .opacity(datos.terminado ? 0.72 : 1)
            if valla { VeloValla(caja: caja) } else { VeloAgenda(caja: caja) }
        }
        .onGeometryChange(for: CGSize.self) { $0.size } action: { caja = $0 }
    }
}

/// Una mitad: `linear(160°)` + la luz radial de su esquina.
private struct MitadAgenda: View {
    let colores: [Color]
    let local: Bool
    let caja: CGSize

    var body: some View {
        ZStack {
            Degradado.lineal(160, colores, ancho: caja.width, alto: caja.height)
            Degradado.elipse(
                Color.white.opacity(local ? 0.14 : 0.1), radioX: 0.9 * caja.width, radioY: caja.height, hasta: 0.6,
                centro: local ? .topLeading : .bottomTrailing)
        }
        .clipped()
    }
}

/// `linear(180°: .42 · .05 30 % · .05 45 % · .82)` + `radial(60% 55% at 50% 52%, .28 → 70 %)` (a3 §4.2).
private struct VeloAgenda: View {
    let caja: CGSize

    private static let paradas: [Gradient.Stop] = [
        Gradient.Stop(color: Color.black.opacity(0.42), location: 0),
        Gradient.Stop(color: Color.black.opacity(0.05), location: 0.3),
        Gradient.Stop(color: Color.black.opacity(0.05), location: 0.45),
        Gradient.Stop(color: Color.black.opacity(0.82), location: 1),
    ]

    var body: some View {
        ZStack {
            LinearGradient(stops: VeloAgenda.paradas, startPoint: .top, endPoint: .bottom)
            Degradado.elipse(
                Color.black.opacity(0.28), radioX: 0.6 * caja.width, radioY: 0.55 * caja.height, hasta: 0.7,
                centro: UnitPoint(x: 0.5, y: 0.52))
        }
        .clipped()
        .allowsHitTesting(false)
    }
}

/// Velo de la valla ancha (agenda.css ≥ 768): `linear(180°: .36 · 0 24 % · 0 52 % · .5)` +
/// `radial(64% 80% at 0 100%, .6 → 72 %)` + `radial(40% 60% at 50% 46%, .22 → 70 %)`.
private struct VeloValla: View {
    let caja: CGSize

    private static let paradas: [Gradient.Stop] = [
        Gradient.Stop(color: Color.black.opacity(0.36), location: 0),
        Gradient.Stop(color: Color.black.opacity(0), location: 0.24),
        Gradient.Stop(color: Color.black.opacity(0), location: 0.52),
        Gradient.Stop(color: Color.black.opacity(0.5), location: 1),
    ]

    var body: some View {
        ZStack {
            LinearGradient(stops: VeloValla.paradas, startPoint: .top, endPoint: .bottom)
            Degradado.elipse(
                Color.black.opacity(0.6), radioX: 0.64 * caja.width, radioY: 0.8 * caja.height, hasta: 0.72,
                centro: .bottomLeading)
            Degradado.elipse(
                Color.black.opacity(0.22), radioX: 0.4 * caja.width, radioY: 0.6 * caja.height, hasta: 0.7,
                centro: UnitPoint(x: 0.5, y: 0.46))
        }
        .clipped()
        .allowsHitTesting(false)
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

/// El chip de cuándo: cápsula sm de cristal en MAYÚSCULAS con +0,06 em; directo con punto; el minuto rueda.
struct ChipCuando: View {
    let cuando: CuandoVersus
    let enDirecto: Bool

    private var estilo: EstiloTexto {
        var e = EstiloTexto.capsulaSm
        e.trackingEm = 0.06
        return e
    }

    private func mayusculas(_ texto: String) -> String { texto.uppercased(with: Locale(identifier: "es_ES")) }

    var body: some View {
        HStack(spacing: 5) {
            if enDirecto { Circle().fill(Color.white).frame(width: 7, height: 7) }
            Text(mayusculas(cuando.minuto == nil ? cuando.texto : "\(cuando.texto) · ")).estilo(estilo)
            if let minuto = cuando.minuto {
                Num("\(minuto)'", estilo: estilo, celda: Num.celdaTexto, animacion: .rueda)
            }
        }
        .lineLimit(1)
        .padding(.horizontal, 8)
        .frame(height: 24)
        .background { fondo }
        .foregroundStyle(Palco.onVideo)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(cuando.rotulo)
    }

    @ViewBuilder private var fondo: some View {
        if enDirecto {
            Capsule().fill(PalcoMezcla.liveCapsula)
        } else {
            Color.clear.cristal(.video, en: Capsule()).bordeInterior(Color.white.opacity(0.12), forma: Capsule())
        }
    }
}

/// `.versus__mine`: alto 24, oro, estrella rellena de 16 y «Tu equipo» (el texto solo en el héroe).
private struct MarcaTuEquipoAgenda: View {
    let grande: Bool

    var body: some View {
        HStack(spacing: 5) {
            IconoPalco(.starF, tamano: 16)
            if grande { Text("Tu equipo").estilo(EstiloTexto(tamano: 11, peso: 700, trackingEm: 0.02, altoLinea: 1)) }
        }
        .padding(.leading, grande ? 6 : 5)
        .padding(.trailing, grande ? 8 : 5)
        .frame(height: 24)
        .background(Palco.accent, in: Capsule())
        .foregroundStyle(Palco.onAccent)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Tu equipo")
    }
}

/// Abajo: «Local» / «vs. Visitante» (800 · wdth 125 · −0,015 em · lh 1,15) y, en el héroe, la competición.
private struct PieVersusAgenda: View {
    let datos: DatosVersus
    let heroe: Bool
    let valla: Bool

    private var tamanoNombre: Double { valla ? 30 : heroe ? 17 : 15 }
    private var estiloNombre: EstiloTexto {
        EstiloTexto(tamano: tamanoNombre, peso: 800, anchura: 125, trackingEm: -0.015, altoLinea: 1.15)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: heroe ? 4 : 2) {
            VStack(alignment: .leading, spacing: 0) {
                nombre(datos.local)
                HStack(alignment: .firstTextBaseline, spacing: CGFloat(tamanoNombre * 0.3)) {
                    Text("vs.").estilo(EstiloTexto(tamano: tamanoNombre * 0.8, peso: 600))
                        .foregroundStyle(Color.white.opacity(0.7))
                    nombre(datos.visitante)
                }
            }
            if heroe {
                Text(datos.competicion)
                    .estilo(EstiloTexto(tamano: 13, peso: 600, altoLinea: 1.45))
                    .foregroundStyle(Color.white.opacity(0.76))
                    .lineLimit(1)
            }
        }
        .shadow(color: Color.black.opacity(0.6), radius: 1.5, y: 1)  // text-shadow 0 1 3
    }

    private func nombre(_ equipo: DatosEquipo) -> some View {
        Text(equipo.nombre).estilo(estiloNombre).lineLimit(1)
    }
}
