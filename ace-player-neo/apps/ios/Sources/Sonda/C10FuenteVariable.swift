import CoreText
import SwiftUI
import UIKit
import os

// Canario C10 (b-arquitectura §5.3): CTFont variable con wdth + wght desde un TTF de UIAppFonts,
// caché con OSAllocatedUnfairLock, Font(CTFont) y UIFont por descriptor, tal como los usará
// Palco/Tipografia/Mona.swift (§2.2.3). La comprobación de verdad (los ejes que devuelve CoreText)
// está en Tests/AceNeoTests/InfoPlistTests.swift. Plan B: instancias estáticas por (peso, anchura).
// Se borra al cerrar la fase 0.

enum SondaMona {
    private struct Clave: Hashable, Sendable { var tamano: Double, peso: Double, anchura: Double }
    private static let fuentes = OSAllocatedUnfairLock<[Clave: Font]>(initialState: [:])
    static let wdth = 0x7764_7468
    static let wght = 0x7767_6874
    /// PostScript de la Mona modificada (la OFL reserva «Mona»: riesgo 8 → «Palco Sans»).
    static let postscriptPalco = "PalcoSans-ExtraLight"
    static let postscriptCampos = "MonaSans-ExtraLight"

    static func fuente(_ tamano: Double, peso: Double, anchura: Double = 100) -> Font {
        let clave = Clave(tamano: tamano, peso: peso, anchura: anchura)
        if let hecha = fuentes.withLock({ $0[clave] }) { return hecha }
        let nueva = Font(ctFont(tamano, peso: peso, anchura: anchura))
        fuentes.withLock { $0[clave] = nueva }
        return nueva
    }

    static func ctFont(_ tamano: Double, peso: Double, anchura: Double = 100, nombre: String = postscriptPalco) -> CTFont {
        let ejes: [NSNumber: NSNumber] = [NSNumber(value: wdth): NSNumber(value: anchura), NSNumber(value: wght): NSNumber(value: peso)]
        let atributos: [CFString: Any] = [kCTFontNameAttribute: nombre, kCTFontVariationAttribute: ejes]
        return CTFontCreateWithFontDescriptor(CTFontDescriptorCreateWithAttributes(atributos as CFDictionary), CGFloat(tamano), nil)
    }

    static func uiFont(_ tamano: Double, peso: Double, anchura: Double = 100) -> UIFont {
        let ejes: [NSNumber: NSNumber] = [NSNumber(value: wdth): NSNumber(value: anchura), NSNumber(value: wght): NSNumber(value: peso)]
        let descriptor = UIFontDescriptor(fontAttributes: [
            .name: postscriptCampos,
            UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): ejes,
        ])
        return UIFont(descriptor: descriptor, size: CGFloat(tamano))
    }
}

struct SondaC10Fuente: View {
    var body: some View {
        Text("Agenda").font(SondaMona.fuente(30, peso: 800, anchura: 125))
    }
}
