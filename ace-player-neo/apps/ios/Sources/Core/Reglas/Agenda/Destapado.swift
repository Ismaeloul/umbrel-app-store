import Foundation

/* Reglas puras de la agenda de Palco (aparte de la vista para probarlas):
   el marcador tapado (anti-spoiler), el registro de goles a partir de dos
   lecturas del marcador, las secciones En directo / Próximos / Terminados y
   el partido destacado de la portada.

   Rescatado en la poda (fase 0.2, b-arquitectura §1.11) de
   Features/Agenda/ReglasPalco.swift sin cambiar el comportamiento. Se fue con
   la interfaz vieja el chip de fecha y hora (su prueba, ChipHoraTests, también).
   M5 lo convierte en el port de score-reveal.ts. */

// MARK: - Anti-spoiler

/// El marcador del partido que se está viendo va tapado hasta que se
/// destapa; se vuelve a tapar al cambiar de canal (inventario §5).
enum AntiSpoiler {
    /// - Parameters:
    ///   - partido: id del partido de la tarjeta.
    ///   - marcador: su marcador (solo se tapa en juego).
    ///   - viendo: id del partido que suena en este iPhone.
    ///   - destapados: los que la persona ya destapó.
    static func tapado(partido: String, marcador: LiveScore?, viendo: String?, destapados: Set<String>) -> Bool {
        guard viendo == partido, marcador?.state == "in" else { return false }
        return !destapados.contains(partido)
    }
}

// MARK: - Goles

/// Un gol deducido de dos lecturas del marcador de ESPN (la API no da goleadores).
struct Gol: Hashable, Sendable, Identifiable {
    enum Lado: Sendable, Hashable { case local, visitante }

    var lado: Lado
    /// El `clock` en el momento de detectarlo («54'»).
    var minuto: String
    var id: String { "\(lado)-\(minuto)-\(orden)" }
    /// Orden de llegada (para distinguir dos goles en el mismo minuto).
    var orden: Int

    init(lado: Lado, minuto: String, orden: Int) {
        self.lado = lado
        self.minuto = minuto
        self.orden = orden
    }
}

enum RegistroGoles {
    /// Compara los marcadores anteriores con los nuevos y anota un gol por
    /// cada tanto que sube (con el minuto del reloj). Un marcador que baja
    /// (corrección de ESPN) borra los goles de ese partido.
    static func anotar(
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
struct PartidosPorFase: Hashable, Sendable {
    var directo: [FootballMatch]
    var proximos: [FootballMatch]
    var terminados: [FootballMatch]

    var vacio: Bool { directo.isEmpty && proximos.isEmpty && terminados.isEmpty }
}

extension ReglasAgenda {
    /// Cuánto antes empieza a comprobar el servidor las fuentes (era `ReglasSenal.minutosPrecalentado`).
    static let minutosPrecalentado = 45

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
            return faltan < minutosPrecalentado && faltan > -120
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
    static func progreso(_ marcador: LiveScore?, inicio: Date?, ahora: Date) -> Double {
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
