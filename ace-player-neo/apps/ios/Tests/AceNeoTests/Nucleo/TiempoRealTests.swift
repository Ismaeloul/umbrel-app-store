import XCTest

@testable import AceNeo

/// TiempoReal (b-arquitectura §2.5.3; a7 §6.1-6.2, apps/web/src/api/sse.ts): estados, 10 s → respaldo,
/// Last-Event-ID de proceso, abrir tras un corte, 401, segundo plano y demo. Las esperas 3-6-12-24-48-60
/// están en SSETests y en EsperaSSETests.
final class TiempoRealTests: XCTestCase {
    override func setUp() {
        super.setUp()
        MockURLProtocol.limpiar()
    }

    override func tearDown() {
        MockURLProtocol.limpiar()
        super.tearDown()
    }

    @MainActor
    private func tiempoReal(esDemo: Bool = false) throws -> TiempoReal {
        let cliente = SSEClient(
            session: MockURLProtocol.sesion(), servidores: try Prueba.servidores(),
            tokens: MemoryTokenStore(token: Prueba.token), escalaEsperas: 0.003)
        let tiempoReal = TiempoReal(cliente: cliente, esDemo: esDemo)
        tiempoReal.plazoRespaldo = .milliseconds(60)
        return tiempoReal
    }

    private let servidor = ActiveServer(via: .lan, url: Prueba.base)

    /// idle → connecting → open; `fallback` si en 10 s no abre; al abrir tras el corte, avisa.
    @MainActor
    func testEstadosYRespaldo() async throws {
        let tr = try tiempoReal()
        var estados: [EstadoTiempoReal] = []
        var trasCorte = 0
        tr.alCambiarEstado = { estados.append($0) }
        tr.alAbrirTrasCorte = { trasCorte += 1 }
        XCTAssertEqual(tr.estado, .inactivo)

        tr.recibir(.desconectado(.red(.cannotConnectToHost), reintentoEn: 3))
        XCTAssertEqual(tr.estado, .conectando)
        let respaldo = await llegaA(2) { tr.estado == .respaldo }
        XCTAssertTrue(respaldo, "A los 10 s sin abrir pasa a respaldo")
        tr.recibir(.desconectado(nil, reintentoEn: 6))
        XCTAssertEqual(tr.estado, .respaldo, "Sigue en respaldo mientras sondea")

        tr.recibir(.conectado(servidor))
        XCTAssertEqual(tr.estado, .abierto)
        XCTAssertTrue(tr.abierto)
        XCTAssertEqual(trasCorte, 1)
        XCTAssertEqual(estados, [.conectando, .respaldo, .abierto])
    }

    /// Abrir a la primera no es «tras un corte».
    @MainActor
    func testAbrirALaPrimeraNoEsTrasCorte() throws {
        let tr = try tiempoReal()
        var trasCorte = 0
        var conectado: ActiveServer?
        tr.alAbrirTrasCorte = { trasCorte += 1 }
        tr.alConectar = { conectado = $0 }
        tr.recibir(.conectado(servidor))
        XCTAssertEqual(trasCorte, 0)
        XCTAssertEqual(conectado, servidor)
        tr.recibir(.desconectado(nil, reintentoEn: 3))
        tr.recibir(.conectado(servidor))
        XCTAssertEqual(trasCorte, 1, "Un reintento (attempts > 0) sí es un corte")
    }

    /// El último id se guarda en memoria de proceso y se manda al reconectar (Last-Event-ID).
    @MainActor
    func testReanudaConElUltimoId() async throws {
        let cuerpo = "id: 42\nevent: resync\ndata: {\"reason\":\"server_restart\"}\n\n"
        MockURLProtocol.responder { _ in (200, ["Content-Type": "text/event-stream"], Data(cuerpo.utf8)) }
        let tr = try tiempoReal()
        var eventos: [SSEEvent] = []
        tr.alEvento = { eventos.append($0) }
        tr.recibir(.evento(SSEEnvelope(id: "41", event: .resync(ResyncData(reason: .bufferMiss)))))
        XCTAssertEqual(tr.ultimoId, "41")

        tr.arrancar()
        let llego = await llegaA(3) { eventos.count >= 2 }
        XCTAssertTrue(llego)
        tr.parar()
        let primera = try XCTUnwrap(MockURLProtocol.peticiones.first)
        XCTAssertEqual(primera.value(forHTTPHeaderField: "Last-Event-ID"), "41")
        XCTAssertEqual(eventos.last, .resync(ResyncData(reason: .serverRestart)))
        XCTAssertNil(tr.ultimoId, "Parar del todo (acceso perdido) olvida el id")
    }

    /// Un 401 del SSE: fuera, con su código para el motivo.
    @MainActor
    func test401PierdeElAcceso() async throws {
        MockURLProtocol.responder { _ in (401, [:], Prueba.errorJSON("device_revoked")) }
        let tr = try tiempoReal()
        var perdido = 0
        tr.alPerderAcceso = { perdido += 1 }
        tr.arrancar()
        let llego = await llegaA(3) { perdido == 1 }
        XCTAssertTrue(llego)
        XCTAssertEqual(tr.codigoAccesoPerdido, "device_revoked")
        XCTAssertEqual(tr.estado, .inactivo)
        tr.reconectarYa()
        XCTAssertEqual(tr.estado, .inactivo, "Tras perder el acceso no se reconecta solo")
    }

    /// Sin nada sonando, en segundo plano se corta; al volver, reconecta con el mismo id.
    @MainActor
    func testSegundoPlanoYVuelta() async throws {
        MockURLProtocol.responder { _ in
            (200, ["Content-Type": "text/event-stream"], Data("id: 9\nevent: resync\ndata: {\"reason\":\"buffer_miss\"}\n\n".utf8))
        }
        let tr = try tiempoReal()
        tr.arrancar()
        let abrio = await llegaA(3) { tr.ultimoId == "9" }
        XCTAssertTrue(abrio)
        tr.pasoASegundoPlano(suena: true)
        XCTAssertNotEqual(tr.estado, .inactivo, "Sonando sigue")
        tr.pasoASegundoPlano(suena: false)
        XCTAssertEqual(tr.estado, .inactivo)
        MockURLProtocol.limpiar()
        MockURLProtocol.responder { _ in (200, ["Content-Type": "text/event-stream"], Data(": ping\n\n".utf8)) }
        tr.reconectarYa()
        XCTAssertNotEqual(tr.estado, .inactivo)
        let pidio = await llegaA(3) { !MockURLProtocol.peticiones.isEmpty }
        XCTAssertTrue(pidio)
        XCTAssertEqual(MockURLProtocol.peticiones.first?.value(forHTTPHeaderField: "Last-Event-ID"), "9")
        tr.parar()
    }

    /// En demo no hay SSE: estado `demo` y nada se abre (a7 §5, §13.1).
    @MainActor
    func testDemo() async throws {
        let tr = try tiempoReal(esDemo: true)
        XCTAssertEqual(tr.estado, .demo)
        tr.arrancar()
        tr.reconectarYa()
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(tr.estado, .demo)
        XCTAssertTrue(MockURLProtocol.peticiones.isEmpty)
    }
}
