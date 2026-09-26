import Foundation
import XCTest

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

private func partido(
    _ id: String, _ hora: String, _ competicion: String, local: String = "Local", visitante: String = "Visitante",
    fecha: String = "2026-09-23", canales: [String] = []
) -> FootballMatch {
    FootballMatch(
        id: id, date: fecha, time: hora, start: nil, title: "\(local) - \(visitante)", home: local, away: visitante,
        competition: competicion, country: "", channels: canales.enumerated().map { FootballChannelRef(id: "c\($0.offset)", name: $0.element) })
}

/// Reglas de la agenda portadas de la web: reloj de Madrid, insignias, orden y «Para ti».
final class ReglasAgendaTests: XCTestCase {
    /// 23-sep-2026 a las 10:00 en Madrid.
    private let reloj = RelojMadrid(fecha: "2026-09-23", minutos: 600)

    func testDiasSinHusos() {
        XCTAssertEqual(ReglasAgenda.numeroDia("2026-09-23"), 20719)
        XCTAssertEqual(ReglasAgenda.numeroDia("1970-01-01"), 0)
        XCTAssertEqual(ReglasAgenda.numeroDia("1969-12-31"), -1)
        XCTAssertEqual(ReglasAgenda.numeroDia("2024-02-29"), 19782)
        XCTAssertEqual(ReglasAgenda.numeroDia("2000-03-01"), 11017)
        XCTAssertNil(ReglasAgenda.numeroDia("23/09/2026"))
        // Mes o día fuera de rango: nil, y las etiquetas devuelven el texto tal cual (sin salirse de `meses`).
        XCTAssertNil(ReglasAgenda.numeroDia("2026-00-10"))
        XCTAssertNil(ReglasAgenda.numeroDia("2026-13-01"))
        XCTAssertNil(ReglasAgenda.numeroDia("2026-09-00"))
        XCTAssertEqual(ReglasAgenda.etiquetaDia("2026-13-01", hoy: "2026-09-23").principal, "2026-13-01")
        XCTAssertEqual(ReglasAgenda.entradilla("2026-09-24", hoy: "2026-09-23"), "Mañana · Jueves, 24 de septiembre")
        XCTAssertEqual(ReglasAgenda.entradilla("2026-09-26", hoy: "2026-09-23"), "Sáb · Sábado, 26 de septiembre")
        XCTAssertEqual(ReglasAgenda.entradilla("2026-13-01", hoy: "2026-09-23"), "2026-13-01")
        XCTAssertNil(ReglasAgenda.minutosDeHora("Por confirmar"))
        XCTAssertEqual(ReglasAgenda.minutosDeHora("18:30"), 1110)
    }

    func testRelojDeMadridYNoDelTelefono() {
        // 23-sep-2026 18:30 UTC = 20:30 en Madrid (horario de verano).
        let reloj = RelojMadrid(Date(timeIntervalSince1970: 1_790_188_200))
        XCTAssertEqual(reloj.fecha, "2026-09-23")
        XCTAssertEqual(reloj.minutos, 20 * 60 + 30)
    }

    func testInsigniasComoLaWeb() {
        XCTAssertNil(ReglasAgenda.estado(partido("a", "18:30", "LaLiga"), reloj: reloj, marcador: nil), "Faltan más de 6 h")
        XCTAssertEqual(
            ReglasAgenda.estado(partido("a", "15:00", "LaLiga"), reloj: reloj, marcador: nil),
            EstadoPartido(fase: .proximo, texto: "En 5 h 0 min"))
        XCTAssertEqual(
            ReglasAgenda.estado(partido("a", "10:45", "LaLiga"), reloj: reloj, marcador: nil),
            EstadoPartido(fase: .pronto, texto: "En 45 min"))
        XCTAssertEqual(ReglasAgenda.estado(partido("a", "09:30", "LaLiga"), reloj: reloj, marcador: nil)?.fase, .directo)
        XCTAssertEqual(ReglasAgenda.estado(partido("a", "07:30", "LaLiga"), reloj: reloj, marcador: nil)?.fase, .terminado)
        let enJuego = LiveScore(home: 1, away: 0, state: "in", clock: "54'", detail: "", confidence: 1)
        XCTAssertEqual(ReglasAgenda.estado(partido("a", "22:00", "LaLiga"), reloj: reloj, marcador: enJuego)?.fase, .directo)
        XCTAssertNil(ReglasAgenda.estado(partido("a", "Por confirmar", "LaLiga"), reloj: reloj, marcador: nil))
    }

    func testGruposPorCompeticionConLoQueVaEnDirectoPrimero() {
        let partidos = [
            partido("1", "21:00", "LaLiga"),
            partido("2", "07:00", "Amistoso"),  // terminado
            partido("3", "09:30", "Premier League"),  // en directo
            partido("4", "12:00", "LaLiga"),
            partido("5", "13:00", " "),
        ]
        let grupos = ReglasAgenda.porCompeticion(partidos, reloj: reloj)
        XCTAssertEqual(grupos.map(\.competicion), ["Premier League", "LaLiga", "Fútbol", "Amistoso"])
        XCTAssertEqual(grupos[1].partidos.map(\.id), ["4", "1"], "Dentro, por hora")
    }

    func testParaTiSoloConGustosYPorDefectoSiLosHay() {
        let gustos = GustosFutbol(leagues: ["LaLiga"], teams: ["Real Madrid"])
        XCTAssertEqual(ReglasAgenda.modoEfectivo(nil, gustos: gustos), .paraTi)
        XCTAssertEqual(ReglasAgenda.modoEfectivo(.todos, gustos: gustos), .todos)
        XCTAssertEqual(ReglasAgenda.modoEfectivo(.paraTi, gustos: .vacios), .todos, "Sin gustos no hay «Para ti»")

        let partidos = [
            partido("1", "21:00", "LaLiga EA Sports"),
            partido("2", "20:00", "Torneo Proyección", local: "Central Córdoba Reserva", visitante: "Atlético Tucumán Reserva"),
            partido("3", "19:00", "Copa del Rey", local: "Real Madrid", visitante: "Getafe"),
        ]
        XCTAssertEqual(ReglasAgenda.visibles(partidos, modo: .paraTi, gustos: gustos).map(\.id), ["1", "3"])
        XCTAssertEqual(ReglasAgenda.visibles(partidos, modo: .todos, gustos: gustos).count, 3)
        XCTAssertTrue(ParaTi.destacado(partidos[2], gustos))
        XCTAssertFalse(ParaTi.destacado(partidos[0], gustos))
    }

    func testTiraDeDias() {
        let ahora = Date(timeIntervalSince1970: 1_790_150_400)  // 23-sep-2026 10:00 en Madrid
        XCTAssertEqual(FormatoAgenda.partesDia("2026-09-23", ahora: ahora).arriba, "Hoy")
        XCTAssertEqual(FormatoAgenda.partesDia("2026-09-24", ahora: ahora).arriba, "Mañana")
        let viernes = FormatoAgenda.partesDia("2026-09-25", ahora: ahora)
        XCTAssertEqual(viernes.numero, "25")
        XCTAssertTrue(viernes.arriba.hasPrefix("V"), viernes.arriba)
        XCTAssertEqual(FormatoAgenda.partidos(1), "1 partido")
        XCTAssertEqual(FormatoAgenda.partidos(3), "3 partidos")
    }
}
