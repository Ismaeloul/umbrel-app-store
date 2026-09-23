import XCTest

@testable import AceNeo

/// Enlace del QR, direcciones, cambio de servidor y emparejamiento completo.
final class EmparejamientoTests: XCTestCase {
    override func setUp() {
        super.setUp()
        MockURLProtocol.limpiar()
    }

    override func tearDown() {
        MockURLProtocol.limpiar()
        super.tearDown()
    }

    // MARK: Enlace del QR

    func testEnlaceDelQR() throws {
        let enlace = try XCTUnwrap(PairingLink(texto: "aceneo://pair?u=http%3A%2F%2Fumbrel.local%3A7792&c=482913"))
        XCTAssertEqual(enlace.servidor.absoluteString, "http://umbrel.local:7792")
        XCTAssertEqual(enlace.codigo, "482913")

        let tailscale = try XCTUnwrap(
            PairingLink(url: URL(string: "aceneo://pair?u=http://100.64.0.7:7792/&c=000123")!))
        XCTAssertEqual(tailscale.servidor.absoluteString, "http://100.64.0.7:7792")
    }

    func testEnlacesQueNoValen() {
        for texto in [
            "https://umbrel.local:7792", "aceneo://pair?u=http%3A%2F%2Fumbrel.local&c=12345",
            "aceneo://pair?u=ftp%3A%2F%2Fumbrel.local&c=123456", "aceneo://otra?u=http%3A%2F%2Fa&c=123456",
            "aceneo://pair?c=123456", "aceneo://pair?u=http%3A%2F%2Fa&c=12345a",
        ] {
            XCTAssertNil(PairingLink(texto: texto), texto)
        }
    }

    // MARK: Direcciones

    func testNormalizarDirecciones() {
        XCTAssertEqual(ServerConfig.normalizar(" umbrel.local:7792 ")?.absoluteString, "http://umbrel.local:7792")
        XCTAssertEqual(
            ServerConfig.normalizar("https://umbrel.tail1234.ts.net/algo?x=1")?.absoluteString,
            "https://umbrel.tail1234.ts.net")
        XCTAssertEqual(ServerConfig.normalizar("HTTP://192.168.1.10:7792")?.absoluteString, "http://192.168.1.10:7792")
        XCTAssertNil(ServerConfig.normalizar(""))
        XCTAssertNil(ServerConfig.normalizar("ftp://umbrel.local"))
        XCTAssertNil(ServerConfig.normalizar("http://usuario:clave@umbrel.local"))
    }

    func testTailscaleORedLocal() {
        let via = { (texto: String) in ServerVia.clasificar(URL(string: texto)!) }
        XCTAssertEqual(via("http://100.64.0.1:7792"), .tailscale)
        XCTAssertEqual(via("http://100.127.255.254:7792"), .tailscale)
        XCTAssertEqual(via("http://umbrel.tail1234.ts.net:7792"), .tailscale)
        XCTAssertEqual(via("http://100.128.0.1:7792"), .lan)
        XCTAssertEqual(via("http://100.63.0.1:7792"), .lan)
        XCTAssertEqual(via("http://192.168.1.10:7792"), .lan)
        XCTAssertEqual(via("http://umbrel.local:7792"), .lan)
    }

    func testLasDireccionesSeGuardanFueraDelLlavero() {
        let almacen = ServerConfigStore(suite: "es.ismaeloul.aceplayerneo.tests.\(UUID().uuidString)")
        XCTAssertTrue(almacen.leer().vacia)
        let config = ServerConfig(tailscale: Prueba.baseTailscale, lan: Prueba.base)
        almacen.guardar(config)
        XCTAssertEqual(almacen.leer(), config)
        almacen.borrar()
        XCTAssertTrue(almacen.leer().vacia)
    }

    // MARK: Cambio automático de servidor

    func testGanaLaDireccionQueResponde() async throws {
        let ping = try Prueba.ping()
        let config = ServerConfig(tailscale: Prueba.baseTailscale, lan: Prueba.base)
        let servidores = ServerResolver(config: config) { base in
            guard base == Prueba.baseTailscale else { throw URLError(.cannotConnectToHost) }
            return ping
        }
        let activo = try await servidores.actual()
        XCTAssertEqual(activo, ActiveServer(via: .tailscale, url: Prueba.baseTailscale))
        let conocido = await servidores.conocido()
        XCTAssertEqual(conocido, activo)
    }

    func testSiNingunaRespondeSeDiceClaro() async throws {
        let servidores = ServerResolver(config: ServerConfig(tailscale: Prueba.baseTailscale, lan: Prueba.base)) { _ in
            throw URLError(.timedOut)
        }
        do {
            _ = try await servidores.actual()
            XCTFail("Tenía que fallar")
        } catch let error as APIError {
            XCTAssertEqual(error, .servidorInalcanzable)
        }
    }

    func testSinDireccionesNoHayServidor() async {
        let servidores = ServerResolver(config: ServerConfig()) { _ in throw URLError(.timedOut) }
        do {
            _ = try await servidores.actual()
            XCTFail("Tenía que fallar")
        } catch {
            XCTAssertEqual(error as? APIError, .sinServidor)
        }
    }

    func testPingAUnaWebQueNoEsAcePlayerNeo() async throws {
        MockURLProtocol.responder { _ in
            (200, [:], Data(#"{"ok":true,"app":"otra-cosa","version":"1","apiVersion":1,"serverTime":1}"#.utf8))
        }
        let servidores = ServerResolver(config: ServerConfig(lan: Prueba.base), session: MockURLProtocol.sesion())
        do {
            _ = try await servidores.actual()
            XCTFail("Tenía que fallar")
        } catch let error as APIError {
            XCTAssertEqual(error, .noEsAcePlayerNeo)
        }
        let peticion = try XCTUnwrap(MockURLProtocol.peticiones.first)
        XCTAssertEqual(peticion.url?.absoluteString, "http://umbrel.local:7792/native/api/v1/ping")
        XCTAssertNil(peticion.value(forHTTPHeaderField: "Authorization"))
    }

    func testVersionDeApiIncompatible() async throws {
        MockURLProtocol.responder { _ in
            (200, [:], Data(#"{"ok":true,"app":"ace-player-neo","version":"9.0.0","apiVersion":2,"serverTime":1}"#.utf8))
        }
        let servidores = ServerResolver(config: ServerConfig(lan: Prueba.base), session: MockURLProtocol.sesion())
        do {
            _ = try await servidores.actual()
            XCTFail("Tenía que fallar")
        } catch let error as APIError {
            XCTAssertEqual(error, .versionIncompatible(2))
        }
    }

    // MARK: Emparejamiento completo

    func testEmparejarGuardaElTokenYLasDirecciones() async throws {
        let ping = try Fixtures.datos("v1/ping.json")
        let reclamado = try Fixtures.datos("v1/pairingClaim.json")
        MockURLProtocol.responder { peticion in
            switch peticion.url?.path() {
            case "/native/api/v1/ping": return (200, [:], ping)
            case "/native/api/v1/pairing/claim": return (201, [:], reclamado)
            default: return (404, [:], Prueba.errorJSON("not_found"))
            }
        }
        let sesion = MockURLProtocol.sesion()
        let tokens = KeychainTokenStore(backend: LlaveroSimulado())
        let configuracion = ServerConfigStore(suite: "es.ismaeloul.aceplayerneo.tests.\(UUID().uuidString)")
        let api = APIClient(
            session: sesion, servidores: ServerResolver(config: ServerConfig(), session: sesion), tokens: tokens)
        let servicio = PairingService(api: api, configuracion: configuracion)
        let config = ServerConfig(lan: Prueba.base)

        let respuesta = try await servicio.emparejar(config: config, codigo: "482913", nombre: "  iPhone de Isma  ")

        XCTAssertEqual(respuesta.device.platform, .ios)
        XCTAssertEqual(try tokens.leerToken(), "dev_iphone01.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
        XCTAssertEqual(configuracion.leer(), config)
        let reclamo = try XCTUnwrap(MockURLProtocol.peticiones.last)
        let cuerpo = try JSONSerialization.jsonObject(with: try XCTUnwrap(reclamo.httpBody)) as? [String: String]
        XCTAssertEqual(cuerpo?["name"], "iPhone de Isma")
        XCTAssertEqual(cuerpo?["code"], "482913")
    }

    func testUnCodigoMalEscritoNoSaleALaRed() async throws {
        let sesion = MockURLProtocol.sesion()
        let api = APIClient(
            session: sesion, servidores: ServerResolver(config: ServerConfig(), session: sesion),
            tokens: MemoryTokenStore())
        let servicio = PairingService(
            api: api, configuracion: ServerConfigStore(suite: "es.ismaeloul.aceplayerneo.tests.\(UUID().uuidString)"))
        do {
            try await servicio.emparejar(config: ServerConfig(lan: Prueba.base), codigo: "12a456", nombre: "iPhone")
            XCTFail("Tenía que fallar")
        } catch let error as APIError {
            XCTAssertEqual(error.codigo, "pairing_invalid")
        }
        XCTAssertTrue(MockURLProtocol.peticiones.isEmpty)
    }
}
