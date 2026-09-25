import Foundation
import XCTest

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/// El borrador de gustos (preferences/model.ts de la web).
final class GustosEditablesTests: XCTestCase {
    func testMarcarYDesmarcarPorClave() {
        var gustos = GustosFutbol(teams: ["real madrid"])
        gustos = GustosEditables.alternar(gustos, .equipos, "Real Madrid")
        XCTAssertEqual(gustos.teams, [], "«real madrid» es el mismo que «Real Madrid»")
        gustos = GustosEditables.alternar(gustos, .ligas, "LaLiga")
        XCTAssertEqual(gustos.leagues, ["LaLiga"])
    }

    func testAnadirAMano() {
        let (conBarca, nombre) = GustosEditables.anadir(.vacios, .equipos, "  barcelona ")
        XCTAssertEqual(nombre, "Barcelona", "Se marca el chip fijo con esa clave")
        XCTAssertEqual(conBarca.teams, ["Barcelona"])
        let (igual, repetido) = GustosEditables.anadir(conBarca, .equipos, "BARCELONA")
        XCTAssertEqual(igual.teams, ["Barcelona"])
        XCTAssertEqual(repetido, "Barcelona")
        XCTAssertNil(GustosEditables.anadir(.vacios, .equipos, "x").1, "Menos de 2 caracteres no vale")
        let (propio, _) = GustosEditables.anadir(.vacios, .nacionalidades, "Japón")
        XCTAssertEqual(GustosEditables.opciones(propio, .nacionalidades).last, "Japón")
        XCTAssertEqual(GustosEditables.bandera("Japón"), "🌍")
        XCTAssertEqual(GustosEditables.bandera("España"), "🇪🇸")
    }

    func testTopesYLimpieza() {
        let muchas = (1...20).map { "Liga \($0)" }
        let limpias = GustosEditables.limpiar(muchas + ["liga 1", "", "  "], tipo: .ligas)
        XCTAssertEqual(limpias.count, 12, "Como mucho 12 ligas")
        var llenas = GustosFutbol(leagues: limpias)
        llenas = GustosEditables.alternar(llenas, .ligas, "Serie A")
        XCTAssertEqual(llenas.leagues.count, 12, "Con la lista llena no se añade")
    }
}
