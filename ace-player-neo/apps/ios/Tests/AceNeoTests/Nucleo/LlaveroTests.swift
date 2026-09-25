import Security
import XCTest

@testable import AceNeo

/// Token en el Llavero, contra un almacén simulado con la semántica real.
final class LlaveroTests: XCTestCase {
    func testGuardaLeeYBorra() throws {
        let almacen = LlaveroSimulado()
        let tokens = KeychainTokenStore(backend: almacen)

        XCTAssertNil(try tokens.leerToken())
        try tokens.guardarToken(Prueba.token)
        XCTAssertEqual(try tokens.leerToken(), Prueba.token)

        let entrada = try XCTUnwrap(almacen.entradas["es.ismaeloul.aceplayerneo|token-dispositivo"])
        XCTAssertEqual(entrada.datos, Data(Prueba.token.utf8))
        XCTAssertEqual(entrada.accesible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)

        try tokens.borrarToken()
        XCTAssertNil(try tokens.leerToken())
        // Borrar dos veces no es un error.
        XCTAssertNoThrow(try tokens.borrarToken())
    }

    func testVolverAEmparejarSustituyeElToken() throws {
        let almacen = LlaveroSimulado()
        let tokens = KeychainTokenStore(backend: almacen)
        try tokens.guardarToken("dev_a.primero")
        try tokens.guardarToken("dev_b.segundo")
        XCTAssertEqual(try tokens.leerToken(), "dev_b.segundo")
        XCTAssertEqual(almacen.entradas.count, 1)
    }

    func testCadaServicioTieneSuToken() throws {
        let almacen = LlaveroSimulado()
        let uno = KeychainTokenStore(backend: almacen, servicio: "uno")
        let otro = KeychainTokenStore(backend: almacen, servicio: "otro")
        try uno.guardarToken("dev_1.x")
        XCTAssertNil(try otro.leerToken())
    }

    func testLosErroresDelLlaveroSeDevuelven() {
        let tokens = KeychainTokenStore(backend: LlaveroSimulado(fallo: errSecInteractionNotAllowed))
        XCTAssertThrowsError(try tokens.leerToken()) { error in
            XCTAssertEqual(error as? KeychainError, .estado(errSecInteractionNotAllowed))
        }
        XCTAssertThrowsError(try tokens.guardarToken("x.y"))
        XCTAssertThrowsError(try tokens.borrarToken())
    }

    func testSiElLlaveroFallaElClientePideEmparejar() async throws {
        let cliente = APIClient(
            session: MockURLProtocol.sesion(), servidores: try Prueba.servidores(),
            tokens: KeychainTokenStore(backend: LlaveroSimulado(fallo: errSecInteractionNotAllowed)))
        do {
            _ = try await cliente.enviar(API.bootstrap)
            XCTFail("Tenía que pedir emparejar")
        } catch let error as APIError {
            XCTAssertEqual(error, .necesitaEmparejar(codigo: nil))
        }
    }

    /// El Llavero de verdad del simulador (se salta si el entorno no lo permite).
    func testLlaveroReal() throws {
        let tokens = KeychainTokenStore(servicio: "es.ismaeloul.aceplayerneo.tests.\(UUID().uuidString)")
        do {
            try tokens.guardarToken("dev_real.token")
        } catch KeychainError.estado(let estado) where estado == errSecMissingEntitlement {
            throw XCTSkip("El simulador no deja usar el Llavero sin firma (errSecMissingEntitlement)")
        }
        XCTAssertEqual(try tokens.leerToken(), "dev_real.token")
        try tokens.borrarToken()
        XCTAssertNil(try tokens.leerToken())
    }
}
