import XCTest

@testable import AceNeo

/// El Info.plist de la app compilada (los tests corren dentro de ella):
/// ATS acotado, audio en segundo plano, permisos en español y esquema aceneo://.
final class InfoPlistTests: XCTestCase {
    private var info: [String: Any] { Bundle.main.infoDictionary ?? [:] }

    func testNombreYBundleId() {
        XCTAssertEqual(info["CFBundleDisplayName"] as? String, "Ace Neo")
        XCTAssertEqual(Bundle.main.bundleIdentifier, "es.ismaeloul.aceplayerneo")
        XCTAssertNotNil(info["CFBundleShortVersionString"] as? String)
    }

    func testATSSinCargasArbitrariasYSoloRedLocalYTailscale() throws {
        let ats = try XCTUnwrap(info["NSAppTransportSecurity"] as? [String: Any])
        XCTAssertNil(ats["NSAllowsArbitraryLoads"], "Nada de NSAllowsArbitraryLoads global")
        XCTAssertNil(ats["NSAllowsArbitraryLoadsForMedia"])
        XCTAssertEqual(ats["NSAllowsLocalNetworking"] as? Bool, true)
        let dominios = try XCTUnwrap(ats["NSExceptionDomains"] as? [String: [String: Any]])
        XCTAssertEqual(
            Set(dominios.keys),
            ["ts.net", "100.64.0.0/10", "fd7a:115c:a1e0::/48", "192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"])
        XCTAssertEqual(dominios["ts.net"]?["NSIncludesSubdomains"] as? Bool, true)
        for (dominio, ajustes) in dominios {
            XCTAssertEqual(ajustes["NSExceptionAllowsInsecureHTTPLoads"] as? Bool, true, dominio)
        }
    }

    func testAudioEnSegundoPlanoYPermisosEnEspanol() {
        XCTAssertEqual(info["UIBackgroundModes"] as? [String], ["audio"])
        let camara = info["NSCameraUsageDescription"] as? String ?? ""
        let red = info["NSLocalNetworkUsageDescription"] as? String ?? ""
        XCTAssertTrue(camara.contains("código QR"), camara)
        XCTAssertTrue(red.contains("red local"), red)
    }

    func testEsquemaDelEnlaceDeEmparejamiento() throws {
        let tipos = try XCTUnwrap(info["CFBundleURLTypes"] as? [[String: Any]])
        let esquemas = tipos.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
        XCTAssertEqual(esquemas, ["aceneo"])
    }

    func testOrientacionesDelIPhone() {
        let orientaciones = Set(info["UISupportedInterfaceOrientations"] as? [String] ?? [])
        XCTAssertEqual(
            orientaciones,
            ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"])
    }
}
