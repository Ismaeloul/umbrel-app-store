import SwiftUI

// Canario C4 (b-arquitectura §5.3): @Entry con un valor puro como Maquetacion y con una caché
// que es un actor (opcional), tal como los usará Palco/Entorno/ValoresEntorno.swift (§2.2.10).
// Plan B: EnvironmentKey escrita a mano. Se borra al cerrar la fase 0.

struct SondaMaquetacion: Hashable, Sendable {
    var ancho: Double
    var alto: Double
    static let referencia = SondaMaquetacion(ancho: 390, alto: 844)
}

actor SondaCacheImagenes {
    private var imagenes: [URL: Data] = [:]
    func poner(_ datos: Data, para url: URL) { imagenes[url] = datos }
}

extension EnvironmentValues {
    @Entry var sondaMaquetacion: SondaMaquetacion = .referencia
    @Entry var sondaVistaActiva: Bool = true
    @Entry var sondaRadioInterior: CGFloat = 8
    @Entry var sondaCacheImagenes: SondaCacheImagenes? = nil
}

struct SondaC4Entry: View {
    @Environment(\.sondaMaquetacion) private var maquetacion
    @Environment(\.sondaCacheImagenes) private var cache

    var body: some View {
        Text(maquetacion.ancho > 700 ? "tableta" : "móvil")
            .environment(\.sondaMaquetacion, SondaMaquetacion(ancho: 844, alto: 390))
            .environment(\.sondaCacheImagenes, SondaCacheImagenes())
    }
}
