import XCTest
import os

@testable import AceNeo

/// Cliente de /native/api/v1 contra un `URLProtocol` simulado.
final class APIClientTests: XCTestCase {
    override func setUp() {
        super.setUp()
        MockURLProtocol.limpiar()
    }

    override func tearDown() {
        MockURLProtocol.limpiar()
        super.tearDown()
    }

    private func cliente(
        tokens: any TokenStore = MemoryTokenStore(token: Prueba.token),
        servidores: ServerResolver? = nil, alPerderAcceso: @escaping @Sendable () async -> Void = {}
    ) throws -> APIClient {
        APIClient(
            session: MockURLProtocol.sesion(), servidores: try servidores ?? Prueba.servidores(), tokens: tokens,
            alPerderAcceso: alPerderAcceso)
    }

    func testPoneElBearerYEntraPorNative() async throws {
        let arranque = try Fixtures.datos("v1/bootstrap.json")
        MockURLProtocol.responder { _ in (200, [:], arranque) }

        let respuesta = try await cliente().enviar(API.bootstrap)

        XCTAssertEqual(respuesta.version, "0.7.0")
        let peticion = try XCTUnwrap(MockURLProtocol.peticiones.first)
        XCTAssertEqual(peticion.url?.absoluteString, "http://umbrel.local:7792/native/api/v1/bootstrap")
        XCTAssertEqual(peticion.httpMethod, "GET")
        XCTAssertEqual(peticion.value(forHTTPHeaderField: "Authorization"), "Bearer \(Prueba.token)")
        XCTAssertEqual(peticion.value(forHTTPHeaderField: "Accept"), "application/json")
    }

    func testPingYEmparejarVanSinToken() async throws {
        let reclamado = try Fixtures.datos("v1/pairingClaim.json")
        MockURLProtocol.responder { _ in (201, [:], reclamado) }

        let respuesta = try await cliente(tokens: MemoryTokenStore()).enviar(
            API.reclamarCodigo(PairingClaimBody(code: "482913", name: "iPhone de prueba")))

        XCTAssertEqual(respuesta.deviceId, "dev_iphone01")
        let peticion = try XCTUnwrap(MockURLProtocol.peticiones.first)
        XCTAssertNil(peticion.value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(peticion.httpMethod, "POST")
        XCTAssertEqual(peticion.url?.path(), "/native/api/v1/pairing/claim")
        XCTAssertEqual(peticion.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let cuerpo = try JSONSerialization.jsonObject(with: try XCTUnwrap(peticion.httpBody)) as? [String: String]
        XCTAssertEqual(cuerpo, ["code": "482913", "name": "iPhone de prueba", "platform": "ios"])
    }

    func testSinTokenPideEmparejarSinTocarLaRed() async throws {
        MockURLProtocol.responder { _ in (200, [:], Data()) }
        do {
            _ = try await cliente(tokens: MemoryTokenStore()).enviar(API.bootstrap)
            XCTFail("Tenía que pedir emparejar")
        } catch let error as APIError {
            XCTAssertEqual(error, .necesitaEmparejar(codigo: nil))
        }
        XCTAssertTrue(MockURLProtocol.peticiones.isEmpty)
    }

    func test401BorraElTokenYAvisaParaVolverAEmparejar() async throws {
        MockURLProtocol.responder { _ in (401, [:], Prueba.errorJSON("device_revoked")) }
        let tokens = MemoryTokenStore(token: Prueba.token)
        let avisos = Contador()

        do {
            _ = try await cliente(tokens: tokens, alPerderAcceso: { _ = avisos.sumar() }).enviar(API.agenda)
            XCTFail("Tenía que pedir emparejar")
        } catch let error as APIError {
            XCTAssertEqual(error, .necesitaEmparejar(codigo: "device_revoked"))
            XCTAssertEqual(error.mensaje, ErrorCatalog.mensaje(para: "device_revoked"))
        }
        XCTAssertNil(try tokens.leerToken())
        XCTAssertEqual(avisos.actual, 1)
    }

    /// Mientras se olvida este iPhone el 401 ni borra ni avisa: manda el resultado del DELETE (a9 §3.5.3).
    func test401CalladoMientrasSeOlvida() async throws {
        MockURLProtocol.responder { _ in (401, [:], Prueba.errorJSON("device_revoked")) }
        let tokens = MemoryTokenStore(token: Prueba.token)
        let avisos = Contador()
        let api = try cliente(tokens: tokens, alPerderAcceso: { _ = avisos.sumar() })
        api.callarAccesoPerdido(true)
        do {
            _ = try await api.enviar(API.biblioteca)
            XCTFail("Tenía que pedir emparejar")
        } catch let error as APIError {
            XCTAssertEqual(error, .necesitaEmparejar(codigo: "device_revoked"))
        }
        XCTAssertEqual(try tokens.leerToken(), Prueba.token)
        XCTAssertEqual(avisos.actual, 0)
        XCTAssertNil(api.ultimoCodigoAccesoPerdido)

        api.callarAccesoPerdido(false)
        _ = try? await api.enviar(API.biblioteca)
        XCTAssertEqual(avisos.actual, 1)
        XCTAssertEqual(api.ultimoCodigoAccesoPerdido, "device_revoked")
    }

    /// Plazo TOTAL (withTimeout de la web): un servidor que gotea bytes sin acabar no lo alarga.
    func testPlazoTotalConServidorQueGotea() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ProtocoloGoteo.self]
        let api = APIClient(
            session: URLSession(configuration: config), servidores: try Prueba.servidores(),
            tokens: MemoryTokenStore(token: Prueba.token))
        var lenta = API.biblioteca
        lenta.plazo = 1
        lenta.idempotente = false  // sin la repetición contra la otra dirección
        let inicio = Date()
        do {
            _ = try await api.enviar(lenta)
            XCTFail("Tenía que agotar el plazo")
        } catch let error as APIError {
            XCTAssertEqual(error, .red(.timedOut))
            XCTAssertEqual(error.mensaje, "El servidor tarda demasiado en responder. Vuelve a intentarlo en un momento.")
        }
        XCTAssertLessThan(Date().timeIntervalSince(inicio), 4)
    }

    /// Las mutaciones no se repiten contra la otra dirección (a8 §3.11.1): `PUT preferences` tampoco.
    func testUnPUTNoSeRepite() async throws {
        MockURLProtocol.responder { _ in throw URLError(.networkConnectionLost) }
        do {
            _ = try await cliente().enviar(API.guardarPreferencias(PreferencesInput(onboardingComplete: true)))
            XCTFail("Tenía que fallar")
        } catch let error as APIError {
            XCTAssertEqual(error, .red(.networkConnectionLost))
            XCTAssertTrue(error.reintentable)
        }
        XCTAssertEqual(MockURLProtocol.peticiones.count, 1)
    }

    /// Cancelar quien llama no es un error que se enseñe.
    func testCancelarNoEsUnPlazo() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ProtocoloGoteo.self]
        let api = APIClient(
            session: URLSession(configuration: config), servidores: try Prueba.servidores(),
            tokens: MemoryTokenStore(token: Prueba.token))
        let tarea = Task { () -> APIError? in
            do {
                _ = try await api.enviar(API.biblioteca)
                return nil
            } catch {
                return APIError.desde(error)
            }
        }
        try await Task.sleep(for: .milliseconds(300))
        tarea.cancel()
        let error = await tarea.value
        XCTAssertEqual(error, .cancelado)
    }

    func testCodigoIncorrectoNoEsPerderElAcceso() async throws {
        // pairing_invalid también es un 401, pero en una ruta sin token: es un error normal.
        let texto = ErrorCatalog.mensaje(para: "pairing_invalid")
        MockURLProtocol.responder { _ in (401, [:], Prueba.errorJSON("pairing_invalid", texto)) }
        let tokens = MemoryTokenStore(token: "otro.token")
        let avisos = Contador()
        do {
            _ = try await cliente(tokens: tokens, alPerderAcceso: { _ = avisos.sumar() }).enviar(
                API.reclamarCodigo(PairingClaimBody(code: "000000", name: "iPhone")))
            XCTFail("Tenía que fallar")
        } catch let error as APIError {
            XCTAssertEqual(error.codigo, "pairing_invalid")
            XCTAssertEqual(
                error.mensaje, "El código no es correcto. Revísalo en la web y vuelve a intentarlo.")
        }
        XCTAssertEqual(try tokens.leerToken(), "otro.token")
        XCTAssertEqual(avisos.actual, 0)
    }

    func testErrorDelServidorConSuMensaje() async throws {
        let fallo = try Fixtures.datos("errors/api-error.json")
        MockURLProtocol.responder { _ in (502, [:], fallo) }
        do {
            _ = try await cliente().enviar(API.estadoMotor)
            XCTFail("Tenía que fallar")
        } catch let error as APIError {
            guard case .servidor(let codigo, let estado, _, let requestId) = error else {
                return XCTFail("Error inesperado: \(error)")
            }
            XCTAssertEqual(codigo, "engine_unavailable")
            XCTAssertEqual(estado, 502)
            XCTAssertEqual(requestId, "req-7f3a9c")
            // Como la web (errors.ts): el `message` que manda el servidor (ya sale de su catálogo).
            XCTAssertEqual(
                error.localizedDescription, "El motor AceStream no responde. Prueba a reiniciarlo desde Ajustes.")
        }
    }

    func testErrorSinCuerpoUsaElCodigoHTTP() async throws {
        MockURLProtocol.responder { _ in (429, ["Content-Type": "text/html"], Data("<html></html>".utf8)) }
        do {
            _ = try await cliente().enviar(API.marcadores)
            XCTFail("Tenía que fallar")
        } catch let error as APIError {
            XCTAssertEqual(error.codigo, "http_429")
            XCTAssertEqual(error.mensaje, "Ese servidor limita las descargas (429). Vuelve a intentarlo en unos minutos.")
        }
    }

    func testRespuestaMalFormadaEsErrorDeFormato() async throws {
        MockURLProtocol.responder { _ in (200, [:], Data(#"{"ok":true}"#.utf8)) }
        do {
            _ = try await cliente().enviar(API.agenda)
            XCTFail("Tenía que fallar")
        } catch let error as APIError {
            guard case .formato = error else { return XCTFail("Error inesperado: \(error)") }
        }
    }

    func testTrasUnFalloDeRedReintentaConLaOtraDireccion() async throws {
        // La red local deja de responder a mitad; Tailscale sí.
        let ping = try Prueba.ping()
        let lanCaida = Contador()
        let config = ServerConfig(tailscale: Prueba.baseTailscale, lan: Prueba.base)
        let servidores = ServerResolver(config: config) { base in
            if base == Prueba.base && lanCaida.actual > 0 { throw URLError(.cannotConnectToHost) }
            if base == Prueba.baseTailscale {
                // Tailscale tarda un poco más: al principio gana la red local.
                try await Task.sleep(for: .milliseconds(150))
            }
            return ping
        }
        let agenda = try Fixtures.datos("v1/footballSchedule.json")
        MockURLProtocol.responder { peticion in
            if peticion.url?.host() == "umbrel.local" {
                lanCaida.sumar()
                throw URLError(.cannotConnectToHost)
            }
            return (200, [:], agenda)
        }

        let respuesta = try await cliente(servidores: servidores).enviar(API.agenda)

        // El ejemplo de la agenda trae dos días desde la 0.8.0 (uno con escudos y otro sin ellos).
        XCTAssertEqual(respuesta.days.count, 2)
        let hosts = MockURLProtocol.peticiones.compactMap { $0.url?.host() }
        XCTAssertEqual(hosts, ["umbrel.local", "100.101.102.103"])
        let activo = await servidores.conocido()
        XCTAssertEqual(activo?.via, .tailscale)
    }

    func testUnaPeticionNoIdempotenteNoSeRepite() async throws {
        MockURLProtocol.responder { _ in throw URLError(.networkConnectionLost) }
        do {
            _ = try await cliente().enviar(API.reiniciarMotor)
            XCTFail("Tenía que fallar")
        } catch let error as APIError {
            XCTAssertEqual(error, .red(.networkConnectionLost))
        }
        XCTAssertEqual(MockURLProtocol.peticiones.count, 1)
    }

    func testCuerpoDeUnaMutacionDeBiblioteca() async throws {
        let biblioteca = try Fixtures.datos("v1/libraryMutate.json")
        MockURLProtocol.responder { _ in (200, [:], biblioteca) }
        _ = try await cliente().enviar(
            API.cambiarBiblioteca(.rename(collection: .favorites, id: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", title: "Mi canal")))
        let peticion = try XCTUnwrap(MockURLProtocol.peticiones.first)
        let cuerpo = try JSONSerialization.jsonObject(with: try XCTUnwrap(peticion.httpBody)) as? [String: String]
        XCTAssertEqual(
            cuerpo,
            ["action": "rename", "collection": "favorites", "id": "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", "title": "Mi canal"])
    }
}

/// URLs de las rutas: prefijo nativo, codificación de la query y de la ruta.
final class EndpointTests: XCTestCase {
    func testLaQueryCodificaElMasYLosEspacios() throws {
        let url = try API.buscar("M+ LaLiga").url(base: Prueba.base)
        XCTAssertEqual(url.absoluteString, "http://umbrel.local:7792/native/api/v1/search?q=M%2B%20LaLiga")
    }

    func testStreamPideElClienteIOSYElModo() throws {
        let url = try API.stream(
            id: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", visor: "visor_1", modo: .low, titulo: "DAZN 1"
        ).url(base: Prueba.base)
        XCTAssertEqual(
            url.absoluteString,
            "http://umbrel.local:7792/native/api/v1/channels/a1b2c3d4e5f60718293a4b5c6d7e8f9012345678/stream?client=ios&kind=auto&mode=low&viewer=visor_1&title=DAZN%201"
        )
    }

    func testCanalRepetidoEnLaResolucion() throws {
        let url = try API.resolver(partido: "fltv-2026-09-23-3", canales: ["M+ LaLiga", "DAZN 1"], rebuscar: true)
            .url(base: Prueba.base)
        XCTAssertEqual(
            url.query(),
            "match=fltv-2026-09-23-3&channel=M%2B%20LaLiga&channel=DAZN%201&research=1")
    }

    func testLaBaseConBarraOConRuta() throws {
        let conBarra = try API.bootstrap.url(base: URL(string: "http://umbrel.local:7792/")!)
        XCTAssertEqual(conBarra.absoluteString, "http://umbrel.local:7792/native/api/v1/bootstrap")
        let conRuta = try API.ping().url(base: URL(string: "https://umbrel.tail1234.ts.net/ace")!)
        XCTAssertEqual(conRuta.absoluteString, "https://umbrel.tail1234.ts.net/ace/native/api/v1/ping")
    }

    func testLosIdsRarosNoMetenBarrasNiPuntosCodificados() throws {
        let url = try API.precalentado(partido: "a/b c").url(base: Prueba.base)
        XCTAssertEqual(url.path(percentEncoded: true), "/native/api/v1/football/preheat/a%2Fb%20c")
        XCTAssertEqual(Codificacion.segmento("fltv-2026.09_23~x"), "fltv-2026.09_23~x")
    }

    func testPoliticaDeReconexion() {
        XCTAssertEqual(PoliticaReconexion.espera(intento: 1), 1)
        XCTAssertEqual(PoliticaReconexion.espera(intento: 2), 2)
        XCTAssertEqual(PoliticaReconexion.espera(intento: 3), 4)
        XCTAssertEqual(PoliticaReconexion.espera(intento: 9), 8)
    }
}

/// Un servidor que responde 200 y va mandando un espacio cada 0,2 s sin acabar nunca.
final class ProtocoloGoteo: URLProtocol, @unchecked Sendable {
    private let parado = OSAllocatedUnfairLock(initialState: false)

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url,
            let respuesta = HTTPURLResponse(
                url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])
        else { return }
        client?.urlProtocol(self, didReceive: respuesta, cacheStoragePolicy: .notAllowed)
        Thread.detachNewThread { [self] in
            while !parado.withLock({ $0 }) {
                client?.urlProtocol(self, didLoad: Data(" ".utf8))
                Thread.sleep(forTimeInterval: 0.2)
            }
        }
    }

    override func stopLoading() { parado.withLock { $0 = true } }
}
