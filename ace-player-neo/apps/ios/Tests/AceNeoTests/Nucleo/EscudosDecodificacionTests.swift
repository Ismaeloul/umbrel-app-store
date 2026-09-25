import Foundation
import XCTest

@testable import AceNeo

/// Escudos en el contrato (movido de PalcoTests.swift en la poda, fase 0.2).
final class EscudosDecodificacionTests: XCTestCase {
    private let json = #"""
        {"id":"x","date":"2026-09-25","time":"21:00","start":null,"title":"Real Madrid - Getafe","home":"Real Madrid","away":"Getafe","competition":"Copa del Rey","country":"Spain","channels":[],"homeTeam":{"id":"133738","name":"Real Madrid","short":"RMA","crest":"/api/v1/football/teams/133738/crest?v=3f2a","colors":{"primary":"#ffffff","secondary":"#febe10"}},"awayTeam":{"id":"k-getafe","name":"Getafe","short":null,"crest":null,"colors":null},"competitionBadge":{"id":"4335","name":"Spanish La Liga","logo":"/api/v1/football/competitions/4335/logo?v=9b8c"}}
        """#

    func testDecodificaEscudosYColores() throws {
        let partido = try JSONDecoder().decode(FootballMatch.self, from: Data(json.utf8))
        XCTAssertEqual(partido.homeTeam?.short, "RMA")
        XCTAssertEqual(partido.homeTeam?.crest, "/api/v1/football/teams/133738/crest?v=3f2a")
        XCTAssertEqual(partido.homeTeam?.colors?.primary, "#ffffff")
        XCTAssertEqual(partido.homeTeam?.colors?.secondary, "#febe10")
        XCTAssertEqual(partido.awayTeam?.id, "k-getafe")
        XCTAssertNil(partido.awayTeam?.short)
        XCTAssertNil(partido.awayTeam?.crest)
        XCTAssertNil(partido.awayTeam?.colors)
        XCTAssertEqual(partido.competitionBadge?.logo, "/api/v1/football/competitions/4335/logo?v=9b8c")
        XCTAssertNil(try ComparadorJSON.idaYVuelta(FootballMatch.self, Data(json.utf8)), "Ida y vuelta sin perder nada")
        // El monograma (`EquipoEscudo`, Design/Escudos.swift) se fue con la interfaz vieja en la poda:
        // lo sustituye `teamInitials` de Core/Reglas/Color/Equipos.swift (M2), probado con vectores.
    }

    func testSinEscudosSigueDecodificando() throws {
        let antiguo = #"{"id":"x","date":"2026-09-25","time":"21:00","start":null,"title":"A - B","home":"A","away":"B","competition":"LaLiga","country":"","channels":[]}"#
        let partido = try JSONDecoder().decode(FootballMatch.self, from: Data(antiguo.utf8))
        XCTAssertNil(partido.homeTeam)
        XCTAssertNil(partido.competitionBadge)
        XCTAssertNil(try ComparadorJSON.idaYVuelta(FootballMatch.self, Data(antiguo.utf8)))
    }

    func testLaAgendaDeEjemploLlevaEscudos() throws {
        let agenda = try JSONDecoder().decode(FootballSchedule.self, from: Fixtures.datos("v1/footballSchedule.json"))
        let conEscudo = agenda.days.flatMap(\.matches).first { $0.homeTeam != nil }
        XCTAssertNotNil(conEscudo, "El ejemplo del contrato trae escudos")
        XCTAssertTrue(conEscudo?.homeTeam?.crest?.hasPrefix("/api/v1/football/teams/") ?? false)
    }
}
