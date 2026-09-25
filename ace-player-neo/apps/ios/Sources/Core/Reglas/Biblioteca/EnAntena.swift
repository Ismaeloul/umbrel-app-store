import Foundation

// Port de apps/web/src/features/library/on-air.ts (M5; a5 §3.3, §6): qué da cada canal de tu biblioteca hoy.
// Cruce `channelMatchScore ≥ 92` (la familia NO basta), hora de Madrid, en juego desde el inicio hasta 2 h
// después; el marcador de ESPN manda si llega. Rescatado en la poda (fase 0.2) y revalidado con on-air.test.ts.

/// `OnAirStatus`.
enum FaseAntena: Equatable, Sendable { case directo, proximo, terminado }

/// Un partido que da un canal (`OnAirMatch`).
struct PartidoAntena: Hashable, Sendable {
    var partido: FootballMatch
    var fase: FaseAntena
    /// Minutos hasta el inicio (negativo si ya empezó); nil si «Por confirmar».
    var faltan: Int?
    var marcador: LiveScore?
}

/// `ChannelOnAir`: el que va en juego o, si no, el siguiente de hoy.
struct CanalEnAntena: Hashable, Sendable {
    var directo: PartidoAntena?
    var siguiente: PartidoAntena?
    var despues: [PartidoAntena]

    static let vacio = CanalEnAntena(directo: nil, siguiente: nil, despues: [])
}

/// Los partidos de hoy con las claves de sus canales ya calculadas: cruzar cada canal de la biblioteca con la
/// agenda sale barato (`useOnAir`).
struct IndiceAntena: Sendable {
    struct Entrada: Sendable {
        let partido: FootballMatch
        let claves: [String]
        let faltan: Int?
    }

    static let vacio = IndiceAntena(entradas: [], hayAgenda: false)

    /// Duración que se da a un partido sin marcador (`MATCH_WINDOW_MIN`: 2 h).
    static let ventanaPartido = 120
    /// El reloj de «Emitiendo ahora» avanza cada 30 s (`useNow(30_000)`).
    static let tic: Double = 30

    let entradas: [Entrada]
    /// Hay agenda cargada (si no, las filas enseñan solo su subtítulo).
    let hayAgenda: Bool

    /// `todaysMatches`: los del día de Madrid y los de ayer que sigan en juego.
    init(agenda: FootballSchedule?, reloj: RelojMadrid) {
        var entradas: [Entrada] = []
        for dia in agenda?.days ?? [] {
            for partido in dia.matches {
                let faltan = ReglasAgenda.minutosParaPartido(partido, reloj: reloj)
                let enJuego = faltan.map { $0 <= 0 && $0 > -Self.ventanaPartido } ?? false
                guard dia.date == reloj.fecha || enJuego else { continue }
                entradas.append(Entrada(partido: partido, claves: partido.channels.map { Canales.clave($0.name) }, faltan: faltan))
            }
        }
        self.entradas = entradas
        hayAgenda = agenda != nil
    }

    private init(entradas: [Entrada], hayAgenda: Bool) {
        self.entradas = entradas
        self.hayAgenda = hayAgenda
    }

    /// Los partidos (para `needsScores`).
    var partidos: [FootballMatch] { entradas.map(\.partido) }

    /// `matchStatus` de on-air.ts.
    static func fase(faltan: Int?, marcador: LiveScore?) -> FaseAntena {
        if marcador?.state == "in" { return .directo }
        if marcador?.state == "post" { return .terminado }
        guard let faltan else { return .proximo }
        if faltan <= 0 { return faltan > -ventanaPartido ? .directo : .terminado }
        return .proximo
    }

    /// `onAirFor`: el que está en juego o, si no, el siguiente de hoy (y los de después).
    func para(titulo: String, alias: String?, marcadores: [String: LiveScore]) -> CanalEnAntena {
        guard !entradas.isEmpty else { return .vacio }
        let claveTitulo = Canales.clave(titulo)
        let claveAlias = alias.map { Canales.clave($0) }
        var directo: PartidoAntena?
        var proximos: [PartidoAntena] = []
        for entrada in entradas
        where Canales.emite(claveTitulo: claveTitulo, claveAlias: claveAlias, clavesPartido: entrada.claves) {
            let marcador = marcadores[entrada.partido.id]
            let fase = Self.fase(faltan: entrada.faltan, marcador: marcador)
            let item = PartidoAntena(partido: entrada.partido, fase: fase, faltan: entrada.faltan, marcador: marcador)
            if fase == .directo && directo == nil {
                directo = item
            } else if fase == .proximo {
                proximos.append(item)
            }
        }
        let ordenados = proximos.enumerated().sorted { a, b in
            let fa = a.element.faltan ?? 1_000_000_000
            let fb = b.element.faltan ?? 1_000_000_000
            return fa != fb ? fa < fb : a.offset < b.offset
        }.map(\.element)
        if let directo { return CanalEnAntena(directo: directo, siguiente: nil, despues: ordenados) }
        return CanalEnAntena(directo: nil, siguiente: ordenados.first, despues: Array(ordenados.dropFirst()))
    }

    /// `needsScores`: algo entre 15 min antes y 3,5 h después (en minutos de Madrid).
    func hacenFaltaMarcadores() -> Bool {
        entradas.contains { entrada in
            guard let faltan = entrada.faltan else { return false }
            return faltan <= 15 && faltan >= -210
        }
    }

    /// `liveMinute` de on-air.ts: el reloj de ESPN («72'», «45+2'») o nil.
    static func minuto(_ marcador: LiveScore?) -> String? {
        guard let reloj = marcador?.clock.trimmingCharacters(in: .whitespaces), !reloj.isEmpty else { return nil }
        let normal = reloj.replacingOccurrences(of: "\u{2019}", with: "'").replacingOccurrences(of: "\u{2032}", with: "'")
        let base = String(normal.prefix { $0.isASCII && $0.isNumber })
        guard (1...3).contains(base.count) else { return nil }
        let resto = normal.dropFirst(base.count)  // `/^(\d{1,3}(?:\+\d{1,2})?)/`: el «+» pegado a las cifras
        if resto.first == "+" {
            let extra = String(resto.dropFirst().prefix { $0.isASCII && $0.isNumber })
            if (1...2).contains(extra.count) { return "\(base)+\(extra)'" }
        }
        return "\(base)'"
    }

    /// `isHalftime`: «ht», «halftime», «half time» o «descanso» en el detalle o el reloj.
    static func descanso(_ marcador: LiveScore?) -> Bool {
        let texto = "\(marcador?.detail ?? "") \(marcador?.clock ?? "")".lowercased()
        let palabras = texto.split(whereSeparator: { !($0.isLetter || $0.isNumber) }).map(String.init)
        if palabras.contains("ht") || palabras.contains("halftime") || palabras.contains("descanso") { return true }
        return texto.contains("half time")
    }
}

/// «Emitiendo ahora»: tus canales (favoritos y luego recientes) en juego, sin repetir hash (`onAirEntries`).
struct EntradaEmitiendo: Hashable, Sendable, Identifiable {
    var item: Item
    var directo: PartidoAntena
    var id: String { item.id }
}

enum ReglasEmitiendo {
    static func entradas(_ items: [Item], indice: IndiceAntena, marcadores: [String: LiveScore]) -> [EntradaEmitiendo] {
        guard indice.hayAgenda else { return [] }
        var vistos = Set<String>()
        var salida: [EntradaEmitiendo] = []
        for item in items where vistos.insert(item.id).inserted {
            if let directo = indice.para(titulo: item.title, alias: item.alias, marcadores: marcadores).directo {
                salida.append(EntradaEmitiendo(item: item, directo: directo))
            }
        }
        return salida
    }
}
