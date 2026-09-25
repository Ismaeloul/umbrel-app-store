import AVFoundation
import XCTest

@testable import AceNeo

/// Reproducción REAL en el simulador con `MotorAVPlayer` (AVPlayer de
/// verdad) contra el HLS de prueba público de Apple: listo, primer fotograma,
/// cabezal avanzando, salto y vaciado. Si el runner no tiene salida a
/// Internet, se salta (no es un fallo de la app).
final class MotorAVPlayerTests: XCTestCase {
    private let hlsDePrueba = URL(
        string: "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8")!

    @MainActor
    func testReproduceUnHLSDeVerdadHastaElPrimerFotograma() async throws {
        var peticion = URLRequest(url: hlsDePrueba, timeoutInterval: 10)
        peticion.httpMethod = "GET"
        let accesible: Bool
        do {
            let (_, respuesta) = try await URLSession.shared.data(for: peticion)
            accesible = (respuesta as? HTTPURLResponse)?.statusCode == 200
        } catch {
            accesible = false
        }
        try XCTSkipUnless(accesible, "Sin acceso al HLS de prueba de Apple desde el runner")

        let motor = MotorAVPlayer()
        motor.player.isMuted = true
        var eventos: [EventoMotor] = []
        motor.alEvento = { eventos.append($0) }

        motor.cargar(url: hlsDePrueba, perfil: PlaybackMode.low.perfilIOS)
        motor.reproducir()

        await esperarHasta("AVPlayer queda listo", plazo: 45) { eventos.contains(.listo) }
        await esperarHasta("Llega el primer fotograma", plazo: 45) { eventos.contains(.primerFotograma) }
        XCTAssertEqual(motor.estadoTiempo, .reproduciendo)
        XCTAssertGreaterThan(motor.tiempoActual, 0)
        XCTAssertNotNil(motor.ventana, "Hay tramo que se puede recorrer")
        let huboFallo = eventos.contains { evento in
            if case .fallo = evento { return true }
            return false
        }
        XCTAssertFalse(huboFallo)

        // Saltar dentro de la ventana funciona y el colchón se puede cambiar sin recargar.
        let destino = (motor.ventana?.inicio ?? 0) + 2
        let llego = await motor.saltar(a: destino)
        XCTAssertTrue(llego)
        motor.aplicar(perfil: PlaybackMode.stable.perfilIOS)

        motor.pausar()
        await esperarHasta("Queda en pausa", plazo: 5) { motor.estadoTiempo == .pausado }
        motor.vaciar()
        XCTAssertNil(motor.player.currentItem)
    }

    @MainActor
    func testUnaURLQueNoExisteAvisaDelFallo() async throws {
        let motor = MotorAVPlayer()
        var fallos = 0
        motor.alEvento = { evento in
            if case .fallo = evento { fallos += 1 }
        }
        motor.cargar(url: URL(string: "http://127.0.0.1:9/no-existe/index.m3u8")!, perfil: PlaybackMode.balanced.perfilIOS)
        motor.reproducir()
        await esperarHasta("Avisa del fallo (una sola vez)", plazo: 30) { fallos >= 1 }
        try await Task.sleep(for: .milliseconds(600))
        XCTAssertEqual(fallos, 1)
        motor.vaciar()
    }
}
