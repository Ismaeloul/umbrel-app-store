import CoreText
import UIKit
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
        XCTAssertNil(info["UISupportedInterfaceOrientations~ipad"], "Solo iPhone")
        XCTAssertEqual(info["UIViewControllerBasedStatusBarAppearance"] as? Bool, true)
    }

    // MARK: - Fuentes de la web (b-arquitectura §1.13.3; canario C10)

    private static let wdth = NSNumber(value: 0x7764_7468)
    private static let wght = NSNumber(value: 0x7767_6874)

    func testFuentesDeLaWebEnElBundle() throws {
        let fuentes = try XCTUnwrap(info["UIAppFonts"] as? [String])
        XCTAssertEqual(fuentes, ["PalcoSans-Variable.ttf", "MonaSans-Variable.ttf", "MartianMono-Variable.ttf"])
        for fichero in fuentes {
            XCTAssertNotNil(Bundle.main.url(forResource: fichero, withExtension: nil), "\(fichero) no está en el bundle")
        }
        for nombre in ["PalcoSans-ExtraLight", "MonaSans-ExtraLight", "MartianMono-SemiExpandedRegular"] {
            XCTAssertNotNil(UIFont(name: nombre, size: 12), "iOS no registra la fuente «\(nombre)»")
        }
    }

    private func fuente(_ nombre: String, tamano: CGFloat, peso: Double, anchura: Double) -> CTFont {
        let ejes: [NSNumber: NSNumber] = [Self.wdth: NSNumber(value: anchura), Self.wght: NSNumber(value: peso)]
        let atributos: [CFString: Any] = [kCTFontNameAttribute: nombre, kCTFontVariationAttribute: ejes]
        return CTFontCreateWithFontDescriptor(CTFontDescriptorCreateWithAttributes(atributos as CFDictionary), tamano, nil)
    }

    private func avanceDelCuatro(_ fuente: CTFont) -> Double {
        var caracter: [UniChar] = Array("4".utf16)
        var glifo: [CGGlyph] = [0]
        XCTAssertTrue(CTFontGetGlyphsForCharacters(fuente, &caracter, &glifo, 1))
        return CTFontGetAdvancesForGlyphs(fuente, .horizontal, &glifo, nil, 1)
    }

    /// Canario C10: CoreText aplica los DOS ejes (wdth y wght) a la fuente variable de UIAppFonts.
    func testFuenteVariableConLosDosEjes() throws {
        let titular = fuente("PalcoSans-ExtraLight", tamano: 30, peso: 800, anchura: 125)
        let variacion = try XCTUnwrap(CTFontCopyVariation(titular) as? [NSNumber: NSNumber])
        XCTAssertEqual(variacion[Self.wdth]?.doubleValue ?? 0, 125, accuracy: 0.01)
        XCTAssertEqual(variacion[Self.wght]?.doubleValue ?? 0, 800, accuracy: 0.01)
        let normal = avanceDelCuatro(fuente("PalcoSans-ExtraLight", tamano: 100, peso: 780, anchura: 100))
        let estrecha = avanceDelCuatro(fuente("PalcoSans-ExtraLight", tamano: 100, peso: 780, anchura: 75))
        let ancha = avanceDelCuatro(fuente("PalcoSans-ExtraLight", tamano: 100, peso: 780, anchura: 125))
        XCTAssertLessThan(estrecha, normal, "wdth 75 no estrecha el «4»")
        XCTAssertGreaterThan(ancha, normal, "wdth 125 no ensancha el «4»")
    }

    /// PalcoSans: caja de 1 em centrada (ascendente 0,885, descendente 0,115, sin interlineado).
    func testPalcoSansConLaCajaDeUnEm() {
        let palco = fuente("PalcoSans-ExtraLight", tamano: 100, peso: 450, anchura: 100)
        XCTAssertEqual(CTFontGetAscent(palco), 88.5, accuracy: 0.2)
        XCTAssertEqual(CTFontGetDescent(palco), 11.5, accuracy: 0.2)
        XCTAssertEqual(CTFontGetLeading(palco), 0, accuracy: 0.01)
    }
}
