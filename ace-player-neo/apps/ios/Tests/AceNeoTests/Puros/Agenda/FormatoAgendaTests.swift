import Foundation
import XCTest

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

final class FormatoAgendaTests: XCTestCase {
    /// 23-sep-2026 a las 10:00 en Madrid.
    private let ahora = Date(timeIntervalSince1970: 1_790_150_400)

    func testHoyMananaYAyer() {
        XCTAssertEqual(FormatoAgenda.etiqueta(dia: "2026-09-23", ahora: ahora), "Hoy")
        XCTAssertEqual(FormatoAgenda.etiqueta(dia: "2026-09-24", ahora: ahora), "Mañana")
        XCTAssertEqual(FormatoAgenda.etiqueta(dia: "2026-09-22", ahora: ahora), "Ayer")
    }

    func testOtroDiaLlevaElDiaDeLaSemana() {
        let texto = FormatoAgenda.etiqueta(dia: "2026-09-26", ahora: ahora)
        XCTAssertTrue(texto.lowercased().contains("sábado"), texto)
        XCTAssertTrue(texto.contains("26"), texto)
        XCTAssertEqual(FormatoAgenda.etiqueta(dia: "no es fecha", ahora: ahora), "no es fecha")
    }

    func testEquiposYDetalle() throws {
        let agenda = try JSONDecoder().decode(FootballSchedule.self, from: Fixtures.datos("v1/footballSchedule.json"))
        let partido = try XCTUnwrap(agenda.days.first?.matches.first)
        XCTAssertEqual(FormatoAgenda.equipos(partido), "Equipo Local – Equipo Visitante")
        XCTAssertEqual(FormatoAgenda.detalle(partido), "LaLiga · M+ LaLiga")
        var sinVisitante = partido
        sinVisitante.away = ""
        XCTAssertEqual(FormatoAgenda.equipos(sinVisitante), partido.title)
    }
}
