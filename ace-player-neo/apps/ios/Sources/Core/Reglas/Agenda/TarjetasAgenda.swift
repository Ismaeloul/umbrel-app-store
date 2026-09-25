import Foundation

/* Lo que necesita una tarjeta versus de la agenda (M5; a3 §7): port de agenda/cards.ts (`versusWhen`,
   `signalWord`, `signalTone`, los lados con su paleta) y lo mínimo de lib/teams.ts y lib/color.ts que usa
   (`teamPalette`, `versusPair`, `teamInitials`, `teamLight`, `hueFromName`).
   PROVISIONAL en la parte de color: el port probado con vectores de lib/color.ts y lib/teams.ts es de M2
   (Core/Reglas/Color); cuando llegue, `ColoresPartido` llama a ese port sin cambiar las vistas. Los nombres
   son propios para no chocar con los de M2. */

/// El chip de cuándo (`VersusWhen`).
struct CuandoVersus: Equatable, Sendable {
    enum Tipo: Equatable, Sendable { case directo, terminado, porConfirmar, hora }
    var tipo: Tipo
    var texto: String
    /// En directo con minuto: «54», «45+2».
    var minuto: String?

    /// Lo que se lee en la cápsula (antes de pasarlo a mayúsculas): «En directo · 54'».
    var rotulo: String {
        if let minuto { return "\(texto) · \(minuto)'" }
        return texto
    }
}

/// Tono de la cápsula de señal (`signalTone`): el semáforo para lo sabido, neutro mientras se mira.
enum TonoSenal: Equatable, Sendable { case ok, weak, fail, neutral }

/// Un lado de la tarjeta ya resuelto (`versusSide`): nombre, siglas, colores y escudo.
struct LadoVersus: Equatable, Sendable {
    var nombre: String
    var siglas: String
    var primario: RGB
    var secundario: RGB?
    /// Ruta relativa del escudo (mismo origen) o nil.
    var escudo: String?
    /// La luz del club en oscuro (`teamLight(…, 'dark')`): halo de los escudos encendidos.
    var luz: RGB
}

enum TarjetasAgenda {
    /// `versusWhen`.
    static func cuando(_ partido: FootballMatch, reloj: RelojMadrid, marcador: LiveScore?) -> CuandoVersus {
        let estado = ReglasAgenda.estado(partido, reloj: reloj, marcador: marcador)
        if estado?.fase == .directo {
            let minuto = Marcadores.minuto(marcador)
            if minuto?.descanso == true { return CuandoVersus(tipo: .directo, texto: "Descanso") }
            return CuandoVersus(tipo: .directo, texto: "En directo", minuto: minuto?.minuto)
        }
        if estado?.fase == .terminado { return CuandoVersus(tipo: .terminado, texto: "Final") }
        guard ReglasAgenda.minutosDeHora(partido.time) != nil else {
            return CuandoVersus(tipo: .porConfirmar, texto: "Por confirmar")
        }
        let dia = ReglasAgenda.etiquetaDia(partido.date, hoy: reloj.fecha)
        return CuandoVersus(tipo: .hora, texto: "\(dia.principal) \(partido.time)")
    }

    /// `signalTone`.
    static func tono(_ estado: EstadoSenal) -> TonoSenal {
        switch estado {
        case .ok: .ok
        case .weak: .weak
        case .fail: .fail
        case .checking, .pending: .neutral
        }
    }

    /// `versusSide`: el nombre completo (o «…»), las siglas, la paleta y el escudo.
    static func lado(_ partido: FootballMatch, local: Bool) -> LadoVersus {
        let insignia = local ? partido.homeTeam : partido.awayTeam
        let nombreCompleto = local ? partido.home : partido.away
        let nombre = nombreCompleto.isEmpty ? (local ? partido.title : "") : nombreCompleto
        let paleta = ColoresPartido.paleta(nombre: nombreCompleto, colores: insignia?.colors)
        let luz = ColoresPartido.luz(paleta.primario, paleta.secundario) ?? ColoresPartido.oklch(
            0.66, 0.13, ColoresPartido.tono(nombreCompleto.isEmpty ? "?" : nombreCompleto))
        return LadoVersus(
            nombre: nombre.isEmpty ? "…" : nombre,
            siglas: ColoresPartido.iniciales(nombreCompleto, corto: insignia?.short),
            primario: paleta.primario, secundario: paleta.secundario,
            escudo: ColoresPartido.mismoOrigen(insignia?.crest), luz: luz)
    }

    /// Las dos mitades de la tarjeta (`matchVersusPair`).
    static func mitades(_ partido: FootballMatch) -> (local: RGB, visitante: RGB) {
        let local = ColoresPartido.paleta(nombre: partido.home, colores: partido.homeTeam?.colors)
        let visitante = ColoresPartido.paleta(nombre: partido.away, colores: partido.awayTeam?.colors)
        return ColoresPartido.parVersus(local, visitante)
    }

    /// `competitionLogo`: ruta relativa del logo o nil.
    static func logoCompeticion(_ partido: FootballMatch) -> String? {
        ColoresPartido.mismoOrigen(partido.competitionBadge?.logo)
    }

    /// El nombre de la competición que se pinta («Fútbol» si viene vacía).
    static func competicion(_ partido: FootballMatch) -> String {
        let limpia = partido.competition.trimmingCharacters(in: .whitespacesAndNewlines)
        return limpia.isEmpty ? "Fútbol" : limpia
    }
}

/// Colores de club (lib/color.ts y lib/teams.ts) en OKLab/OKLCH, puros.
enum ColoresPartido {
    /// `VERSUS_DELTA` y `VERSUS_DARKEN` (lib/teams.ts).
    static let deltaVersus = 0.14
    static let oscurecer = 0.18

    struct Paleta: Equatable, Sendable {
        var primario: RGB
        var secundario: RGB?
    }

    /// `parseHex`: «#rgb» o «#rrggbb».
    static func hex(_ texto: String?) -> RGB? {
        guard var limpio = texto?.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
        if limpio.hasPrefix("#") { limpio.removeFirst() }
        if limpio.count == 3 { limpio = limpio.map { "\($0)\($0)" }.joined() }
        guard limpio.count == 6, let n = UInt32(limpio, radix: 16) else { return nil }
        return RGB(r: Double((n >> 16) & 255) / 255, g: Double((n >> 8) & 255) / 255, b: Double(n & 255) / 255)
    }

    /// `paletteOf`: los de la API o el tono del nombre (`nameTone`: L 0,5, C 0,12).
    static func paleta(nombre: String, colores: TeamColors?) -> Paleta {
        if let primario = hex(colores?.primary) { return Paleta(primario: primario, secundario: hex(colores?.secondary)) }
        return Paleta(primario: oklch(0.5, 0.12, tono(nombre)), secundario: nil)
    }

    /// `versusPair`.
    static func parVersus(_ local: Paleta, _ visitante: Paleta) -> (local: RGB, visitante: RGB) {
        var h = local.primario
        var a = visitante.primario
        if distancia(h, a) < deltaVersus {
            if let segundo = visitante.secundario, distancia(h, segundo) >= deltaVersus { a = segundo }
            if distancia(h, a) < deltaVersus {
                if lab(a).l >= lab(h).l { a = oscurecido(a) } else { h = oscurecido(h) }
            }
        }
        return (h, a)
    }

    /// `teamLight(…, 'dark')`: la luz del club con L ∈ [0,55, 0,93] y C ≤ 0,22.
    static func luz(_ primario: RGB, _ secundario: RGB?) -> RGB? {
        let c = aOklch(primario)
        return oklch(min(0.93, max(0.55, c.l)), min(c.c, 0.22), c.h)
    }

    /// `teamInitials`: `short` de la API o las iniciales (sin «de, del, fc…»).
    static func iniciales(_ nombre: String, corto: String?) -> String {
        if let corto, !corto.trimmingCharacters(in: .whitespaces).isEmpty {
            return String(corto.trimmingCharacters(in: .whitespaces).prefix(4)).uppercased()
        }
        let limpio = ParaTi.sinMarcas(nombre)
        let vacias: Set<String> = [
            "de", "del", "la", "las", "los", "el", "fc", "cf", "cd", "sd", "ud", "sc", "ac", "afc", "club", "y",
        ]
        let palabras = limpio.split(whereSeparator: { $0.isWhitespace || $0 == "." || $0 == "-" })
            .map(String.init).filter { !vacias.contains($0.lowercased()) }
        guard let primera = palabras.first else { return "?" }
        if palabras.count == 1 { return String(primera.prefix(3)).uppercased() }
        return String(palabras.prefix(3).compactMap(\.first)).uppercased()
    }

    /// Solo rutas relativas del propio servidor (nada de terceros).
    static func mismoOrigen(_ ruta: String?) -> String? {
        guard let ruta, ruta.hasPrefix("/"), !ruta.hasPrefix("//") else { return nil }
        return ruta
    }

    // MARK: lib/color.ts

    /// FNV-1a de 32 bits sobre las unidades UTF-16 (`hashText`).
    static func hash(_ texto: String) -> UInt32 {
        var h: UInt32 = 0x811C_9DC5
        for unidad in texto.utf16 {
            h ^= UInt32(unidad)
            h = h &* 0x0100_0193
        }
        return h
    }

    /// Múltiplos de 5 fuera de [15,40], [140,160] y [280,320] (52 tonos).
    static let tonos: [Int] = stride(from: 0, to: 360, by: 5).filter { h in
        !((15...40).contains(h) || (140...160).contains(h) || (280...320).contains(h))
    }

    /// `hueFromName`.
    static func tono(_ nombre: String) -> Double {
        let clave = nombre.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return Double(tonos[Int(hash(clave) % UInt32(tonos.count))])
    }

    static func distancia(_ a: RGB, _ b: RGB) -> Double {
        let x = lab(a)
        let y = lab(b)
        let dl = x.l - y.l
        let da = x.a - y.a
        let db = x.b - y.b
        return (dl * dl + da * da + db * db).squareRoot()
    }

    private static func oscurecido(_ c: RGB) -> RGB {
        let o = aOklch(c)
        return oklch(max(0.12, o.l - oscurecer), o.c, o.h)
    }

    private static func lineal(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
    private static func gamma(_ c: Double) -> Double { c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1 / 2.4) - 0.055 }

    static func lab(_ c: RGB) -> (l: Double, a: Double, b: Double) {
        let r = lineal(c.r)
        let g = lineal(c.g)
        let b = lineal(c.b)
        let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        let L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
        let A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
        let B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
        return (L, A, B)
    }

    static func aOklch(_ c: RGB) -> (l: Double, c: Double, h: Double) {
        let o = lab(c)
        let croma = (o.a * o.a + o.b * o.b).squareRoot()
        var tono = atan2(o.b, o.a) * 180 / Double.pi
        if tono < 0 { tono += 360 }
        return (o.l, croma, tono)
    }

    /// OKLCH → sRGB recortado.
    static func oklch(_ l: Double, _ c: Double, _ h: Double) -> RGB {
        let r0 = h * Double.pi / 180
        let A = c * cos(r0)
        let B = c * sin(r0)
        let l1 = l + 0.3963377774 * A + 0.2158037573 * B
        let m1 = l - 0.1055613458 * A - 0.0638541728 * B
        let s1 = l - 0.0894841775 * A - 1.291485548 * B
        let ll = l1 * l1 * l1
        let mm = m1 * m1 * m1
        let ss = s1 * s1 * s1
        let r = 4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss
        let g = -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss
        let b = -0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss
        let recorte: (Double) -> Double = { min(1, max(0, $0)) }
        return RGB(r: recorte(gamma(max(0, r))), g: recorte(gamma(max(0, g))), b: recorte(gamma(max(0, b))))
    }
}
