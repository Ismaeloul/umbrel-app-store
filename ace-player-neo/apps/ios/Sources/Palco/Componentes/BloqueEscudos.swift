import SwiftUI

/// Los datos de una tarjeta versus (ui/VersusCard.tsx): las mitades ya vienen de `versusPair`.
struct DatosVersus: Hashable, Sendable {
    var local: DatosEquipo
    var visitante: DatosEquipo
    var mitadLocal: RGB
    var mitadVisitante: RGB
    var competicion: String
    var logoCompeticion: URL?
    var cuando: String
    var enDirecto: Bool
    var terminado: Bool
    var tuEquipo: Bool
    var enPantalla: Bool
}

/// `.versus__crests`: escudo local · pastilla de competición · escudo visitante (la pieza que vuela de la
/// tarjeta al teatro). Escudos encendidos en directo y con la sombra `--shadow-crest`.
struct BloqueEscudos: View {
    let datos: DatosVersus
    let tamano: CGFloat

    init(_ datos: DatosVersus, tamano: CGFloat) {
        self.datos = datos
        self.tamano = tamano
    }

    /// `CREST` → `COMP` de VersusCard.tsx: 40/56 → sm 22, 64 → md 28, 84 → lg 40.
    private var altoPastilla: CGFloat {
        if tamano >= 84 { return 40 }
        return tamano >= 64 ? 28 : 22
    }

    /// Separación: sm 6 · md/lg 10 · xl 16.
    private var separacion: CGFloat {
        if tamano >= 84 { return 16 }
        return tamano <= 40 ? 6 : 10
    }

    var body: some View {
        HStack(spacing: separacion) {
            MarcaEquipo(datos.local, tamano: tamano, encendido: datos.enDirecto)
            PastillaCompeticion(nombre: datos.competicion, logo: datos.logoCompeticion, tamano: altoPastilla)
            MarcaEquipo(datos.visitante, tamano: tamano, encendido: datos.enDirecto)
        }
        .islaOscura()
        .accessibilityHidden(true)
    }
}
