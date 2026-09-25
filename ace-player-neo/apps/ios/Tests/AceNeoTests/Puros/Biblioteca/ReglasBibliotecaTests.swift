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

private func item(_ id: String, _ titulo: String, categoria: String = "", fecha: String = "2026-09-23T10:00:00.000Z", web: Bool = false)
    -> Item
{
    Item(
        id: id, title: titulo, alias: nil, type: web ? .web : .fav, category: categoria, date: fecha,
        fromWebSync: web, ih: false)
}

/// Biblioteca como la de la web: listas agrupadas, recientes por tramos, lo que emite cada canal.
final class ReglasBibliotecaTests: XCTestCase {
    func testListasAgrupadasPorCategoriaEnOrdenAlfabetico() {
        let canales = [
            item("1", "DAZN 1", categoria: "Deportes", web: true),
            item("2", "La 1", categoria: "generalistas", web: true),
            item("3", "Sin nada", web: true),
            item("4", "DAZN 2", categoria: "Deportes", web: true),
            item("5", "Clan", categoria: "Álbum infantil", web: true),
        ]
        let grupos = ReglasBiblioteca.porCategoria(canales)
        XCTAssertEqual(grupos.map(\.categoria), ["Álbum infantil", "Deportes", "General", "generalistas"])
        XCTAssertEqual(grupos[1].items.map(\.id), ["1", "4"], "Sin cambiar el orden dentro")
        XCTAssertEqual(ReglasBiblioteca.filtrar(canales, texto: "album").map(\.id), ["5"], "Sin tildes")
        XCTAssertEqual(ReglasBiblioteca.filtrar(canales, texto: "DEPORTES").count, 2, "También por categoría")
    }

    func testRecientesPorTramos() {
        var calendario = Calendar(identifier: .gregorian)
        calendario.timeZone = TimeZone(identifier: "Europe/Madrid")!
        let ahora = Date(timeIntervalSince1970: 1_790_150_400)  // 23-sep-2026 10:00 en Madrid
        let recientes = [
            item("1", "A", fecha: "2026-09-23T07:00:00.000Z"),
            item("2", "B", fecha: "2026-09-22T12:00:00.000Z"),
            item("3", "C", fecha: "2026-09-19T12:00:00.000Z"),
            item("4", "D", fecha: "2026-08-01T12:00:00.000Z"),
            item("5", "E", fecha: "no es fecha"),
        ]
        let grupos = ReglasBiblioteca.porTramos(recientes, ahora: ahora, calendario: calendario)
        XCTAssertEqual(grupos.map(\.tramo), ["Hoy", "Ayer", "Esta semana", "Antes", "Hoy"])
    }

    func testSeccionInicialSubtitulosYCanalCaido() throws {
        let arranque = try JSONDecoder().decode(BootstrapResponse.self, from: Fixtures.datos("v1/bootstrap.json"))
        XCTAssertEqual(ReglasBiblioteca.seccionInicial(arranque.library), .favoritos)
        var sinFavoritos = arranque.library
        sinFavoritos.favorites = []
        XCTAssertEqual(ReglasBiblioteca.seccionInicial(sinFavoritos), .recientes)
        sinFavoritos.history = []
        XCTAssertEqual(ReglasBiblioteca.seccionInicial(sinFavoritos), .listas)

        XCTAssertNil(ReglasBiblioteca.subtitulo(item("1", "X", categoria: "Guardado"), seccion: .favoritos))
        XCTAssertEqual(ReglasBiblioteca.subtitulo(item("1", "X", categoria: "Deportes"), seccion: .favoritos), "Deportes")
        XCTAssertEqual(ReglasBiblioteca.subtitulo(item("1", "X", categoria: "Guardado"), seccion: .listas), "Guardado")

        let caido = item("abc", "Canal", web: true)
        XCTAssertTrue(ReglasBiblioteca.caido(caido, idsLista: ["otro"]))
        XCTAssertFalse(ReglasBiblioteca.caido(caido, idsLista: ["abc"]))
        XCTAssertFalse(ReglasBiblioteca.caido(caido, idsLista: []), "Sin lista cargada no se marca nada")
        XCTAssertTrue(ReglasBiblioteca.pie(arranque.library).hasPrefix("4 canales en biblioteca"))
    }

    func testQueEmiteCadaCanalHoy() {
        let reloj = RelojMadrid(fecha: "2026-09-23", minutos: 20 * 60)
        let agenda = FootballSchedule(
            generatedAt: "", timezone: "Europe/Madrid", country: "Spain", source: .demo, attribution: "", demo: true,
            limited: false, partial: false,
            days: [
                FootballDay(
                    date: "2026-09-23",
                    matches: [
                        partido("jugando", "19:30", "LaLiga", local: "Real Madrid", visitante: "Getafe", canales: ["M+ LaLiga TV"]),
                        partido("luego", "22:00", "LaLiga", local: "Betis", visitante: "Sevilla", canales: ["DAZN LaLiga"]),
                        partido("antes", "21:00", "Premier", local: "Arsenal", visitante: "Chelsea", canales: ["DAZN LaLiga"]),
                    ]),
                FootballDay(date: "2026-09-24", matches: [partido("manana", "20:00", "LaLiga", fecha: "2026-09-24", canales: ["DAZN 1"])]),
            ], stale: nil)
        let indice = IndiceAntena(agenda: agenda, reloj: reloj)
        XCTAssertEqual(indice.para(titulo: "M+ LALIGA FHD --> ELCANO", alias: nil, marcadores: [:])?.partido.id, "jugando")
        XCTAssertEqual(indice.para(titulo: "M+ LALIGA FHD --> ELCANO", alias: nil, marcadores: [:])?.enDirecto, true)
        let siguiente = indice.para(titulo: "DAZN LaLiga FHD", alias: nil, marcadores: [:])
        XCTAssertEqual(siguiente?.partido.id, "antes", "El siguiente de hoy, el más cercano")
        XCTAssertEqual(siguiente?.enDirecto, false)
        XCTAssertNil(indice.para(titulo: "DAZN 1", alias: nil, marcadores: [:]), "Mañana no cuenta")
        XCTAssertNil(indice.para(titulo: "DAZN", alias: nil, marcadores: [:]), "La familia no basta")
        let terminado = LiveScore(home: 2, away: 1, state: "post", clock: "", detail: "", confidence: 1)
        XCTAssertNil(indice.para(titulo: "M+ LaLiga TV", alias: nil, marcadores: ["jugando": terminado]))
    }
}
