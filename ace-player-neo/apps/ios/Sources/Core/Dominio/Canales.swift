import Foundation

/* Emparejado de nombres de canal, portado FIELMENTE de
   packages/shared/src/domain/channels.ts (`normalizeChannelKey` y
   `channelMatchScore`). La app lo usa para saber qué partido de la agenda da
   cada canal de la biblioteca («Emitiendo» / «A las 21:00, …»), igual que la
   web. Se valida con los mismos vectores generados desde TypeScript que las
   reglas de «Para ti». */

public enum Canales {
    /// «Es ese canal, sin duda» (`RESOLUTION_EXACT_SCORE`).
    public static let puntuacionExacta = 92
    /// Familia numerada: «DAZN» frente a «DAZN 1» (`CHANNEL_FAMILY_SCORE`).
    public static let puntuacionFamilia = 78
    /// Techo de los que difieren en una palabra propia (`CHANNEL_VARIANT_MAX_SCORE`).
    public static let techoVariante = 58

    /// `CHANNEL_FILLER_TOKENS`: palabras que sobran o faltan sin cambiar de canal.
    public static let relleno: Set<String> = [
        "tv", "canal", "channel", "de", "del", "la", "el", "los", "las", "y", "and", "en", "the", "directo",
        "live", "senal", "opcion", "movistar", "m", "orange", "vodafone", "telecable", "plus",
    ]

    /* Límites de palabra como los de JavaScript (`\b` solo mira [A-Za-z0-9_];
       el de ICU mira también letras de otros alfabetos). */
    private static let antes = "(?<![A-Za-z0-9_])"
    private static let despues = "(?![A-Za-z0-9_])"
    /// `\b` general (tras algo que puede no ser letra, como el «+» opcional).
    private static let limite = "(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))"

    private static func patron(_ texto: String) -> NSRegularExpression {
        // swiftlint:disable:next force_try
        try! NSRegularExpression(pattern: texto)
    }

    /// Lo que va tras la flecha es QUIÉN sirve el canal, no qué canal es.
    nonisolated(unsafe) private static let flecha = patron(#"\s*(?:--?>|={1,2}>|[→⇒➜➝⟶⟹])\s*.*$"#)
    nonisolated(unsafe) private static let asteriscos = patron(#"[*#]+"#)
    nonisolated(unsafe) private static let mMas = patron(antes + #"m\s*\+"#)
    nonisolated(unsafe) private static let movistarPlus = patron(antes + #"movistar\s*plus\+?"# + limite)
    nonisolated(unsafe) private static let calidad = patron(
        antes + #"(full\s*hd|fhd|uhd|hd|sd|4k|1080p|720p)"# + despues)
    nonisolated(unsafe) private static let pais = patron(antes + #"(espana|spain)"# + despues)

    private static func cambiar(_ texto: String, _ expresion: NSRegularExpression, por sustituto: String) -> String {
        expresion.stringByReplacingMatches(
            in: texto, range: NSRange(texto.startIndex..., in: texto), withTemplate: sustituto)
    }

    /// `normalizeChannelKey`: sin operador, calidad, país ni proveedor.
    public static func clave(_ valor: String?) -> String {
        var texto = ParaTi.sinMarcas(valor ?? "").lowercased()
        // Solo la primera flecha (sin /g en la web): se lleva todo lo que sigue.
        if let primera = flecha.firstMatch(in: texto, range: NSRange(texto.startIndex..., in: texto)),
            let rango = Range(primera.range, in: texto)
        {
            texto.replaceSubrange(rango, with: " ")
        }
        texto = cambiar(texto, asteriscos, por: " ")
        texto = cambiar(texto, mMas, por: " movistar ")
        texto = cambiar(texto, movistarPlus, por: " movistar ")
        texto = cambiar(texto, calidad, por: " ")
        texto = cambiar(texto, pais, por: " ")
        return ParaTi.colapsar(texto, sustituto: " ").trimmingCharacters(in: .whitespaces)
    }

    private static func fichas(_ clave: String) -> [String] {
        clave.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
    }

    private static func numeros(_ clave: String) -> String {
        var grupos: [String] = []
        var actual = ""
        for caracter in clave {
            if caracter.isASCII, caracter.isNumber {
                actual.append(caracter)
            } else if !actual.isEmpty {
                grupos.append(actual)
                actual = ""
            }
        }
        if !actual.isEmpty { grupos.append(actual) }
        return grupos.joined(separator: ",")
    }

    /// `distinctiveTokens`: palabras de un nombre que no están en el otro y no son relleno.
    static func distintivas(_ de: [String], _ otro: [String]) -> [String] {
        let conocidas = Set(otro)
        return de.filter { !conocidas.contains($0) && !relleno.contains($0) }
    }

    /// `esCoincidenciaDeFamilia`: un nombre es el otro más un número de canal.
    static func esFamilia(_ a: String, _ b: String, _ fichasA: [String], _ fichasB: [String]) -> Bool {
        guard a.contains(b) || b.contains(a) else { return false }
        func soloSobranNumeros(_ de: [String], _ otro: [String]) -> Bool {
            let conocidas = Set(otro)
            let sobran = de.filter { !conocidas.contains($0) }
            return !sobran.isEmpty && sobran.allSatisfy { ficha in !ficha.isEmpty && ficha.allSatisfy { $0.isASCII && $0.isNumber } }
        }
        return soloSobranNumeros(fichasA, fichasB) || soloSobranNumeros(fichasB, fichasA)
    }

    /// `channelMatchScore`: 0…100 de que dos nombres sean el mismo canal.
    public static func puntuacion(_ izquierda: String?, _ derecha: String?) -> Int {
        puntuacionDeClaves(clave(izquierda), clave(derecha))
    }

    /// Lo mismo con las claves ya calculadas (`clave(_:)`): para cruzar
    /// muchos canales con muchos partidos sin normalizar cada vez.
    public static func puntuacionDeClaves(_ a: String, _ b: String) -> Int {
        guard !a.isEmpty, !b.isEmpty else { return 0 }
        if a == b { return 100 }
        let numerosA = numeros(a)
        let numerosB = numeros(b)
        // Dos canales numerados distintos nunca son el mismo: DAZN 1 no es DAZN 2.
        if !numerosA.isEmpty && !numerosB.isEmpty && numerosA != numerosB { return 0 }
        let fichasA = fichas(a)
        let fichasB = fichas(b)
        let nucleoA = fichasA.filter { !relleno.contains($0) }.joined(separator: " ")
        let nucleoB = fichasB.filter { !relleno.contains($0) }.joined(separator: " ")
        if !nucleoA.isEmpty && nucleoA == nucleoB { return 100 }
        if esFamilia(a, b, fichasA, fichasB) { return puntuacionFamilia }
        let variante = !distintivas(fichasA, fichasB).isEmpty || !distintivas(fichasB, fichasA).isEmpty
        var puntos: Int
        if a.contains(b) || b.contains(a) {
            let menor = min(fichasA.count, fichasB.count)
            puntos = menor >= 2 ? 86 - min(14, abs(a.count - b.count)) : 58
        } else {
            let conjuntoB = Set(fichasB)
            let compartidas = fichasA.filter { $0.count > 1 && conjuntoB.contains($0) }.count
            let proporcion = Double(compartidas) / Double(max(fichasA.count, fichasB.count))
            puntos = compartidas >= 2 && proporcion >= 0.6 ? Int((58 + proporcion * 24).rounded(.toNearestOrAwayFromZero)) : 0
        }
        return variante ? min(puntos, techoVariante) : puntos
    }

    /// `broadcastsMatch`: ¿anuncia la agenda este canal (por su título o su alias) para el partido?
    public static func emite(titulo: String, alias: String?, partido: FootballMatch) -> Bool {
        emite(claveTitulo: clave(titulo), claveAlias: alias.map { clave($0) }, clavesPartido: partido.channels.map { clave($0.name) })
    }

    /// Lo mismo con las claves ya calculadas.
    public static func emite(claveTitulo: String, claveAlias: String?, clavesPartido: [String]) -> Bool {
        clavesPartido.contains { canal in
            puntuacionDeClaves(claveTitulo, canal) >= puntuacionExacta
                || (claveAlias.map { !$0.isEmpty && puntuacionDeClaves($0, canal) >= puntuacionExacta } ?? false)
        }
    }
}
