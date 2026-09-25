import SwiftUI

/// Datos de muestra de la galería (SistemaPage.tsx): clubes, tarjetas versus y la «retransmisión de mentira».
enum MuestrasGaleria {
    static func equipo(_ nombre: String, _ siglas: String, _ primario: String?, _ secundario: String?) -> DatosEquipo {
        let tono = TonosMarca.tonoNombre(nombre)
        let base = primario.flatMap { RGB(hexTexto: $0) } ?? MezclaOKLab.oklch(tono.l, tono.c, tono.h)
        return DatosEquipo(nombre: nombre, siglas: siglas, primario: base, secundario: secundario.flatMap { RGB(hexTexto: $0) },
                           escudo: nil, halo: nil)
    }

    static let barca = equipo("FC Barcelona", "BAR", "#a50044", "#004d98")
    static let juve = equipo("Juventus", "JUV", "#101010", "#ffffff")
    static let sevilla = equipo("Sevilla", "SEV", "#d4021d", "#ffffff")
    static let girona = equipo("Girona", "GIR", "#cd2534", "#ffffff")
    static let madrid = equipo("Real Madrid", "RMA", "#febe10", "#1a1a5e")
    static let city = equipo("Manchester City", "MCI", "#6cabdd", "#1c2c5b")
    static let equipoA = equipo("Equipo A", "EQU", nil, nil)
    static let equipoB = equipo("Equipo B", "EQU", nil, nil)

    /// Una tarjeta versus de muestra; las mitades como `versusPair` (Sevilla–Girona: el visitante pasa a su
    /// segundo color porque los dos rojos se parecen, ΔE < 0,14).
    static func versus(_ local: DatosEquipo, _ visitante: DatosEquipo, competicion: String, cuando: String,
                       directo: Bool = false, terminado: Bool = false, mio: Bool = false, enPantalla: Bool = false,
                       mitadVisitante: RGB? = nil) -> DatosVersus {
        DatosVersus(local: local, visitante: visitante, mitadLocal: local.primario,
                    mitadVisitante: mitadVisitante ?? visitante.primario, competicion: competicion,
                    logoCompeticion: nil, cuando: cuando, enDirecto: directo, terminado: terminado, tuEquipo: mio,
                    enPantalla: enPantalla)
    }

    static let heroe = versus(barca, juve, competicion: "Amistoso", cuando: "En directo · 13'", directo: true, mio: true)

    struct Cartel: Identifiable {
        let id: Int
        let datos: DatosVersus
        let pequena: Bool
    }

    static let carteles: [Cartel] = [
        Cartel(id: 0, datos: versus(sevilla, girona, competicion: "LaLiga", cuando: "SÁB 21:00",
                                    mitadVisitante: RGB(r: 1, g: 1, b: 1)), pequena: false),
        Cartel(id: 1, datos: versus(madrid, city, competicion: "Champions League", cuando: "En directo · 45+2'",
                                    directo: true, enPantalla: true), pequena: false),
        Cartel(id: 2, datos: versus(juve, sevilla, competicion: "Europa League", cuando: "Final", terminado: true),
               pequena: false),
        Cartel(id: 3, datos: versus(equipoA, equipoB, competicion: "Fútbol", cuando: "Por confirmar"), pequena: true),
    ]
}

/// `.sis-glass`: la «retransmisión de mentira» (radio 24, relleno 24 16): dos focos (rojo en 20 % 30 % y azul en
/// 80 % 70 %) sobre franjas verticales de césped de 40.
struct FondoRetransmision: View {
    @State private var caja = CGSize(width: 1, height: 1)

    var body: some View {
        ZStack {
            Canvas { contexto, tamano in
                var x: CGFloat = 0
                var par = true
                while x < tamano.width {
                    let franja = Path(CGRect(x: x, y: 0, width: 40, height: tamano.height))
                    contexto.fill(franja, with: .color(par ? PalcoFijo.cesped1 : PalcoFijo.cesped2))
                    x += 40
                    par.toggle()
                }
            }
            Degradado.elipse(PalcoFijo.focoRojo, radioX: 0.3 * caja.width, radioY: 0.5 * caja.height, hasta: 1,
                             centro: UnitPoint(x: 0.2, y: 0.3))
            Degradado.elipse(PalcoFijo.focoAzul, radioX: 0.3 * caja.width, radioY: 0.5 * caja.height, hasta: 1,
                             centro: UnitPoint(x: 0.8, y: 0.7))
        }
        .onGeometryChange(for: CGSize.self) { $0.size } action: { caja = $0 }
    }
}
