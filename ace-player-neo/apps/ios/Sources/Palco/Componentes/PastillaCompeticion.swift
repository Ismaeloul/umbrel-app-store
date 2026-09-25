import SwiftUI

/// `<CompetitionBadge>` de la web (a1 §10.14; ui/CompetitionBadge.css): cápsula de alto `tamano` (sm 22 · md
/// 28 · lg 40), fondo `--glass-video-solid`, borde interior blanco al 12 % y sombra `0 2 8` negra al 35 %; el
/// nombre corto (`competitionShort`) a `max(11, 0,42·alto)` · 760 · wdth 88 · +0,06 em en mayúsculas, o el
/// logo del servidor (alto − 8, ancho ≤ 2,4·alto). Isla oscura. Decorativa.
struct PastillaCompeticion: View {
    let nombre: String
    let logo: URL?
    let tamano: CGFloat

    init(nombre: String, logo: URL?, tamano: CGFloat = 20) {
        self.nombre = nombre
        self.logo = logo
        self.tamano = tamano
    }

    /// Relleno lateral: sm 7 · md 10 · lg 14; con logo, 6.
    private var relleno: CGFloat {
        if logo != nil { return 6 }
        if tamano <= 22 { return 7 }
        return tamano < 40 ? 10 : 14
    }

    var body: some View {
        contenido
            .padding(.horizontal, relleno)
            .frame(minWidth: tamano)
            .frame(height: tamano)
            .background(Palco.glassVideoSolid, in: Capsule())
            .bordeInterior(Color.white.opacity(0.12), forma: Capsule())
            .sombra([CapaSombra(y: 2, desenfoque: 8, color: Color.black.opacity(0.35))], forma: Capsule())
            .foregroundStyle(Palco.onVideo)
            .islaOscura()
            .accessibilityHidden(true)
    }

    @ViewBuilder private var contenido: some View {
        if let logo {
            ImagenServidor(logo, tamano: CGSize(width: tamano * 2.4, height: tamano - 8)) { texto }
                .fixedSize()
        } else {
            texto
        }
    }

    private var texto: some View {
        let letra = max(11, tamano * 0.42)
        let estilo = EstiloTexto(tamano: Double(letra), peso: 760, anchura: 88, trackingEm: 0.06, altoLinea: 1, mayusculas: true)
        return Text(TonosMarca.competicionCorta(nombre)).estilo(estilo).lineLimit(1).fixedSize()
    }
}
