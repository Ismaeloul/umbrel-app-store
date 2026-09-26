import SwiftUI

/* Los dos equipos de un partido listos para Palco (lib/teams.ts de la web: `teamPalette`, `teamShort`,
   `teamCrest`, `paletteOf`, `teamInitials`): colores de la API o el tono del nombre, siglas de la API o las
   iniciales y el escudo del propio servidor (ruta relativa + `/native`). Cuando M2 publique `Equipos`
   (Core/Reglas/Color), esto llama a ese port. */

enum EquiposTeatro {
    private static let saltar: Set<String> = [
        "de", "del", "la", "las", "los", "el", "fc", "cf", "cd", "sd", "ud", "sc", "ac", "afc", "club", "y",
    ]

    /// «Atlético de Madrid» → «AM»; «Tottenham» → «TOT»; `short` de la API si lo hay (hasta 4 letras).
    static func siglas(_ nombre: String, corto: String?) -> String {
        if let corto = corto?.trimmingCharacters(in: .whitespaces), !corto.isEmpty {
            return String(corto.prefix(4)).uppercased()
        }
        let sinTildes = nombre.applyingTransform(.stripDiacritics, reverse: false) ?? nombre
        let palabras = sinTildes.split(whereSeparator: { $0 == " " || $0 == "." || $0 == "-" }).map(String.init)
            .filter { !$0.isEmpty && !saltar.contains($0.lowercased()) }
        if palabras.isEmpty { return "?" }
        if palabras.count == 1 { return String(palabras[0].prefix(3)).uppercased() }
        return palabras.prefix(3).compactMap(\.first).map(String.init).joined().uppercased()
    }

    /// URL absoluta de una imagen del servidor: la base con la que se habla y el prefijo `/native`.
    static func url(_ relativa: String?, base: URL?) -> URL? {
        guard let relativa, relativa.hasPrefix("/"), !relativa.hasPrefix("//"), let base else { return nil }
        return URL(string: "/native" + relativa, relativeTo: base)?.absoluteURL
    }

    /// El equipo de un lado, con sus colores (API o tono del nombre), siglas y escudo.
    static func equipo(_ partido: FootballMatch, local: Bool, base: URL?) -> DatosEquipo {
        let nombre = local ? partido.home : partido.away
        let insignia = local ? partido.homeTeam : partido.awayTeam
        let tono = TonosMarca.tonoNombre(nombre)
        let primario = insignia?.colors.flatMap { RGB(hexTexto: $0.primary) } ?? MezclaOKLab.oklch(tono.l, tono.c, tono.h)
        let secundario = insignia?.colors?.secondary.flatMap { RGB(hexTexto: $0) }
        return DatosEquipo(
            nombre: nombre, siglas: siglas(nombre, corto: insignia?.short), primario: primario, secundario: secundario,
            escudo: url(insignia?.crest, base: base), halo: nil)
    }
}

/// La base del servidor para escudos y logos: se pide una vez al `ServerResolver` del entorno.
struct BaseServidor: ViewModifier {
    @Environment(\.servidores) private var servidores
    @Binding var base: URL?

    func body(content: Content) -> some View {
        content.task(id: servidores == nil) {
            guard let servidores else { return }
            if let activo = await servidores.conocido() {
                base = activo.url
            } else {
                base = await servidores.configuracion().candidatas.first?.url
            }
        }
    }
}
