import XCTest

@testable import AceNeo

/// Lector de `text/event-stream`.
final class SSEParserTests: XCTestCase {
    func testEventoSencillo() {
        var parser = SSEParser()
        let mensajes = parser.feed("id: 1\nevent: resync\ndata: {\"reason\":\"buffer_miss\"}\n\n")
        XCTAssertEqual(
            mensajes, [SSEMessage(id: "1", event: "resync", data: #"{"reason":"buffer_miss"}"#, retry: nil)])
        XCTAssertEqual(parser.lastEventId, "1")
    }

    func testVariasLineasDeDataSeUnenConSaltoDeLinea() {
        var parser = SSEParser()
        let mensajes = parser.feed("data: uno\ndata:dos\ndata:  tres\n\n")
        XCTAssertEqual(mensajes.map(\.data), ["uno\ndos\n tres"])
        XCTAssertEqual(mensajes.first?.event, "message")
    }

    func testCRLFYCRSolos() {
        var parser = SSEParser()
        let mensajes = parser.feed("event: a\r\ndata: 1\r\n\r\nevent: b\rdata: 2\r\r")
        XCTAssertEqual(mensajes.map(\.event), ["a", "b"])
        XCTAssertEqual(mensajes.map(\.data), ["1", "2"])
    }

    func testElLatidoYLosComentariosNoSonEventos() {
        var parser = SSEParser()
        XCTAssertTrue(parser.feed(": ping\n\n").isEmpty)
        XCTAssertTrue(parser.feed(":\n\n").isEmpty)
    }

    func testSinDataNoSeDespachaPeroElIdSeQueda() {
        var parser = SSEParser()
        XCTAssertTrue(parser.feed("id: 9\nevent: nada\n\n").isEmpty)
        XCTAssertEqual(parser.lastEventId, "9")
        // El tipo no pasa al siguiente evento.
        XCTAssertEqual(parser.feed("data: x\n\n").first?.event, "message")
        XCTAssertEqual(parser.feed("data: x\n\n").first?.id, "9")
    }

    func testTramaPartidaEnCualquierPunto() {
        let trama = Array("id: 3\nevent: stream.stats\ndata: {\"a\":1}\n\n: ping\n\nid: 4\ndata: b\n\n".utf8)
        for corte in 1..<trama.count {
            var parser = SSEParser()
            let mensajes = parser.feed(trama[..<corte]) + parser.feed(trama[corte...])
            XCTAssertEqual(mensajes.map(\.id), ["3", "4"], "cortando en \(corte)")
            XCTAssertEqual(mensajes.first?.event, "stream.stats")
        }
    }

    func testCRLFPartidoEntreDosTrozos() {
        var parser = SSEParser()
        var mensajes = parser.feed("data: x\r")
        mensajes += parser.feed("\n\r")
        mensajes += parser.feed("\n")
        XCTAssertEqual(mensajes.map(\.data), ["x"])
    }

    func testRetryYCamposDesconocidos() {
        var parser = SSEParser()
        let mensajes = parser.feed("retry: 5000\nfoo: bar\nretry: 12a\ndata\n\n")
        XCTAssertEqual(parser.retryMs, 5000)
        XCTAssertEqual(mensajes.first?.data, "")
        XCTAssertEqual(mensajes.first?.retry, 5000)
    }

    func testBOMInicialYUTF8() {
        var parser = SSEParser()
        let mensajes = parser.feed("\u{FEFF}data: Fútbol en España ⚽︎\n\n")
        XCTAssertEqual(mensajes.first?.data, "Fútbol en España ⚽︎")
    }

    func testUnIdConNULSeIgnora() {
        var parser = SSEParser(lastEventId: "5")
        _ = parser.feed("id: a\u{0}b\ndata: x\n\n")
        XCTAssertEqual(parser.lastEventId, "5")
    }
}

/// Cliente SSE: reconexión con `Last-Event-ID`, eventos tipados y 401.
final class SSEClientTests: XCTestCase {
    override func setUp() {
        super.setUp()
        MockURLProtocol.limpiar()
    }

    override func tearDown() {
        MockURLProtocol.limpiar()
        super.tearDown()
    }

    private func motorJSON() throws -> String {
        let objeto = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Fixtures.datos("events/engine.status.json")) as? [String: Any])
        let data = try JSONSerialization.data(withJSONObject: try XCTUnwrap(objeto["data"]))
        return String(decoding: data, as: UTF8.self)
    }

    func testReconectaSolaConLastEventIDYEntregaEventosTipados() async throws {
        let motor = try motorJSON()
        let conexiones = Contador()
        MockURLProtocol.responder { _ in
            let numero = conexiones.sumar()
            let cuerpo =
                numero == 1
                ? ": ping\n\nid: 7\nevent: resync\ndata: {\"reason\":\"buffer_miss\"}\n\n"
                : "id: 8\nevent: engine.status\ndata: \(motor)\n\n"
            return (200, ["Content-Type": "text/event-stream"], Data(cuerpo.utf8))
        }
        let cliente = SSEClient(
            session: MockURLProtocol.sesion(), servidores: try Prueba.servidores(),
            tokens: MemoryTokenStore(token: Prueba.token), escalaEsperas: 0.003)

        let recibidos = try await conPlazo(10) {
            var eventos: [SSEEnvelope] = []
            var conectado = 0
            for await cambio in cliente.conectar() {
                switch cambio {
                case .conectado: conectado += 1
                case .evento(let sobre): eventos.append(sobre)
                default: break
                }
                if eventos.count == 2 { break }
            }
            return Recibido(eventos: eventos, conexiones: conectado)
        }

        XCTAssertEqual(recibidos.eventos.map(\.id), ["7", "8"])
        XCTAssertEqual(recibidos.eventos.first?.event, .resync(ResyncData(reason: .bufferMiss)))
        guard case .engineStatus(let estado) = recibidos.eventos.last?.event else {
            return XCTFail("El segundo evento tenía que ser engine.status")
        }
        XCTAssertEqual(estado.status, .online)
        XCTAssertEqual(recibidos.conexiones, 2)

        let peticiones = MockURLProtocol.peticiones
        XCTAssertGreaterThanOrEqual(peticiones.count, 2)
        XCTAssertEqual(peticiones[0].url?.path(), "/native/api/v1/events")
        XCTAssertEqual(peticiones[0].value(forHTTPHeaderField: "Authorization"), "Bearer \(Prueba.token)")
        XCTAssertEqual(peticiones[0].value(forHTTPHeaderField: "Accept"), "text/event-stream")
        XCTAssertNil(peticiones[0].value(forHTTPHeaderField: "Last-Event-ID"))
        XCTAssertEqual(peticiones[1].value(forHTTPHeaderField: "Last-Event-ID"), "7")
    }

    func test401TerminaLaConexionYPideEmparejar() async throws {
        MockURLProtocol.responder { _ in (401, [:], Prueba.errorJSON("unauthorized")) }
        let tokens = MemoryTokenStore(token: Prueba.token)
        let cliente = SSEClient(
            session: MockURLProtocol.sesion(), servidores: try Prueba.servidores(), tokens: tokens,
            escalaEsperas: 0.003)

        let cambios = try await conPlazo(10) {
            var todos: [SSEUpdate] = []
            for await cambio in cliente.conectar() { todos.append(cambio) }
            return todos
        }

        // El código del 401 llega a la sesión; el token lo borra ella (sabe si es «Olvidar este iPhone»).
        XCTAssertEqual(cambios, [.necesitaEmparejar(codigo: "unauthorized")])
        XCTAssertEqual(try tokens.leerToken(), Prueba.token)
    }

    func testSinTokenNiSiquieraConecta() async throws {
        let cliente = SSEClient(
            session: MockURLProtocol.sesion(), servidores: try Prueba.servidores(), tokens: MemoryTokenStore())
        let cambios = try await conPlazo(5) {
            var todos: [SSEUpdate] = []
            for await cambio in cliente.conectar() { todos.append(cambio) }
            return todos
        }
        XCTAssertEqual(cambios, [.necesitaEmparejar(codigo: nil)])
        XCTAssertTrue(MockURLProtocol.peticiones.isEmpty)
    }

    /// Las de la web (a7 §6.2): 3, 6, 12, 24, 48, 60, 60… s; el `retry:` del servidor si es mayor (hasta 60).
    func testEsperaExponencialConTopeYRetryDelServidor() throws {
        let cliente = SSEClient(
            session: MockURLProtocol.sesion(), servidores: try Prueba.servidores(), tokens: MemoryTokenStore())
        XCTAssertEqual((1...7).map { cliente.espera(intento: $0, retryServidorMs: nil) }, [3, 6, 12, 24, 48, 60, 60])
        XCTAssertEqual(cliente.espera(intento: 1, retryServidorMs: 3000), 3)
        XCTAssertEqual(cliente.espera(intento: 1, retryServidorMs: 5000), 5)
        XCTAssertEqual(cliente.espera(intento: 1, retryServidorMs: 600_000), 60)
    }
}

/// Lo que recoge el test de reconexión.
private struct Recibido: Sendable {
    var eventos: [SSEEnvelope]
    var conexiones: Int
}
