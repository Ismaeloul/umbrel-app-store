import Foundation
import XCTest

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* Marcador tapado, goles deducidos del marcador y secciones y destacado de la agenda (Core/Reglas/Agenda/
   Destapado.swift). Movido de PalcoTests.swift en la poda (fase 0.2). */

private func partido(
    _ id: String, _ hora: String, _ competicion: String, local: String = "Local", visitante: String = "Visitante",
    fecha: String = "2026-09-25", canales: [String] = []
) -> FootballMatch {
    FootballMatch(
        id: id, date: fecha, time: hora, start: nil, title: "\(local) - \(visitante)", home: local, away: visitante,
        competition: competicion, country: "",
        channels: canales.enumerated().map { FootballChannelRef(id: "c\($0.offset)", name: $0.element) })
}

private func marcador(_ home: Int, _ away: Int, estado: String = "in", reloj: String = "54'") -> LiveScore {
    LiveScore(home: home, away: away, state: estado, clock: reloj, detail: "", confidence: 1)
}

// MARK: - Marcador tapado y goles

final class AntiSpoilerTests: XCTestCase {
    func testSoloSeTapaElQueSeVeYEnJuego() {
        let enJuego = marcador(1, 0)
        XCTAssertTrue(AntiSpoiler.tapado(partido: "a", marcador: enJuego, viendo: "a", destapados: []))
        XCTAssertFalse(AntiSpoiler.tapado(partido: "a", marcador: enJuego, viendo: "b", destapados: []), "Otro partido: se ve")
        XCTAssertFalse(AntiSpoiler.tapado(partido: "a", marcador: enJuego, viendo: nil, destapados: []), "Sin nada sonando: se ve")
        XCTAssertFalse(AntiSpoiler.tapado(partido: "a", marcador: marcador(2, 1, estado: "post"), viendo: "a", destapados: []), "Terminado: se ve")
    }

    func testDestaparYVolverATapar() {
        var destapados: Set<String> = []
        XCTAssertTrue(AntiSpoiler.tapado(partido: "a", marcador: marcador(1, 0), viendo: "a", destapados: destapados))
        destapados.insert("a")
        XCTAssertFalse(AntiSpoiler.tapado(partido: "a", marcador: marcador(1, 0), viendo: "a", destapados: destapados))
        // Al cambiar de canal se vacía el conjunto: se vuelve a tapar.
        destapados = []
        XCTAssertTrue(AntiSpoiler.tapado(partido: "a", marcador: marcador(1, 0), viendo: "a", destapados: destapados))
    }
}

final class RegistroGolesTests: XCTestCase {
    func testAnotaLosGolesQueSuben() {
        let antes = ["a": marcador(0, 0, reloj: "10'")]
        let despues = ["a": marcador(1, 0, reloj: "54'"), "b": marcador(1, 1)]
        let goles = RegistroGoles.anotar(anteriores: antes, nuevos: despues, goles: [:])
        XCTAssertEqual(goles["a"]?.count, 1)
        XCTAssertEqual(goles["a"]?.first?.lado, .local)
        XCTAssertEqual(goles["a"]?.first?.minuto, "54'")
        XCTAssertNil(goles["b"], "Sin lectura anterior no se inventa nada")

        let dosMas = RegistroGoles.anotar(anteriores: despues, nuevos: ["a": marcador(1, 2, reloj: "70'")], goles: goles)
        XCTAssertEqual(dosMas["a"]?.count, 3)
        XCTAssertEqual(dosMas["a"]?.filter { $0.lado == .visitante }.count, 2)
        XCTAssertEqual(Set(dosMas["a"]?.map(\.id) ?? []).count, 3, "Ids distintos aunque sea el mismo minuto")
    }

    func testUnaCorreccionHaciaAbajoBorraLosGoles() {
        let goles = ["a": [Gol(lado: .local, minuto: "54'", orden: 0)]]
        let corregido = RegistroGoles.anotar(anteriores: ["a": marcador(1, 0)], nuevos: ["a": marcador(0, 0)], goles: goles)
        XCTAssertNil(corregido["a"])
    }
}

// MARK: - Agenda

final class SeccionesAgendaTests: XCTestCase {
    /// 25-sep-2026 a las 20:00 en Madrid.
    private let reloj = RelojMadrid(fecha: "2026-09-25", minutos: 20 * 60)

    private var partidos: [FootballMatch] {
        [
            partido("terminado", "16:00", "LaLiga"),
            partido("directo", "19:30", "Premier League", local: "Arsenal", visitante: "Chelsea"),
            partido("proximo2", "22:00", "LaLiga", local: "Villarreal", visitante: "Real Sociedad"),
            partido("proximo1", "21:30", "Copa del Rey", local: "Real Madrid", visitante: "Getafe"),
        ]
    }

    func testEnDirectoProximosYTerminadosPorHora() {
        let fases = ReglasAgenda.porFase(partidos, reloj: reloj)
        XCTAssertEqual(fases.directo.map(\.id), ["directo"])
        XCTAssertEqual(fases.proximos.map(\.id), ["proximo1", "proximo2"])
        XCTAssertEqual(fases.terminados.map(\.id), ["terminado"])
        XCTAssertFalse(fases.vacio)
        XCTAssertTrue(ReglasAgenda.porFase([], reloj: reloj).vacio)
    }

    /// `featuredMatch` de la web: tu equipo en directo → cualquiera en directo → el próximo → el primero.
    func testDestacadoDeLaPortada() {
        let gustos = GustosFutbol(leagues: ["LaLiga"], teams: ["Real Madrid"])
        // En directo solo va la Premier (no es tuya): gana igual, porque va en directo.
        XCTAssertEqual(ReglasAgenda.destacado(partidos, reloj: reloj, marcadores: [:], gustos: gustos)?.id, "directo")
        // Tu equipo en directo por ESPN gana al otro directo.
        let enJuego = ["proximo1": marcador(0, 0)]
        XCTAssertEqual(ReglasAgenda.destacado(partidos, reloj: reloj, marcadores: enJuego, gustos: gustos)?.id, "proximo1")
        // Sin directos: el próximo por hora de inicio.
        let sinDirecto = partidos.filter { $0.id != "directo" }
        XCTAssertEqual(ReglasAgenda.destacado(sinDirecto, reloj: reloj, marcadores: [:], gustos: .vacios)?.id, "proximo1")
        // Solo terminados: el primero de la lista.
        XCTAssertEqual(ReglasAgenda.destacado([partidos[0]], reloj: reloj, marcadores: [:], gustos: .vacios)?.id, "terminado")
        XCTAssertNil(ReglasAgenda.destacado([], reloj: reloj, marcadores: [:], gustos: .vacios))
    }

    func testPrecalentables() {
        // En directo (19:30) y a menos de 45 min (20:30); no los de más tarde ni el terminado.
        let lista = partidos + [partido("pronto", "20:30", "LaLiga")]
        XCTAssertEqual(Set(ReglasAgenda.precalentables(lista, reloj: reloj, marcadores: [:]).map(\.id)), ["directo", "pronto"])
        let terminadoPorESPN = ["directo": marcador(2, 1, estado: "post")]
        XCTAssertEqual(ReglasAgenda.precalentables(lista, reloj: reloj, marcadores: terminadoPorESPN).map(\.id), ["pronto"])
    }
}
