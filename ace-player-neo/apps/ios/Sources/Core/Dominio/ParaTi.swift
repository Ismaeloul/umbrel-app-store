import Foundation

/* Reglas de «Para ti», portadas FIELMENTE de packages/shared/src/domain/for-you.ts
   (las mismas que usa la web). «Para ti» es la UNIÓN de todos los gustos: una
   liga aporta su cartelera completa; un equipo o una selección aportan sus
   partidos aunque la competición sea un amistoso o un torneo no elegido.

   El port se valida con vectores generados desde la función de TypeScript
   (scripts/generar-vectores.mjs → Tests/AceNeoTests/Vectores/): si alguien
   cambia las reglas de la web y no las de aquí, la CI de iOS falla.

   Desde fix/agenda-filtrado (0.8.4): lo juvenil, filial y femenino solo entra
   si lo sigues tal cual; «Barcelona» es el primer equipo masculino (idTeam
   133739 de TheSportsDB si el partido trae escudo) y «España» la absoluta
   masculina y sus competiciones exactas, nunca «LaLiga Futures». */

/// Los gustos que miran las reglas (`ForYouPreferences`).
public struct GustosFutbol: Sendable, Hashable, Codable {
    public var leagues: [String]
    public var teams: [String]
    public var nationalities: [String]

    public init(leagues: [String] = [], teams: [String] = [], nationalities: [String] = []) {
        self.leagues = leagues
        self.teams = teams
        self.nationalities = nationalities
    }

    public init(_ preferencias: Preferences?) {
        self.init(
            leagues: preferencias?.leagues ?? [], teams: preferencias?.teams ?? [],
            nationalities: preferencias?.nationalities ?? [])
    }

    public static let vacios = GustosFutbol()
}

/// Lo que las reglas miran de un partido (`ForYouMatch`).
public struct PartidoParaTi: Sendable, Hashable, Codable {
    public var competition: String
    public var title: String
    public var home: String
    public var away: String
    public var channels: [String]
    /// `homeTeam.id`/`awayTeam.id`: `idTeam` de TheSportsDB (o `k-<clave>`), si el partido trae escudo.
    public var homeTeamId: String?
    public var awayTeamId: String?

    public init(
        competition: String = "", title: String = "", home: String = "", away: String = "", channels: [String] = [],
        homeTeamId: String? = nil, awayTeamId: String? = nil
    ) {
        self.competition = competition
        self.title = title
        self.home = home
        self.away = away
        self.channels = channels
        self.homeTeamId = homeTeamId
        self.awayTeamId = awayTeamId
    }

    public init(_ partido: FootballMatch) {
        self.init(
            competition: partido.competition, title: partido.title, home: partido.home, away: partido.away,
            channels: partido.channels.map(\.name), homeTeamId: partido.homeTeam?.id, awayTeamId: partido.awayTeam?.id)
    }
}

public enum ParaTi {
    // MARK: Claves

    /// Quita las marcas diacríticas (U+0300…U+036F) tras descomponer (NFD),
    /// como `normalize('NFD').replace(/[̀-ͯ]/g, '')`.
    static func sinMarcas(_ texto: String) -> String {
        var escalares = String.UnicodeScalarView()
        for escalar in texto.decomposedStringWithCanonicalMapping.unicodeScalars
        where !(0x300...0x36F).contains(escalar.value) {
            escalares.append(escalar)
        }
        return String(escalares)
    }

    /// `[a-z0-9]` de ASCII (la clase de las expresiones de la web).
    static func esAlfanumerico(_ escalar: Unicode.Scalar) -> Bool {
        (escalar >= "a" && escalar <= "z") || (escalar >= "0" && escalar <= "9")
    }

    /// Cambia cada tramo de caracteres que no son `[a-z0-9]` por `sustituto`.
    static func colapsar(_ texto: String, sustituto: String) -> String {
        var salida = String.UnicodeScalarView()
        var enHueco = false
        for escalar in texto.unicodeScalars {
            if esAlfanumerico(escalar) {
                salida.append(escalar)
                enHueco = false
            } else if !enHueco {
                salida.append(contentsOf: sustituto.unicodeScalars)
                enHueco = true
            }
        }
        return String(salida)
    }

    /// `normalizePreferenceKey`: sin tildes, minúsculas y solo letras y cifras separadas por un espacio.
    public static func clavePreferencia(_ valor: String?) -> String {
        colapsar(sinMarcas(valor ?? "").lowercased(), sustituto: " ")
            .trimmingCharacters(in: .whitespaces)
    }

    /// `competitionKey`: como la anterior, pero sin espacios ni signos.
    public static func claveCompeticion(_ valor: String?) -> String {
        colapsar(sinMarcas(valor ?? "").lowercased(), sustituto: "")
    }

    // MARK: Cantera, filiales y femenino

    /// `VARIANT_WORDS`: palabras que delatan cantera, filial o femenino en cualquier sitio del nombre.
    static let palabrasVariante: Set<String> = [
        "academy", "academia", "juvenil", "juveniles", "cadete", "cadetes", "infantil", "alevin", "benjamin",
        "youth", "reserve", "reserves", "reserva", "reservas", "castilla", "promesas", "filial", "femenino",
        "femenina", "femeni", "femenil", "feminine", "feminino", "women", "womens", "ladies", "frauen", "vrouwen",
        "femminile",
    ]

    /// `MINOR_COMPETITION_WORDS`: las de equipos y las de competiciones menores.
    static let palabrasCompeticionMenor: Set<String> = palabrasVariante.union([
        "futures", "nwsl", "wsl", "damallsvenskan", "proyeccion", "regional", "regionalliga", "autonomica",
        "preferente", "olimpico", "olimpicos",
    ])

    /// `VARIANT_EXCEPTIONS`: primeros equipos cuyo nombre parece de filial.
    static let excepcionesVariante: Set<String> = ["willem ii"]

    private static func patron(_ texto: String) -> NSRegularExpression {
        // swiftlint:disable:next force_try
        try! NSRegularExpression(pattern: texto)
    }

    /// `VARIANT_TAIL`: las palabras cortas (y «Atlètic») solo al final del nombre.
    nonisolated(unsafe) private static let colaVariante = patron(#"\s(?:b|c|ii|iii|w|fem|atletic|juvenil [a-d])$"#)
    /// `VARIANT_AGE`: «Sub-21», «U19».
    nonisolated(unsafe) private static let edadVariante = patron(#"(?:^|\s)(?:sub|u)\s?(?:1\d|2[0-3])(?:\s|$)"#)
    /// `LIGA_F`: «Liga F» sí; la «F» suelta de un «Grupo F», no.
    nonisolated(unsafe) private static let ligaF = patron(#"(?:^|\s)liga f(?:\s|$)"#)

    private static func casa(_ expresion: NSRegularExpression, _ clave: String) -> Bool {
        expresion.firstMatch(in: clave, range: NSRange(clave.startIndex..., in: clave)) != nil
    }

    /// `footballTeamIsVariant`: ¿cantera, filial o femenino? («FC Barcelona Femení», «Barcelona Atlètic», «Spain U21»).
    public static func esVariante(_ valor: String?) -> Bool {
        let clave = clavePreferencia(valor)
        guard !clave.isEmpty, !excepcionesVariante.contains(clave) else { return false }
        return clave.split(separator: " ").contains { palabrasVariante.contains(String($0)) }
            || casa(colaVariante, clave) || casa(edadVariante, clave)
    }

    /// `footballCompetitionIsMinor`: «LaLiga Futures», «Liga F», «Europeo Sub-21».
    public static func competicionEsMenor(_ valor: String?) -> Bool {
        let clave = clavePreferencia(valor)
        guard !clave.isEmpty else { return false }
        return clave.split(separator: " ").contains { palabrasCompeticionMenor.contains(String($0)) }
            || casa(edadVariante, clave) || casa(ligaF, clave)
    }

    /// `footballMatchIsMinor`: por la competición o por cualquiera de los dos equipos.
    public static func partidoEsMenor(_ partido: PartidoParaTi) -> Bool {
        competicionEsMenor(partido.competition) || esVariante(partido.home) || esVariante(partido.away)
    }

    // MARK: Ligas

    /// `LEAGUE_ALIASES`: los nombres exactos de cada liga (se compara por igualdad).
    public static let aliasLigas: [String: [String]] = [
        "laliga": ["laliga", "laligaeasports", "primeradivision", "laligasantander", "spanishlaliga"],
        "championsleague": ["championsleague", "uefachampionsleague", "ligadecampeones"],
        "premierleague": ["premierleague"],
        "europaleague": ["europaleague", "uefaeuropaleague"],
        "copadelrey": ["copadelrey"],
        "seriea": ["seriea", "serieaitaliana"],
        "bundesliga": ["bundesliga"],
        "ligue1": ["ligue1", "francialigue1"],
        "laligahypermotion": ["laligahypermotion", "laligasmartbank", "segundadivision", "spanishlaliga2", "laliga2"],
    ]

    /// `leagueMatches`.
    public static func ligaCoincide(_ preferencia: String?, _ competicion: String?) -> Bool {
        let buscada = claveCompeticion(preferencia)
        let real = claveCompeticion(competicion)
        guard !buscada.isEmpty, !real.isEmpty else { return false }
        if let alias = aliasLigas[buscada] { return alias.contains(real) }
        return buscada == real
    }

    /// `matchIsLaLigaHypermotion`: la ficha dice «LaLiga» pero el canal o el
    /// título delatan que es Segunda.
    public static func esHypermotion(_ partido: PartidoParaTi) -> Bool {
        let senales = [partido.competition, partido.title] + partido.channels
        return senales.contains { valor in
            let clave = claveCompeticion(valor)
            return clave.contains("hypermotion") || clave.contains("smartbank") || clave.contains("segundadivision")
        }
    }

    /// `matchLeagueMatches`: con la guarda de Hypermotion.
    public static func ligaDelPartidoCoincide(_ preferencia: String?, _ partido: PartidoParaTi) -> Bool {
        let buscada = claveCompeticion(preferencia)
        let hypermotion = esHypermotion(partido)
        if buscada == "laliga" && hypermotion { return false }
        if buscada == "laligahypermotion" && hypermotion { return true }
        return ligaCoincide(preferencia, partido.competition)
    }

    // MARK: Nacionalidades

    /// `NationalityRule`.
    public struct ReglaNacionalidad: Sendable, Hashable {
        public var alias: [String]
        public var competiciones: [String]
    }

    /// `NATIONALITY_RULES`.
    public static let reglasNacionalidad: [String: ReglaNacionalidad] = [
        "espana": ReglaNacionalidad(alias: ["espana", "spain"], competiciones: ["laliga", "copa del rey", "supercopa de espana"]),
        "argentina": ReglaNacionalidad(alias: ["argentina"], competiciones: ["liga profesional argentina", "copa argentina"]),
        "brasil": ReglaNacionalidad(alias: ["brasil", "brazil"], competiciones: ["brasileirao", "serie a brazil", "copa do brasil"]),
        "inglaterra": ReglaNacionalidad(
            alias: ["inglaterra", "england"], competiciones: ["premier league", "fa cup", "efl cup", "championship"]),
        "francia": ReglaNacionalidad(alias: ["francia", "france"], competiciones: ["ligue 1", "coupe de france"]),
        "italia": ReglaNacionalidad(alias: ["italia", "italy"], competiciones: ["serie a", "coppa italia"]),
        "alemania": ReglaNacionalidad(alias: ["alemania", "germany"], competiciones: ["bundesliga", "dfb pokal"]),
        "portugal": ReglaNacionalidad(alias: ["portugal"], competiciones: ["primeira liga", "taca de portugal"]),
        "paises bajos": ReglaNacionalidad(
            alias: ["paises bajos", "netherlands", "holanda", "holland"], competiciones: ["eredivisie", "knvb beker"]),
        "marruecos": ReglaNacionalidad(alias: ["marruecos", "morocco"], competiciones: ["botola"]),
        "mexico": ReglaNacionalidad(alias: ["mexico"], competiciones: ["liga mx", "copa mx"]),
        "estados unidos": ReglaNacionalidad(
            alias: ["estados unidos", "united states", "usa"], competiciones: ["major league soccer", "mls"]),
        "uruguay": ReglaNacionalidad(alias: ["uruguay"], competiciones: ["primera division uruguay"]),
        "colombia": ReglaNacionalidad(alias: ["colombia"], competiciones: ["primera a colombia", "liga betplay"]),
    ]

    // MARK: Equipos

    /// `TEAM_PREFERENCE_ALIASES`: variantes que se reducen a una clave común.
    public static let aliasEquipos: [String: String] = [
        "barca": "barcelona",
        "fc barcelona": "barcelona",
        "at madrid": "atletico madrid",
        "atletico de madrid": "atletico madrid",
        "atletico madrid": "atletico madrid",
        "inter de milan": "inter",
        "inter milan": "inter",
        "internazionale": "inter",
        "fc internazionale": "inter",
    ]

    /// `footballTeamKey`: sin «FC»/«CF» delante o detrás.
    public static func claveEquipo(_ valor: String?) -> String {
        let clave = clavePreferencia(valor)
        guard !clave.isEmpty else { return "" }
        if let alias = aliasEquipos[clave] { return alias }
        var resultado = clave
        for prefijo in ["fc ", "cf "] where resultado.hasPrefix(prefijo) {
            resultado = String(resultado.dropFirst(prefijo.count)).trimmingCharacters(in: .whitespaces)
            break
        }
        for sufijo in [" fc", " cf"] where resultado.hasSuffix(sufijo) {
            resultado = String(resultado.dropLast(sufijo.count)).trimmingCharacters(in: .whitespaces)
            break
        }
        return resultado.trimmingCharacters(in: .whitespaces)
    }

    /// `footballTeamNameMatches`: igualdad de claves (Barcelona no trae Barcelona SC).
    public static func equipoCoincide(_ preferencia: String?, _ candidato: String?) -> Bool {
        let buscado = claveEquipo(preferencia)
        return !buscado.isEmpty && buscado == claveEquipo(candidato)
    }

    // MARK: Reglas

    /// `hasFootballPreferences`.
    public static func tieneGustos(_ gustos: GustosFutbol) -> Bool {
        !gustos.leagues.isEmpty || !gustos.teams.isEmpty || !gustos.nationalities.isEmpty
    }

    /// `FAVORITE_TEAM_IDS`: `idTeam` de TheSportsDB de los favoritos del catálogo
    /// (los mismos que fija `teams/overrides.json` en el servidor).
    public static let idsFavoritos: [String: String] = [
        "barcelona": "133739",
        "real madrid": "133738",
        "atletico madrid": "133729",
        "inter": "133681",
    ]

    /// `/^\d+$/` de JavaScript: solo cifras ASCII.
    private static func esIdNumerico(_ valor: String) -> Bool {
        !valor.isEmpty && valor.unicodeScalars.allSatisfy { $0 >= "0" && $0 <= "9" }
    }

    /// `favoriteSideMatches`: un primer equipo nunca casa con su cantera, filial
    /// o femenino; con escudo resuelto manda el `idTeam`, sin él, el nombre.
    static func ladoFavorito(_ preferencia: String, _ nombre: String, _ escudo: String?) -> Bool {
        if !esVariante(preferencia) && esVariante(nombre) { return false }
        let idEscudo = escudo ?? ""
        if let id = idsFavoritos[claveEquipo(preferencia)], esIdNumerico(idEscudo) { return idEscudo == id }
        return equipoCoincide(preferencia, nombre)
    }

    /// `footballMatchHasFavoriteTeam` (y `footballMatchHighlighted`: se
    /// resaltan los partidos de tus equipos sin cambiar el orden). En una
    /// competición menor solo cuenta un favorito que sea él mismo cantera,
    /// filial o femenino.
    public static func tieneEquipoFavorito(_ partido: PartidoParaTi, _ gustos: GustosFutbol) -> Bool {
        guard !gustos.teams.isEmpty else { return false }
        let menor = competicionEsMenor(partido.competition)
        let lados = [(partido.home, partido.homeTeamId), (partido.away, partido.awayTeamId)].filter { !$0.0.isEmpty }
        return gustos.teams.contains { equipo in
            (!menor || esVariante(equipo)) && lados.contains { ladoFavorito(equipo, $0.0, $0.1) }
        }
    }

    /// `includes` de JavaScript: la cadena vacía está en cualquier texto.
    private static func incluye(_ texto: String, _ parte: String) -> Bool {
        parte.isEmpty || texto.range(of: parte) != nil
    }

    /// `footballMatchInScope`: ¿sale el partido en «Para ti»? Sin gustos, sale todo.
    public static func enParaTi(_ partido: PartidoParaTi, _ gustos: GustosFutbol) -> Bool {
        guard tieneGustos(gustos) else { return true }
        if gustos.leagues.contains(where: { ligaDelPartidoCoincide($0, partido) }) { return true }
        if tieneEquipoFavorito(partido, gustos) { return true }
        let liga = clavePreferencia(partido.competition)
        let local = clavePreferencia(partido.home)
        let visitante = clavePreferencia(partido.away)
        let titulo = clavePreferencia(partido.title)
        let hypermotion = esHypermotion(partido)
        let menor = partidoEsMenor(partido)
        return gustos.nationalities.contains { nacionalidad in
            let clave = clavePreferencia(nacionalidad)
            let regla = reglasNacionalidad[clave] ?? ReglaNacionalidad(alias: [clave], competiciones: [])
            /* Solo la absoluta masculina: ni «España Sub-21» ni el «Amistoso
               Femenino»; el título solo cuenta si no se pudo separar el visitante. */
            let seleccion =
                !menor
                && regla.alias.contains { alias in
                    [local, visitante].contains { $0 == alias }
                        || (visitante.isEmpty && incluye(" \(titulo) ", " \(alias) "))
                }
            /* Con la guarda de Segunda: ninguna regla de país incluye
               Hypermotion; quien la quiera la marca como liga. Y por nombre
               exacto o alias, nunca por «contiene» («LaLiga Futures»). */
            let competicionDelPais =
                !menor && !hypermotion
                && regla.competiciones.contains { nombre in
                    liga == nombre || ligaDelPartidoCoincide(nombre, partido)
                }
            return seleccion || competicionDelPais
        }
    }

    public static func enParaTi(_ partido: FootballMatch, _ gustos: GustosFutbol) -> Bool {
        enParaTi(PartidoParaTi(partido), gustos)
    }

    public static func destacado(_ partido: FootballMatch, _ gustos: GustosFutbol) -> Bool {
        tieneEquipoFavorito(PartidoParaTi(partido), gustos)
    }
}
