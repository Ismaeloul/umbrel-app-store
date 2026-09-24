import Foundation

/* Reglas puras de la agenda de Palco (aparte de la vista para probarlas):
   el marcador tapado (anti-spoiler), el registro de goles a partir de dos
   lecturas del marcador, las secciones En directo / Próximos / Terminados,
   el partido destacado de la portada y el chip de fecha y hora. */

// MARK: - Anti-spoiler

/// El marcador del partido que se está viendo va tapado hasta que se
/// destapa; se vuelve a tapar al cambiar de canal (inventario §5).
public enum AntiSpoiler {
    /// - Parameters:
    ///   - partido: id del partido de la tarjeta.
    ///   - marcador: su marcador (solo se tapa en juego).
    ///   - viendo: id del partido que suena en este iPhone.
    ///   - destapados: los que la persona ya destapó.
    public static func tapado(partido: String, marcador: LiveScore?, viendo: String?, destapados: Set<String>) -> Bool {
        guard viendo == partido, marcador?.state == "in" else { return false }
        return !destapados.contains(partido)
    }
}

// MARK: - Goles

/// Un gol deducido de dos lecturas del marcador de ESPN (la API no da goleadores).
public struct Gol: Hashable, Sendable, Identifiable {
    public enum Lado: Sendable, Hashable { case local, visitante }

    public var lado: Lado
    /// El `clock` en el momento de detectarlo («54'»).
    public var minuto: String
    public var id: String { "\(lado)-\(minuto)-\(orden)" }
    /// Orden de llegada (para distinguir dos goles en el mismo minuto).
    public var orden: Int

    public init(lado: Lado, minuto: String, orden: Int) {
        self.lado = lado
        self.minuto = minuto
        self.orden = orden
    }
}

public enum RegistroGoles {
    /// Compara los marcadores anteriores con los nuevos y anota un gol por
    /// cada tanto que sube (con el minuto del reloj). Un marcador que baja
    /// (corrección de ESPN) borra los goles de ese partido.
    public static func anotar(
        anteriores: [String: LiveScore], nuevos: [String: LiveScore], goles: [String: [Gol]]
    ) -> [String: [Gol]] {
        var resultado = goles
        for (id, nuevo) in nuevos {
            guard let anterior = anteriores[id] else { continue }
            if nuevo.home < anterior.home || nuevo.away < anterior.away {
                resultado[id] = nil
                continue
            }
            var lista = resultado[id] ?? []
            let minuto = nuevo.clock.isEmpty ? "—" : nuevo.clock
            for _ in 0..<(nuevo.home - anterior.home) {
                lista.append(Gol(lado: .local, minuto: minuto, orden: lista.count))
            }
            for _ in 0..<(nuevo.away - anterior.away) {
                lista.append(Gol(lado: .visitante, minuto: minuto, orden: lista.count))
            }
            if !lista.isEmpty { resultado[id] = lista }
        }
        return resultado
    }
}

// MARK: - Secciones y destacado

/// Los partidos de un día repartidos por fase.
public struct PartidosPorFase: Hashable, Sendable {
    public var directo: [FootballMatch]
    public var proximos: [FootballMatch]
    public var terminados: [FootballMatch]

    public var vacio: Bool { directo.isEmpty && proximos.isEmpty && terminados.isEmpty }
}

extension ReglasAgenda {
    /// En directo / Próximos / Terminados, cada tramo por hora (el orden de `porCompeticion`).
    static func porFase(_ partidos: [FootballMatch], reloj: RelojMadrid, marcadores: [String: LiveScore] = [:])
        -> PartidosPorFase
    {
        var directo: [FootballMatch] = []
        var proximos: [FootballMatch] = []
        var terminados: [FootballMatch] = []
        for grupo in porCompeticion(partidos, reloj: reloj, marcadores: marcadores) {
            for partido in grupo.partidos {
                switch estado(partido, reloj: reloj, marcador: marcadores[partido.id])?.fase {
                case .directo: directo.append(partido)
                case .terminado: terminados.append(partido)
                default: proximos.append(partido)
                }
            }
        }
        let porHora: (FootballMatch, FootballMatch) -> Bool = { a, b in
            (minutosDeHora(a.time) ?? .max) < (minutosDeHora(b.time) ?? .max)
        }
        return PartidosPorFase(
            directo: directo.sorted(by: porHora), proximos: proximos.sorted(by: porHora),
            terminados: terminados.sorted(by: porHora))
    }

    /// El partido de la portada: el que se ve si suena algo; si no, el
    /// primero en directo de «Para ti» (o de todos, sin gustos); si no, el próximo.
    static func destacado(
        _ partidos: [FootballMatch], viendo: String?, reloj: RelojMadrid, marcadores: [String: LiveScore],
        gustos: GustosFutbol
    ) -> FootballMatch? {
        if let viendo, let sonando = partidos.first(where: { $0.id == viendo }) { return sonando }
        let paraTi = visibles(partidos, modo: .paraTi, gustos: gustos)
        let candidatos = paraTi.isEmpty ? partidos : paraTi
        let fases = porFase(candidatos, reloj: reloj, marcadores: marcadores)
        if let directo = fases.directo.first { return directo }
        if let proximo = fases.proximos.first { return proximo }
        let todas = porFase(partidos, reloj: reloj, marcadores: marcadores)
        return todas.directo.first ?? todas.proximos.first ?? todas.terminados.last
    }

    /// Los que hay que precalentar (pedir sus fuentes): en directo o a menos de 45 min.
    static func precalentables(_ partidos: [FootballMatch], reloj: RelojMadrid, marcadores: [String: LiveScore])
        -> [FootballMatch]
    {
        partidos.filter { partido in
            if marcadores[partido.id]?.state == "post" { return false }
            if marcadores[partido.id]?.state == "in" { return true }
            guard let faltan = minutosParaPartido(partido, reloj: reloj) else { return false }
            return faltan < ReglasSenal.minutosPrecalentado && faltan > -120
        }
    }
}

// MARK: - Marcador

/// Lectura del marcador de ESPN.
enum Marcador {
    /// «54'» o «45'+2'» → 54 / 45.
    static func minuto(_ marcador: LiveScore) -> Int? {
        let cifras = marcador.clock.prefix { $0.isNumber }
        return Int(cifras)
    }

    /// Progreso del partido (0…1) para la barra.
    static func progreso(_ marcador: LiveScore?, inicio: Date?, ahora: Date = .now) -> Double {
        switch marcador?.state {
        case "post": return 1
        case "in": return min(1, Double(marcador.flatMap(minuto) ?? 1) / 90)
        default:
            guard let inicio, ahora > inicio else { return 0 }
            return min(1, ahora.timeIntervalSince(inicio) / (105 * 60))
        }
    }

    /// «1–0».
    static func texto(_ marcador: LiveScore) -> String {
        "\(marcador.home)–\(marcador.away)"
    }

    /// «54'», «Descanso», «Final».
    static func reloj(_ marcador: LiveScore) -> String {
        if marcador.state == "post" { return "Final" }
        let detalle = marcador.detail.lowercased()
        if detalle.contains("descanso") || detalle.contains("halftime") || detalle == "ht" { return "Descanso" }
        return marcador.clock.isEmpty ? "En directo" : marcador.clock
    }
}

// MARK: - Chip de fecha y hora

extension FormatoAgenda {
    /// «VIE 21:00», «HOY 21:00» no: siempre el día de la semana, como la
    /// tarjeta del prototipo; «● EN DIRECTO · 13'» si está en juego; «FINAL» al acabar.
    static func chipHora(_ partido: FootballMatch, marcador: LiveScore?, enDirecto: Bool) -> String {
        if marcador?.state == "post" { return "FINAL" }
        if enDirecto {
            let minuto = marcador.flatMap(Marcador.minuto).map { " · \($0)'" } ?? ""
            return "EN DIRECTO\(minuto)"
        }
        let dia = diaSemanaCorto(partido.date)
        let hora = ReglasAgenda.minutosDeHora(partido.time) == nil ? "POR CONFIRMAR" : partido.time
        return dia.isEmpty ? hora : "\(dia) \(hora)"
    }

    /// «VIE» para `2026-09-25`.
    static func diaSemanaCorto(_ texto: String) -> String {
        guard let fecha = dia(texto) else { return "" }
        let estilo = Date.FormatStyle(locale: Locale(identifier: "es_ES"), calendar: calendario, timeZone: zona)
            .weekday(.abbreviated)
        return fecha.formatted(estilo).replacingOccurrences(of: ".", with: "").uppercased()
    }
}
