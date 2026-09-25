import Foundation

// Rescatado en la poda (fase 0.2, b-arquitectura §1.11) de Features/Settings/GustosView.swift, sin
// cambiar el comportamiento. M5 lo revalida con los vectores de preferences/model.ts.

/// Qué parte de los gustos (las tres listas de la web).
enum TipoGusto: String, CaseIterable, Identifiable {
    case ligas, equipos, nacionalidades

    var id: String { rawValue }

    var titulo: String {
        switch self {
        case .ligas: "Tus ligas"
        case .equipos: "Tus equipos"
        case .nacionalidades: "Nacionalidades"
        }
    }

    var explicacion: String {
        switch self {
        case .ligas: "Selecciona todas las que sigues."
        case .equipos: "Marca los tuyos o añade otro."
        case .nacionalidades: "Sus selecciones y sus ligas."
        }
    }

    var marcador: String {
        switch self {
        case .ligas: "Añadir otra liga…"
        case .equipos: "Añadir otro equipo…"
        case .nacionalidades: "Añadir otro país…"
        }
    }

    /// Chips fijos de la web (preferences/model.ts), en su orden.
    var sugerencias: [String] {
        switch self {
        case .ligas:
            [
                "LaLiga", "LaLiga Hypermotion", "Champions League", "Premier League", "Europa League", "Copa del Rey",
                "Serie A", "Bundesliga", "Ligue 1",
            ]
        case .equipos:
            [
                "Real Madrid", "Barcelona", "Atlético de Madrid", "Athletic Club", "Real Betis", "Real Sociedad",
                "Villarreal", "Sevilla", "Manchester City", "Arsenal", "Liverpool", "Inter",
            ]
        case .nacionalidades:
            GustosEditables.banderas.map(\.0)
        }
    }

    /// Topes del servidor (`MAX_FOOTBALL_*` y `TEXT_LIMITS`).
    var maximo: Int { self == .ligas ? 12 : 24 }
    var largoMaximo: Int { self == .equipos ? 80 : 60 }

    var clave: WritableKeyPath<GustosFutbol, [String]> {
        switch self {
        case .ligas: \.leagues
        case .equipos: \.teams
        case .nacionalidades: \.nationalities
        }
    }
}

/// Las reglas del borrador de gustos (preferences/model.ts de la web).
enum GustosEditables {
    /// País y bandera; los que se añaden a mano llevan el globo.
    static let banderas: [(String, String)] = [
        ("España", "🇪🇸"), ("Argentina", "🇦🇷"), ("Brasil", "🇧🇷"), ("Inglaterra", "🇬🇧"), ("Francia", "🇫🇷"),
        ("Italia", "🇮🇹"), ("Alemania", "🇩🇪"), ("Portugal", "🇵🇹"), ("Países Bajos", "🇳🇱"), ("Marruecos", "🇲🇦"),
        ("México", "🇲🇽"), ("Estados Unidos", "🇺🇸"), ("Uruguay", "🇺🇾"), ("Colombia", "🇨🇴"),
    ]

    static func bandera(_ nombre: String) -> String {
        banderas.first { $0.0 == nombre }?.1 ?? "🌍"
    }

    /// Espacios colapsados y recortado.
    static func colapsar(_ texto: String) -> String {
        texto.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    /// `cleanPreferenceList`: sin vacíos ni repetidos por clave, cortado y con tope.
    static func limpiar(_ valores: [String], tipo: TipoGusto) -> [String] {
        var vistos = Set<String>()
        var salida: [String] = []
        for bruto in valores {
            let valor = String(colapsar(bruto).prefix(tipo.largoMaximo))
            let clave = ParaTi.clavePreferencia(valor)
            guard !valor.isEmpty, !clave.isEmpty, !vistos.contains(clave) else { continue }
            vistos.insert(clave)
            salida.append(valor)
            if salida.count >= tipo.maximo { break }
        }
        return salida
    }

    static func desde(_ preferencias: Preferences?) -> GustosFutbol {
        let gustos = GustosFutbol(preferencias)
        return GustosFutbol(
            leagues: limpiar(gustos.leagues, tipo: .ligas), teams: limpiar(gustos.teams, tipo: .equipos),
            nationalities: limpiar(gustos.nationalities, tipo: .nacionalidades))
    }

    /// El que ya está en la lista con la misma clave («real madrid» = «Real Madrid»).
    static func mismo(_ lista: [String], _ valor: String) -> String? {
        let clave = ParaTi.clavePreferencia(valor)
        return lista.first { ParaTi.clavePreferencia($0) == clave }
    }

    /// Marca o desmarca. Con la lista llena no se añade nada.
    static func alternar(_ gustos: GustosFutbol, _ tipo: TipoGusto, _ valor: String) -> GustosFutbol {
        var copia = gustos
        var lista = copia[keyPath: tipo.clave]
        if let presente = mismo(lista, valor) {
            lista.removeAll { $0 == presente }
        } else if lista.count < tipo.maximo {
            lista.append(valor)
        }
        copia[keyPath: tipo.clave] = lista
        return copia
    }

    /// Añade uno escrito a mano (2 caracteres como mínimo). Si ya hay uno con
    /// la misma clave (un chip fijo o uno tuyo), se marca ese.
    static func anadir(_ gustos: GustosFutbol, _ tipo: TipoGusto, _ texto: String) -> (GustosFutbol, String?) {
        let limpio = String(colapsar(texto).prefix(tipo.largoMaximo))
        guard limpio.count >= 2 else { return (gustos, nil) }
        let lista = gustos[keyPath: tipo.clave]
        if let presente = mismo(lista, limpio) { return (gustos, presente) }
        guard lista.count < tipo.maximo else { return (gustos, nil) }
        let nombre = mismo(tipo.sugerencias, limpio) ?? limpio
        var copia = gustos
        copia[keyPath: tipo.clave] = lista + [nombre]
        return (copia, nombre)
    }

    /// Los chips que se enseñan: los fijos y, detrás, los tuyos que no lo son.
    static func opciones(_ gustos: GustosFutbol, _ tipo: TipoGusto) -> [String] {
        let propios = gustos[keyPath: tipo.clave].filter { mismo(tipo.sugerencias, $0) == nil }
        return tipo.sugerencias + propios
    }
}
