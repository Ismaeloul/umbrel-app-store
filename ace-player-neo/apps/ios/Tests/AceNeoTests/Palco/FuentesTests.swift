import CoreText
import Foundation
import Testing
import UIKit

@testable import AceNeo

/* FuentesTests (b-arquitectura §3.1; a1 §3.5, §3.7): las tres fuentes registradas, los DOS ejes siempre y los
   avances del «4» medidos en el woff2 de la web. */

@MainActor
struct FuentesTests {
    private static let wdth = NSNumber(value: Mona.wdth)
    private static let wght = NSNumber(value: Mona.wght)

    private func avanceDelCuatro(_ fuente: CTFont) -> Double {
        var caracter: [UniChar] = Array("4".utf16)
        var glifo: [CGGlyph] = [0]
        _ = CTFontGetGlyphsForCharacters(fuente, &caracter, &glifo, 1)
        return CTFontGetAdvancesForGlyphs(fuente, .horizontal, &glifo, nil, 1)
    }

    @Test func lasTresFuentesEstanRegistradas() {
        for nombre in [Mona.postscriptPalco, Mona.postscriptCampos, Martian.postscript] {
            #expect(UIFont(name: nombre, size: 12) != nil, "iOS no registra «\(nombre)»")
        }
    }

    @Test func monaLlevaSiempreLosDosEjes() throws {
        let titular = Mona.ctFont(30, peso: 800, anchura: 125)
        #expect(CTFontCopyPostScriptName(titular) as String == Mona.postscriptPalco)
        let variacion = try #require(CTFontCopyVariation(titular) as? [NSNumber: NSNumber])
        #expect(abs((variacion[FuentesTests.wdth]?.doubleValue ?? 0) - 125) < 0.01)
        #expect(abs((variacion[FuentesTests.wght]?.doubleValue ?? 0) - 800) < 0.01)
        // Con la anchura por defecto (100) también fija los dos ejes: nunca sale el peso 200 del fichero.
        let cuerpo = try #require(CTFontCopyVariation(Mona.ctFont(15, peso: 450)) as? [NSNumber: NSNumber])
        #expect(abs((cuerpo[FuentesTests.wght]?.doubleValue ?? 0) - 450) < 0.01)
        #expect(abs((cuerpo[FuentesTests.wdth]?.doubleValue ?? 0) - 100) < 0.01)
    }

    @Test func elCuatroMideComoEnLaWeb() {
        let condensado = avanceDelCuatro(Mona.ctFont(100, peso: 780, anchura: 75)) / 100
        #expect(abs(condensado - 0.490) <= 0.005, "«4» a wdth 75 / 780: \(condensado) em")
        let normal = avanceDelCuatro(Mona.ctFont(100, peso: 450, anchura: 100)) / 100
        #expect(abs(normal - 0.624) <= 0.005, "«4» a wdth 100 / 450: \(normal) em")
        let campos = avanceDelCuatro(Mona.ctFont(100, peso: 780, anchura: 75, variante: .campos)) / 100
        #expect(abs(campos - condensado) < 0.001, "Palco Sans y Mona Sans deben tener los mismos avances")
    }

    @Test func palcoSansTieneLaCajaDeUnEm() {
        let palco = Mona.ctFont(100, peso: 450)
        #expect(abs(CTFontGetAscent(palco) - 88.5) < 0.2)
        #expect(abs(CTFontGetDescent(palco) - 11.5) < 0.2)
        #expect(abs(CTFontGetLeading(palco)) < 0.01)
        let campos = Mona.uiFont(100, peso: 450)
        #expect(campos.fontName == Mona.postscriptCampos)
    }

    @Test func martianConSuAnchura() throws {
        let mono = Martian.ctFont(12)
        #expect(CTFontCopyPostScriptName(mono) as String == Martian.postscript)
        let variacion = try #require(CTFontCopyVariation(mono) as? [NSNumber: NSNumber])
        #expect(abs((variacion[FuentesTests.wdth]?.doubleValue ?? 0) - 87.5) < 0.01)
        #expect(abs((variacion[FuentesTests.wght]?.doubleValue ?? 0) - 400) < 0.01)
    }
}
