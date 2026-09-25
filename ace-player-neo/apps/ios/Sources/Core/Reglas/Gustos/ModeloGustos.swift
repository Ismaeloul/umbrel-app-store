import Foundation

// Port de apps/web/src/features/preferences/model.ts (M5; a3 §13): catálogo de chips, limpieza de listas,
// borrador, seguir desde la agenda y el cuerpo del PUT. Rescatado en la poda (fase 0.2) de
// Features/Settings/GustosView.swift y revalidado contra model.ts y model.test.ts. El borrador es un
// `GustosFutbol` (las mismas tres listas que `PreferenceDraft`).

/// Qué parte de los gustos (`PreferenceKind`): las tres secciones de la hoja, en su orden.
enum TipoGusto: String, CaseIterable, Identifiable, Sendable {
    case ligas, equipos, nacionalidades

    var id: String { rawValue }

    /// «01», «02», «03» (PreferencesSheet.tsx `COPY`).
    var numero: String {
        switch self {
        case .ligas: "01"
        case .equipos: "02"
        case .nacionalidades: "03"
        }
    }

    var titulo: String {
        switch self {
        case .ligas: "Tus ligas"
        case .equipos: "Tus equipos"
        case .nacionalidades: "Nacionalidades"
        }
    }

    /// La pista bajo el título.
    var explicacion: String {
        switch self {
        case .ligas: "Selecciona todas las que sigues."
        case .equipos: "Marca los tuyos o añade otro."
        case .nacionalidades: "Selecciones y fútbol de los países que sigues."
        }
    }

    var marcador: String {
        switch self {
        case .ligas: "Añadir otra liga…"
        case .equipos: "Añadir otro equipo…"
        case .nacionalidades: "Añadir otro país…"
        }
    }

    /// Nombre accesible del botón «Añadir».
    var etiquetaAnadir: String {
        switch self {
        case .ligas: "Añadir liga"
        case .equipos: "Añadir equipo"
        case .nacionalidades: "Añadir país"
        }
    }

    /// «Has llegado al máximo de 12 ligas.»
    var textoLleno: String {
        switch self {
        case .ligas: "Has llegado al máximo de \(maximo) ligas."
        case .equipos: "Has llegado al máximo de \(maximo) equipos."
        case .nacionalidades: "Has llegado al máximo de \(maximo) nacionalidades."
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
            ModeloGustos.banderas.map(\.0)
        }
    }

    /// Topes del servidor (`MAX_FOOTBALL_*`) y longitudes (`TEXT_LIMITS`).
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

/// Resultado de «Añadir» (`addCustomValue`).
struct ResultadoAnadir: Equatable, Sendable {
    var borrador: GustosFutbol
    /// El nombre que ha quedado marcado (el fijo si ya existía con la misma clave).
    var anadido: String?
    /// La lista estaba llena.
    var lleno: Bool
}

enum ModeloGustos {
    /// País y bandera; los que se añaden a mano llevan el globo (`NATIONALITY_OPTIONS`, `CUSTOM_FLAG`).
    static let banderas: [(String, String)] = [
        ("España", "🇪🇸"), ("Argentina", "🇦🇷"), ("Brasil", "🇧🇷"), ("Inglaterra", "🇬🇧"), ("Francia", "🇫🇷"),
        ("Italia", "🇮🇹"), ("Alemania", "🇩🇪"), ("Portugal", "🇵🇹"), ("Países Bajos", "🇳🇱"), ("Marruecos", "🇲🇦"),
        ("México", "🇲🇽"), ("Estados Unidos", "🇺🇸"), ("Uruguay", "🇺🇾"), ("Colombia", "🇨🇴"),
    ]
    static let banderaPropia = "🌍"

    static func bandera(_ nombre: String) -> String {
        banderas.first { $0.0 == nombre }?.1 ?? banderaPropia
    }

    /// Espacios colapsados y recortado.
    static func colapsar(_ texto: String) -> String {
        texto.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    /// `cleanPreferenceList`: sin vacíos ni repetidos por clave, cortado y con tope.
    static func limpiar(_ valores: [String]?, tipo: TipoGusto) -> [String] {
        var vistos = Set<String>()
        var salida: [String] = []
        for bruto in valores ?? [] {
            let valor = String(colapsar(bruto).prefix(tipo.largoMaximo))
            let clave = ParaTi.clavePreferencia(valor)
            guard !valor.isEmpty, !clave.isEmpty, !vistos.contains(clave) else { continue }
            vistos.insert(clave)
            salida.append(valor)
            if salida.count >= tipo.maximo { break }
        }
        return salida
    }

    /// `cleanCustomValue`: nil con menos de 2 caracteres.
    static func valorPropio(_ texto: String, tipo: TipoGusto) -> String? {
        let limpio = String(colapsar(texto).prefix(tipo.largoMaximo))
        return limpio.count >= 2 ? limpio : nil
    }

    /// `findSameKey`: el que ya está en la lista con la misma clave («real madrid» = «Real Madrid»).
    static func mismaClave(_ lista: [String], _ valor: String) -> String? {
        let clave = ParaTi.clavePreferencia(valor)
        return lista.first { ParaTi.clavePreferencia($0) == clave }
    }

    /// `draftFrom`.
    static func borrador(_ preferencias: Preferences?) -> GustosFutbol {
        GustosFutbol(
            leagues: limpiar(preferencias?.leagues, tipo: .ligas), teams: limpiar(preferencias?.teams, tipo: .equipos),
            nationalities: limpiar(preferencias?.nationalities, tipo: .nacionalidades))
    }

    /// `toggleValue`: marca o desmarca; con la lista llena no se añade nada.
    static func alternar(_ borrador: GustosFutbol, _ tipo: TipoGusto, _ valor: String) -> GustosFutbol {
        var copia = borrador
        var lista = copia[keyPath: tipo.clave]
        if lista.contains(valor) {
            lista.removeAll { $0 == valor }
        } else if lista.count < tipo.maximo {
            lista.append(valor)
        } else {
            return borrador
        }
        copia[keyPath: tipo.clave] = lista
        return copia
    }

    /// `addCustomValue`: si ya existe uno con la misma clave (fijo o tuyo), se marca ese.
    static func anadir(_ borrador: GustosFutbol, _ tipo: TipoGusto, _ texto: String) -> ResultadoAnadir {
        guard let limpio = valorPropio(texto, tipo: tipo) else {
            return ResultadoAnadir(borrador: borrador, anadido: nil, lleno: false)
        }
        let lista = borrador[keyPath: tipo.clave]
        let existente = mismaClave(tipo.sugerencias + lista, limpio) ?? limpio
        if lista.contains(existente) { return ResultadoAnadir(borrador: borrador, anadido: existente, lleno: false) }
        if lista.count >= tipo.maximo { return ResultadoAnadir(borrador: borrador, anadido: nil, lleno: true) }
        var copia = borrador
        copia[keyPath: tipo.clave] = lista + [existente]
        return ResultadoAnadir(borrador: copia, anadido: existente, lleno: false)
    }

    /// `chipsFor`: los fijos y, detrás, los tuyos que no están entre los fijos.
    static func chips(_ tipo: TipoGusto, _ borrador: GustosFutbol) -> [String] {
        let fijos = tipo.sugerencias
        return fijos + borrador[keyPath: tipo.clave].filter { !fijos.contains($0) }
    }

    /// `hasAny`.
    static func hayAlguno(_ gustos: GustosFutbol) -> Bool { ParaTi.tieneGustos(gustos) }

    /// `preferenceSummary` (Ajustes).
    static func resumen(_ gustos: GustosFutbol?) -> String {
        var partes: [String] = []
        let ligas = gustos?.leagues.count ?? 0
        let equipos = gustos?.teams.count ?? 0
        let nacionalidades = gustos?.nationalities.count ?? 0
        if ligas > 0 { partes.append("\(ligas) \(ligas == 1 ? "liga" : "ligas")") }
        if equipos > 0 { partes.append("\(equipos) \(equipos == 1 ? "equipo" : "equipos")") }
        if nacionalidades > 0 {
            partes.append("\(nacionalidades) \(nacionalidades == 1 ? "nacionalidad" : "nacionalidades")")
        }
        guard !partes.isEmpty else { return "Personaliza la agenda con tus ligas, equipos y nacionalidades." }
        return "Tu agenda prioriza \(lista(partes))."
    }

    /// «a», «a y b», «a, b y c» (`Intl.ListFormat` conjunción en es-ES).
    static func lista(_ partes: [String]) -> String {
        guard let ultima = partes.last else { return "" }
        if partes.count == 1 { return ultima }
        return partes.dropLast().joined(separator: ", ") + " y " + ultima
    }

    // MARK: Seguir desde la agenda

    /// `followedTeam`: con las reglas de «Para ti» (alias, sin FC/CF, nunca «incluye»).
    static func equipoSeguido(_ preferencias: Preferences?, _ equipo: String) -> String? {
        (preferencias?.teams ?? []).first { ParaTi.equipoCoincide($0, equipo) }
    }

    /// `followedLeague`: misma clave con alias que «Para ti».
    static func ligaSeguida(_ preferencias: Preferences?, _ competicion: String) -> String? {
        (preferencias?.leagues ?? []).first { ParaTi.ligaCoincide($0, competicion) }
    }

    /// `toggleFollow`: el borrador nuevo, o nil si la lista ya está llena.
    static func alternarSeguir(_ preferencias: Preferences?, _ tipo: TipoGusto, _ valor: String) -> GustosFutbol? {
        var copia = borrador(preferencias)
        let existente = tipo == .equipos ? equipoSeguido(preferencias, valor) : ligaSeguida(preferencias, valor)
        if let existente {
            copia[keyPath: tipo.clave].removeAll { $0 == existente }
            return copia
        }
        if copia[keyPath: tipo.clave].count >= tipo.maximo { return nil }
        copia[keyPath: tipo.clave].append(String(colapsar(valor).prefix(tipo.largoMaximo)))
        return copia
    }

    /// `preferencesBody`: el PUT sustituye entero (onboardingComplete siempre true, país o «Spain»).
    static func cuerpo(_ actual: Preferences?, _ borrador: GustosFutbol) -> PreferencesInput {
        let pais = actual?.country ?? ""
        return PreferencesInput(
            onboardingComplete: true, country: pais.isEmpty ? "Spain" : pais, leagues: borrador.leagues,
            teams: borrador.teams, nationalities: borrador.nationalities)
    }
}

/// Compatibilidad con los nombres rescatados en la poda (los usaba la interfaz vieja; M7 puede leerlos).
enum GustosEditables {
    static var banderas: [(String, String)] { ModeloGustos.banderas }
    static func bandera(_ nombre: String) -> String { ModeloGustos.bandera(nombre) }
    static func colapsar(_ texto: String) -> String { ModeloGustos.colapsar(texto) }
    static func limpiar(_ valores: [String], tipo: TipoGusto) -> [String] { ModeloGustos.limpiar(valores, tipo: tipo) }
    static func desde(_ preferencias: Preferences?) -> GustosFutbol { ModeloGustos.borrador(preferencias) }
    static func mismo(_ lista: [String], _ valor: String) -> String? { ModeloGustos.mismaClave(lista, valor) }
    static func alternar(_ gustos: GustosFutbol, _ tipo: TipoGusto, _ valor: String) -> GustosFutbol {
        ModeloGustos.alternar(gustos, tipo, valor)
    }
    static func anadir(_ gustos: GustosFutbol, _ tipo: TipoGusto, _ texto: String) -> (GustosFutbol, String?) {
        let resultado = ModeloGustos.anadir(gustos, tipo, texto)
        return (resultado.borrador, resultado.anadido)
    }
    static func opciones(_ gustos: GustosFutbol, _ tipo: TipoGusto) -> [String] { ModeloGustos.chips(tipo, gustos) }
}
