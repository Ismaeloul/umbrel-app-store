import XCTest

@testable import AceNeo

/// El port de Swift de las reglas de @ace/shared tiene que dar EXACTAMENTE lo
/// mismo que las funciones de TypeScript. Los vectores los genera
/// `scripts/generar-vectores.mjs` ejecutando for-you.ts y channels.ts de
/// verdad; la CI comprueba que el JSON está al día (`--check`).
final class VectoresDominioTests: XCTestCase {
    private struct Vectores: Decodable {
        struct Clave: Decodable {
            let texto: String
            let preferencia: String
            let competicion: String
            let equipo: String
            let canal: String
        }

        struct Liga: Decodable {
            let preferencia: String
            let competicion: String
            let coincide: Bool
        }

        struct CasoParaTi: Decodable {
            let partido: PartidoParaTi
            let gustos: GustosFutbol
            let hypermotion: Bool
            let paraTi: Bool
            let destacado: Bool
        }

        struct Par: Decodable {
            let a: String
            let b: String
            let puntuacion: Int
        }

        let claves: [Clave]
        let ligas: [Liga]
        let casosParaTi: [CasoParaTi]
        let puntuaciones: [Par]
    }

    private func vectores() throws -> Vectores {
        let url = try XCTUnwrap(
            Bundle(for: MockURLProtocol.self).url(forResource: "vectores-dominio", withExtension: "json"),
            "vectores-dominio.json no está en el bundle de los tests")
        return try JSONDecoder().decode(Vectores.self, from: Data(contentsOf: url))
    }

    func testHayVectoresDeTodo() throws {
        let v = try vectores()
        XCTAssertGreaterThan(v.claves.count, 30)
        XCTAssertGreaterThan(v.ligas.count, 100)
        XCTAssertGreaterThan(v.casosParaTi.count, 200)
        XCTAssertGreaterThan(v.puntuaciones.count, 30)
        // Hay de los dos resultados (si no, los vectores no prueban nada).
        XCTAssertTrue(v.casosParaTi.contains { $0.paraTi } && v.casosParaTi.contains { !$0.paraTi })
        XCTAssertTrue(v.casosParaTi.contains { $0.destacado })
    }

    func testClavesComoLaWeb() throws {
        for caso in try vectores().claves {
            XCTAssertEqual(ParaTi.clavePreferencia(caso.texto), caso.preferencia, "normalizePreferenceKey(«\(caso.texto)»)")
            XCTAssertEqual(ParaTi.claveCompeticion(caso.texto), caso.competicion, "competitionKey(«\(caso.texto)»)")
            XCTAssertEqual(ParaTi.claveEquipo(caso.texto), caso.equipo, "footballTeamKey(«\(caso.texto)»)")
            XCTAssertEqual(Canales.clave(caso.texto), caso.canal, "normalizeChannelKey(«\(caso.texto)»)")
        }
    }

    func testLigasComoLaWeb() throws {
        for caso in try vectores().ligas {
            XCTAssertEqual(
                ParaTi.ligaCoincide(caso.preferencia, caso.competicion), caso.coincide,
                "leagueMatches(«\(caso.preferencia)», «\(caso.competicion)»)")
        }
    }

    func testParaTiComoLaWeb() throws {
        for caso in try vectores().casosParaTi {
            let donde = "«\(caso.partido.title)» (\(caso.partido.competition)) con \(caso.gustos)"
            XCTAssertEqual(ParaTi.esHypermotion(caso.partido), caso.hypermotion, "Hypermotion: \(donde)")
            XCTAssertEqual(ParaTi.enParaTi(caso.partido, caso.gustos), caso.paraTi, "Para ti: \(donde)")
            XCTAssertEqual(ParaTi.tieneEquipoFavorito(caso.partido, caso.gustos), caso.destacado, "Destacado: \(donde)")
        }
    }

    func testCanalesComoLaWeb() throws {
        for par in try vectores().puntuaciones {
            XCTAssertEqual(Canales.puntuacion(par.a, par.b), par.puntuacion, "channelMatchScore(«\(par.a)», «\(par.b)»)")
        }
    }

    /// Lo que Isma veía mal: con sus gustos, las reservas argentinas no salen en «Para ti».
    func testLasReservasArgentinasNoSonParaTi() {
        let gustos = GustosFutbol(leagues: ["LaLiga", "Champions League"], teams: ["Real Madrid"], nationalities: ["España"])
        let reservas = PartidoParaTi(
            competition: "Torneo Proyección", title: "Central Córdoba Reserva - Atlético Tucumán Reserva",
            home: "Central Córdoba Reserva", away: "Atlético Tucumán Reserva", channels: ["LPF Play"])
        XCTAssertFalse(ParaTi.enParaTi(reservas, gustos))
        let madrid = PartidoParaTi(
            competition: "Copa del Rey", title: "Real Madrid - Getafe", home: "Real Madrid", away: "Getafe")
        XCTAssertTrue(ParaTi.enParaTi(madrid, gustos))
        XCTAssertTrue(ParaTi.tieneEquipoFavorito(madrid, gustos))
        XCTAssertTrue(ParaTi.enParaTi(reservas, .vacios), "Sin gustos sale todo")
    }
}
