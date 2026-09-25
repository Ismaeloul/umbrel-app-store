import Foundation

/* Marcador tapado, goles y fases de la agenda (M5; a3 §8).

   Rescatado en la poda (fase 0.2, b-arquitectura §1.11) de Features/Agenda/ReglasPalco.swift (anti-spoiler,
   goles, fases, precalentables) y completado por M5 con el port de agenda/score-reveal.ts (`Destapado`). El
   destacado de la portada es `ReglasAgenda.destacado` (featuredMatch de domain.ts). */

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

// MARK: - Fases

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

// MARK: - score-reveal.ts

/// Lo que enseña la cápsula «Marcador» de un partido en la agenda.
enum EstadoMarcador: Equatable, Sendable {
    case tapado
    case destapado
}

/// Port de `agenda/score-reveal.ts` (a3 §8.1): en la agenda TODO marcador va tapado hasta que se pide; el
/// conjunto de destapados lo guarda `MarcadoresDestapados` (proceso, M1) y se vacía al cambiar lo que suena.
enum Destapado {
    /// `watchedMatchOf`: el partido que suena en este iPhone (un canal suelto no es un partido).
    static func partidoViendo(canal: CanalReproducible?, activo: Bool) -> String? {
        guard activo else { return nil }
        return canal?.partido?.id
    }

    /// Cápsula de la agenda: nil si el marcador no se pinta (`pre` o sin marcador).
    static func estado(_ marcador: LiveScore?, destapado: Bool) -> EstadoMarcador? {
        guard Marcadores.pintable(marcador) != nil else { return nil }
        return destapado ? .destapado : .tapado
    }

    /// `useScoreHidden` (biblioteca, mini, centro de partido): tapado solo el que se ve y no se ha destapado.
    static func tapadoFueraDeLaAgenda(viendo: Bool, destapado: Bool) -> Bool {
        viendo && !destapado
    }
}
