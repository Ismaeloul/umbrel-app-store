import CoreText
import SwiftUI
import UIKit
import os

// Fuentes de la web (b-arquitectura §2.2.3; a1 §3.1, §3.7; canario C10). El único sitio de la app donde se
// crean fuentes (regla R7). Siempre con los DOS ejes: si falta uno, CoreText usa el defecto del fichero
// (wght 200, todo finísimo; a1 §0.5).
//
// - «Palco Sans» (`PalcoSans-ExtraLight`): Mona Sans con la caja de línea de 1 em centrada (ascendente
//   0,885, descendente 0,115, sin interlineado; generar-fuentes.py). Con ella un `Text` mide `tamaño` por
//   línea y `altoDeLinea(lh)` reproduce el `line-height` de CSS exacto (la media interlínea queda arriba y
//   abajo como en el navegador). La OFL reserva «Mona» para la fuente modificada (riesgo 8).
// - Mona Sans original (`MonaSans-ExtraLight`): solo en `TextField` (UIKit mide el campo con su caja).
// - Martian Mono (`MartianMono-SemiExpandedRegular`): hashes, datos técnicos, teclas.

enum VarianteMona: Sendable { case palco, campos }  // PalcoSans (Text) · MonaSans original (TextField)

enum Mona {
    private struct Clave: Hashable, Sendable { var tamano: Double, peso: Double, anchura: Double }
    private static let fuentes = OSAllocatedUnfairLock<[Clave: Font]>(initialState: [:])
    static let wdth = 0x7764_7468, wght = 0x7767_6874

    /// Nombres PostScript de los ficheros de Resources/Fuentes (ORIGEN.json).
    static let postscriptPalco = "PalcoSans-ExtraLight"
    static let postscriptCampos = "MonaSans-ExtraLight"

    /// Siempre los dos ejes (si falta uno, CoreText usa el defecto: wght 200).
    static func fuente(_ tamano: Double, peso: Double, anchura: Double = 100) -> Font {
        let clave = Clave(tamano: tamano, peso: peso, anchura: anchura)
        if let hecha = fuentes.withLock({ $0[clave] }) { return hecha }
        let nueva = Font(ctFont(tamano, peso: peso, anchura: anchura, variante: .palco))
        fuentes.withLock { $0[clave] = nueva }
        return nueva
    }

    static func ctFont(_ tamano: Double, peso: Double, anchura: Double = 100, variante: VarianteMona = .palco) -> CTFont {
        let ejes: [NSNumber: NSNumber] = [
            NSNumber(value: wdth): NSNumber(value: anchura), NSNumber(value: wght): NSNumber(value: peso),
        ]
        let atributos: [CFString: Any] = [
            kCTFontNameAttribute: variante == .palco ? postscriptPalco : postscriptCampos,
            kCTFontVariationAttribute: ejes,
        ]
        return CTFontCreateWithFontDescriptor(CTFontDescriptorCreateWithAttributes(atributos as CFDictionary), CGFloat(tamano), nil)
    }

    static func uiFont(_ tamano: Double, peso: Double, anchura: Double = 100, variante: VarianteMona = .campos) -> UIFont {
        let ejes: [NSNumber: NSNumber] = [
            NSNumber(value: wdth): NSNumber(value: anchura), NSNumber(value: wght): NSNumber(value: peso),
        ]
        let descriptor = UIFontDescriptor(fontAttributes: [
            .name: variante == .palco ? postscriptPalco : postscriptCampos,
            UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): ejes,
        ])
        return UIFont(descriptor: descriptor, size: CGFloat(tamano))
    }

    /// La fuente de un estilo (cifras, cuerpo…).
    static func fuente(_ estilo: EstiloTexto) -> Font {
        estilo.mono ? Martian.fuente(estilo.tamano, peso: estilo.peso) : fuente(estilo.tamano, peso: estilo.peso, anchura: estilo.anchura)
    }
}

/// Martian Mono: wdth 87,5 (`font-stretch: 87.5%`), peso 400 (560 en las teclas) (a1 §3.1, §3.6).
enum Martian {
    private struct Clave: Hashable, Sendable { var tamano: Double, peso: Double }
    private static let fuentes = OSAllocatedUnfairLock<[Clave: Font]>(initialState: [:])
    static let postscript = "MartianMono-SemiExpandedRegular"
    static let anchura = 87.5

    static func fuente(_ tamano: Double, peso: Double = 400) -> Font {
        let clave = Clave(tamano: tamano, peso: peso)
        if let hecha = fuentes.withLock({ $0[clave] }) { return hecha }
        let nueva = Font(ctFont(tamano, peso: peso))
        fuentes.withLock { $0[clave] = nueva }
        return nueva
    }

    /// Alto natural de una línea de Martian en pantalla: ascendente + descendente (1000/−200, 1,2 em; es su caja de
    /// contenido también en la web, USE_TYPO_METRICS) llevado a la rejilla de píxeles @3x como lo pinta SwiftUI.
    /// Martian no se normalizó a 1 em (no hacía falta): el alto de línea se calcula con esta caja (laboratorio, bloque 1).
    static func altoNatural(_ tamano: Double) -> Double {
        let fuente = ctFont(tamano)
        let bruto = Double(CTFontGetAscent(fuente) + CTFontGetDescent(fuente) + CTFontGetLeading(fuente))
        return (bruto * 3).rounded(.up) / 3
    }

    static func ctFont(_ tamano: Double, peso: Double = 400) -> CTFont {
        let ejes: [NSNumber: NSNumber] = [
            NSNumber(value: Mona.wdth): NSNumber(value: anchura), NSNumber(value: Mona.wght): NSNumber(value: peso),
        ]
        let atributos: [CFString: Any] = [kCTFontNameAttribute: postscript, kCTFontVariationAttribute: ejes]
        return CTFontCreateWithFontDescriptor(CTFontDescriptorCreateWithAttributes(atributos as CFDictionary), CGFloat(tamano), nil)
    }
}
