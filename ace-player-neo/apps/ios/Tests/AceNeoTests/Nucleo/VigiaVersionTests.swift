import XCTest

@testable import AceNeo

/// VigiaVersion (a7 §5.2): la primera lectura es la base; una versión distinta avisa una vez por versión
/// (toast info de 4 s con el icono subir) y llama a `alCambiar`; `ping` una a la vez y errores callados.
final class VigiaVersionTests: XCTestCase {
    override func setUp() {
        super.setUp()
        MockURLProtocol.limpiar()
    }

    override func tearDown() {
        MockURLProtocol.limpiar()
        super.tearDown()
    }

    @MainActor
    private func vigia() -> (VigiaVersion, Avisos) {
        let (entorno, _, _) = PruebaDatos.entorno()
        let avisos = Avisos()
        let vigia = VigiaVersion(api: entorno.api, avisos: avisos)
        vigia.activa = true
        return (vigia, avisos)
    }

    @MainActor
    func testLaPrimeraLecturaEsLaBaseYLasDemasAvisanUnaVez() {
        let (vigia, avisos) = vigia()
        var cambios: [String] = []
        vigia.alCambiar = { cambios.append($0) }
        vigia.leida("0.8.0")
        XCTAssertEqual(vigia.base, "0.8.0")
        XCTAssertTrue(cambios.isEmpty)
        vigia.leida("0.8.0")
        vigia.leida("0.8.1")
        vigia.leida("0.8.1")
        XCTAssertEqual(cambios, ["0.8.1"])
        XCTAssertEqual(PruebaDatos.toasts(avisos), ["Tu Umbrel tiene ahora Ace Player Neo 0.8.1."])
        XCTAssertEqual(avisos.cola.toasts.first?.icono, .subir)
        vigia.leida("0.8.0")  // una bajada sigue el mismo camino
        XCTAssertEqual(cambios, ["0.8.1", "0.8.0"])
    }

    /// Tras salir o emparejar con otro servidor, su versión es la nueva base: sin toast ni `alCambiar`.
    @MainActor
    func testOlvidarLaBaseNoAvisaDelServidorNuevo() {
        let (vigia, avisos) = vigia()
        var cambios: [String] = []
        vigia.alCambiar = { cambios.append($0) }
        vigia.leida("0.8.0")
        vigia.olvidarBase()
        XCTAssertNil(vigia.base)
        vigia.leida("0.9.0")
        XCTAssertEqual(vigia.base, "0.9.0")
        XCTAssertTrue(cambios.isEmpty)
        XCTAssertTrue(PruebaDatos.toasts(avisos).isEmpty)
    }

    @MainActor
    func testRevisarPreguntaPing() async throws {
        try PruebaDatos.servir([:])  // ping: 0.7.0
        let (vigia, _) = vigia()
        var cambios: [String] = []
        vigia.alCambiar = { cambios.append($0) }
        vigia.leida("0.6.9")
        await vigia.revisar(motivo: "resync")
        XCTAssertEqual(cambios, ["0.7.0"])
        XCTAssertGreaterThanOrEqual(PruebaDatos.peticiones("GET", "ping"), 1)  // la carrera de direcciones también hace ping
        let ping = try XCTUnwrap(MockURLProtocol.peticiones.last)
        XCTAssertNil(ping.value(forHTTPHeaderField: "Authorization"), "ping va sin token")
    }

    @MainActor
    func testErroresCalladosYNadaEnDemo() async {
        MockURLProtocol.responder { _ in throw URLError(.cannotConnectToHost) }
        let (vigia, avisos) = vigia()
        vigia.leida("0.8.0")
        await vigia.revisar(motivo: "resync")
        XCTAssertEqual(vigia.base, "0.8.0")
        XCTAssertTrue(PruebaDatos.toasts(avisos).isEmpty)

        vigia.activa = false
        MockURLProtocol.limpiar()
        await vigia.revisar(motivo: "resync")
        XCTAssertTrue(MockURLProtocol.peticiones.isEmpty)
    }
}
