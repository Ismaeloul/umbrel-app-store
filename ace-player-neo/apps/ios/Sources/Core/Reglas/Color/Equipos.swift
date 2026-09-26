import Foundation

/* Equipos y competiciones de un partido (b-arquitectura §2.1.3, M2; a1 §2.5, a7 §11.12): lib/teams.ts.
   Colores (los de la API o un tono estable del nombre), siglas, escudo de mismo origen y el par de colores
   de la tarjeta versus (si se parecen, el visitante usa su segundo color; si siguen chocando, se oscurece
   la mitad más clara). */

/// Lado de un partido (`MatchSide`).
enum LadoPartido: String, Sendable { case local = "home", visitante = "away" }

/// De dónde salen los colores de un equipo.
enum OrigenPaleta: String, Sendable { case api, nombre = "name" }

/// `TeamPalette`: `#rrggbb` en minúsculas.
struct PaletaEquipo: Hashable, Sendable {
    var primario: String
    var secundario: String?
    var origen: OrigenPaleta
}

/// `VersusPair`: los dos colores definitivos de la tarjeta versus.
struct ParVersus: Hashable, Sendable {
    var local: String
    var visitante: String
    /// El visitante ha pasado a su segundo color.
    var cambiado: Bool
    /// Se ha oscurecido una mitad porque seguían pareciéndose.
    var oscurecido: Bool
}

enum Equipos {
    /// `VERSUS_DELTA`: por debajo, dos colores se leen como «el mismo».
    static let deltaVersus = 0.14
    /// `VERSUS_DARKEN`: cuánto se oscurece una mitad cuando ni el segundo color la salva.
    static let oscurecerVersus = 0.18

    /// `SKIP`: palabras que no dan inicial.
    static let palabrasVacias: Set<String> = [
        "de", "del", "la", "las", "los", "el", "fc", "cf", "cd", "sd", "ud", "sc", "ac", "afc", "club", "y",
    ]

    /// `teamInitials`: «Atlético de Madrid» → «AM»; «Tottenham» → «TOT»; con `short`, ese (4 letras).
    static func iniciales(_ nombre: String, corto: String? = nil) -> String {
        if let corto {
            let limpio = corto.trimmingCharacters(in: .whitespacesAndNewlines)
            if !limpio.isEmpty { return String(limpio.prefix(4)).uppercased() }
        }
        let palabras = Texto.sinMarcas(nombre)
            .split(whereSeparator: { $0.isWhitespace || $0 == "." || $0 == "-" })
            .map(String.init)
            .filter { !palabrasVacias.contains($0.lowercased()) }
        guard let primera = palabras.first else { return "?" }
        if palabras.count == 1 { return String(primera.prefix(3)).uppercased() }
        return String(palabras.prefix(3).compactMap(\.first)).uppercased()
    }

    /// `nameTone`: mitad de tarjeta de un club sin colores (L 0,5, C 0,12, tono del nombre).
    static func tonoNombre(_ nombre: String) -> Oklch {
        Oklch(l: 0.5, c: 0.12, h: ColorOKLab.tonoDeNombre(nombre))
    }

    /// `normalizeHex`.
    static func hexNormalizado(_ valor: String?) -> String? {
        ColorOKLab.desdeHex(valor).map(ColorOKLab.hex)
    }

    /// `paletteOf`: los colores de la API o el tono del nombre.
    static func paleta(nombre: String, primario: String?, secundario: String?) -> PaletaEquipo {
        if let primario = hexNormalizado(primario) {
            return PaletaEquipo(primario: primario, secundario: hexNormalizado(secundario), origen: .api)
        }
        return PaletaEquipo(primario: ColorOKLab.hex(ColorOKLab.rgb(tonoNombre(nombre))), secundario: nil, origen: .nombre)
    }

    // MARK: Un partido

    /// `teamBadge`.
    static func escudoAPI(_ partido: FootballMatch, _ lado: LadoPartido) -> TeamBadge? {
        lado == .local ? partido.homeTeam : partido.awayTeam
    }

    /// `teamName`.
    static func nombre(_ partido: FootballMatch, _ lado: LadoPartido) -> String {
        lado == .local ? partido.home : partido.away
    }

    /// `teamPalette`.
    static func paleta(_ partido: FootballMatch, _ lado: LadoPartido) -> PaletaEquipo {
        let colores = escudoAPI(partido, lado)?.colors
        return paleta(nombre: nombre(partido, lado), primario: colores?.primary, secundario: colores?.secondary)
    }

    /// `teamShort`: siglas de hasta 4 letras.
    static func siglas(_ partido: FootballMatch, _ lado: LadoPartido) -> String {
        iniciales(nombre(partido, lado), corto: escudoAPI(partido, lado)?.short)
    }

    /// `teamCrest`: ruta relativa del escudo (mismo origen) o `nil`; en demo siempre `nil`.
    static func escudo(_ partido: FootballMatch, _ lado: LadoPartido) -> String? {
        mismoOrigen(escudoAPI(partido, lado)?.crest)
    }

    /// `competitionLogo`.
    static func logoCompeticion(_ partido: FootballMatch) -> String? {
        mismoOrigen(partido.competitionBadge?.logo)
    }

    /// `sameOrigin`: solo rutas relativas del propio servidor (nada de enlazar a terceros).
    static func mismoOrigen(_ ruta: String?) -> String? {
        guard let ruta, ruta.hasPrefix("/"), !ruta.hasPrefix("//") else { return nil }
        return ruta
    }

    // MARK: Competición

    /// `COMPETITION_SHORT`, por orden (sin distinguir mayúsculas).
    static let competicionesCortas: [(patrones: [String], corta: String)] = [
        (["champions"], "UCL"), (["europa league"], "UEL"), (["conference"], "UECL"), (["nations league"], "UNL"),
        (["premier"], "PL"), (["laliga", "la liga"], "LaLiga"), (["hypermotion", "segunda"], "LaLiga 2"),
        (["copa del rey"], "Copa"), (["serie a"], "Serie A"), (["bundesliga"], "BL"), (["ligue 1"], "L1"),
        (["mundial", "world cup"], "Mundial"), (["eurocopa", "euro "], "Euro"),
    ]

    /// `competitionShort`: «Champions League» → «UCL»; un nombre largo → sus iniciales; vacío → «Fútbol».
    static func competicionCorta(_ nombre: String) -> String {
        let limpio = nombre.trimmingCharacters(in: .whitespacesAndNewlines)
        if limpio.isEmpty { return "Fútbol" }
        let minusculas = limpio.lowercased()
        for entrada in competicionesCortas where entrada.patrones.contains(where: { minusculas.contains($0) }) {
            return entrada.corta
        }
        if limpio.utf16.count <= 10 { return limpio }
        let iniciales = limpio.split(whereSeparator: { $0.isWhitespace || $0 == "-" })
            .map(String.init)
            .filter { !palabrasVacias.contains($0.lowercased()) }
            .compactMap(\.first)
        let texto = String(iniciales).uppercased()
        return texto.isEmpty ? String(limpio.prefix(10)) : String(texto.prefix(4))
    }

    // MARK: Par versus

    /// `colorDistance`: ΔE en OKLab (0 = igual; ~1 = blanco a negro).
    static func distancia(_ a: String, _ b: String) -> Double {
        let x = lab(a)
        let y = lab(b)
        let dl = x.l - y.l
        let da = x.a - y.a
        let db = x.b - y.b
        return (dl * dl + da * da + db * db).squareRoot()
    }

    /// OKLab pasando por OKLCH, como `lab()` de teams.ts (gris medio si no es un hex).
    private static func lab(_ hex: String) -> (l: Double, a: Double, b: Double) {
        let color = ColorOKLab.oklch(ColorOKLab.desdeHex(hex) ?? RGB(r: 0.5, g: 0.5, b: 0.5))
        let radianes = color.h * Double.pi / 180
        return (color.l, color.c * cos(radianes), color.c * sin(radianes))
    }

    /// `darken`: L − 0,18 (mínimo 0,12).
    private static func oscurecer(_ hex: String) -> String {
        guard let rgb = ColorOKLab.desdeHex(hex) else { return hex }
        var color = ColorOKLab.oklch(rgb)
        color.l = max(0.12, color.l - oscurecerVersus)
        return ColorOKLab.hex(ColorOKLab.rgb(color))
    }

    /// `versusPair`.
    static func versus(_ local: PaletaEquipo, _ visitante: PaletaEquipo) -> ParVersus {
        var h = local.primario
        var a = visitante.primario
        var cambiado = false
        var oscurecido = false
        if distancia(h, a) < deltaVersus {
            if let segundo = visitante.secundario, distancia(h, segundo) >= deltaVersus {
                a = segundo
                cambiado = true
            }
            if distancia(h, a) < deltaVersus {
                if lab(a).l >= lab(h).l { a = oscurecer(a) } else { h = oscurecer(h) }
                oscurecido = true
            }
        }
        return ParVersus(local: h, visitante: a, cambiado: cambiado, oscurecido: oscurecido)
    }

    /// `matchVersusPair`.
    static func versus(_ partido: FootballMatch) -> ParVersus {
        versus(paleta(partido, .local), paleta(partido, .visitante))
    }
}
