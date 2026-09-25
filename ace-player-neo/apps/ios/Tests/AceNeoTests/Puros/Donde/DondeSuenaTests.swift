import Foundation
import XCTest

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/// «Dónde se está reproduciendo»: cómo se cuenta cada sesión.
final class DondeSuenaTests: XCTestCase {
    private func visor(
        _ cliente: ClientKind, dispositivo: String?, visor: String? = nil, nombre: String? = nil, plataforma: ClientKind? = nil,
        reproduciendo: Bool? = nil
    ) -> SessionSummary.Viewer {
        SessionSummary.Viewer(
            client: cliente, deviceId: dispositivo, lastBeatAt: "2026-09-23T18:30:00.000Z", viewerId: visor,
            deviceName: nombre, platform: plataforma, playing: reproduciendo)
    }

    func testEsteDispositivoPorElIdOPorElVisor() {
        XCTAssertTrue(DondeSuena.esEste(visor(.ios, dispositivo: "dev_1"), dispositivo: "dev_1", visorLocal: "ios_x"))
        XCTAssertTrue(DondeSuena.esEste(visor(.ios, dispositivo: nil, visor: "ios_x"), dispositivo: "dev_1", visorLocal: "ios_x"))
        XCTAssertFalse(DondeSuena.esEste(visor(.web, dispositivo: "web_1", visor: "web_v"), dispositivo: "dev_1", visorLocal: "ios_x"))
        XCTAssertFalse(DondeSuena.esEste(visor(.web, dispositivo: nil), dispositivo: nil, visorLocal: "ios_x"))
    }

    func testNombresEIconos() {
        XCTAssertEqual(DondeSuena.nombre(visor(.web, dispositivo: nil, nombre: "Chrome · Windows")), "Chrome · Windows")
        XCTAssertEqual(DondeSuena.icono(visor(.web, dispositivo: nil, nombre: "Chrome · Windows")), "desktopcomputer")
        XCTAssertEqual(DondeSuena.icono(visor(.web, dispositivo: nil, nombre: "Safari · iPhone")), "iphone")
        XCTAssertEqual(DondeSuena.icono(visor(.web, dispositivo: nil, nombre: "Chrome · Android")), "iphone")
        XCTAssertEqual(DondeSuena.icono(visor(.ios, dispositivo: "dev_1", nombre: "iPhone de Isma", plataforma: .ios)), "iphone")
        XCTAssertEqual(DondeSuena.nombre(visor(.web, dispositivo: nil)), "Navegador", "Sin nombre, por su plataforma")
        XCTAssertEqual(DondeSuena.nombre(visor(.ios, dispositivo: "dev_1", nombre: "  ")), "iPhone")
    }

    func testTituloProtocoloYOrden() {
        let aqui = SessionSummary(
            id: "s_1", hash: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", mode: .hls, openedAt: "2026-09-23T18:00:00.000Z",
            viewers: [visor(.ios, dispositivo: "dev_1")], title: "", protocolo: .hlsFmp4)
        let alla = SessionSummary(
            id: "s_2", hash: "b2c3d4e5f60718293a4b5c6d7e8f901234567890", mode: .progressive,
            openedAt: "2026-09-23T19:00:00.000Z", viewers: [visor(.web, dispositivo: "web_1")], title: "DAZN 1")
        XCTAssertEqual(DondeSuena.titulo(aqui, conocido: "BOING"), "BOING")
        XCTAssertEqual(DondeSuena.titulo(aqui, conocido: nil), "Canal a1b2c3d4…")
        XCTAssertEqual(DondeSuena.titulo(alla, conocido: "otro"), "DAZN 1")
        XCTAssertEqual(DondeSuena.protocolo(aqui), "HLS para iPhone")
        XCTAssertEqual(DondeSuena.protocolo(alla), "MPEG-TS", "Sin protocolo, por el modo de la sesión")
        XCTAssertEqual(DondeSuena.ordenar([alla, aqui], dispositivo: "dev_1", visorLocal: nil).map(\.id), ["s_1", "s_2"])
        XCTAssertEqual(DondeSuena.ordenar([aqui, alla], dispositivo: nil, visorLocal: nil).map(\.id), ["s_2", "s_1"], "Las más recientes primero")
    }
}
