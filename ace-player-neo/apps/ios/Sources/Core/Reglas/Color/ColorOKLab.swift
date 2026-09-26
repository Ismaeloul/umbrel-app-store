import Foundation

/* Color de lib/color.ts (b-arquitectura §2.1.3, M2; a1 §2.5, a7 §11.12): sRGB ⇄ OKLCH con las fórmulas
   de Björn Ottosson, contraste WCAG, el hash FNV-1a de los nombres y el tono sacado del nombre. Port
   literal (mismos números) para que cada club y cada canal salgan del mismo color que en la web; lo
   vigilan los vectores de `vectores-comunes.json` (scripts/vectores/comunes.ts). Palco pasa `RGB` a
   `Color` (`RGB.color`, Palco/Tokens/ColorDinamico.swift). */

/// sRGB 0…1 (lib/color.ts `Rgb`).
struct RGB: Hashable, Sendable { var r: Double, g: Double, b: Double }

/// OKLCH (lib/color.ts `Oklch`): luz 0…1, croma y tono en grados 0…360.
struct Oklch: Hashable, Sendable {
    var l: Double
    var c: Double
    var h: Double
}

enum ColorOKLab {
    // MARK: sRGB ⇄ OKLCH

    private static func lineal(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
    private static func gamma(_ c: Double) -> Double { c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1 / 2.4) - 0.055 }
    private static func recorte(_ v: Double) -> Double { min(1, max(0, v)) }

    /// `parseHex`: `#rgb`, `#rrggbb` o `rrggbb` (así los da ESPN) → RGB; `nil` si no es un hex.
    static func desdeHex(_ valor: String?) -> RGB? {
        guard let valor, !valor.isEmpty else { return nil }
        var limpio = valor.trimmingCharacters(in: .whitespacesAndNewlines)
        if limpio.hasPrefix("#") { limpio.removeFirst() }
        let completo: String
        switch limpio.count {
        case 3: completo = limpio.map { "\($0)\($0)" }.joined()
        case 6: completo = limpio
        default: return nil
        }
        guard completo.allSatisfy(\.isHexDigit), completo.allSatisfy(\.isASCII), let n = UInt32(completo, radix: 16)
        else { return nil }
        return RGB(r: Double((n >> 16) & 255) / 255, g: Double((n >> 8) & 255) / 255, b: Double(n & 255) / 255)
    }

    /// `rgbToHex`: `#rrggbb` en minúsculas, redondeando `x·255` tras recortar a [0, 1].
    static func hex(_ color: RGB) -> String {
        let canales = [color.r, color.g, color.b].map { Int((recorte($0) * 255).rounded(.toNearestOrAwayFromZero)) }
        return "#" + canales.map { canal in
            let texto = String(canal, radix: 16)
            return texto.count < 2 ? "0" + texto : texto
        }.joined()
    }

    /// `rgbToOklch`.
    static func oklch(_ color: RGB) -> Oklch {
        let lab = oklab(color)
        let c = hypot(lab.a, lab.b)
        let grados = atan2(lab.b, lab.a) * 180 / Double.pi
        let h = c < 1e-4 ? 0 : (grados + 360).truncatingRemainder(dividingBy: 360)
        return Oklch(l: lab.l, c: c, h: h)
    }

    /// OKLab (L, a, b) de un sRGB.
    static func oklab(_ color: RGB) -> (l: Double, a: Double, b: Double) {
        let lr = lineal(color.r)
        let lg = lineal(color.g)
        let lb = lineal(color.b)
        let l = cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
        let m = cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
        let s = cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
        let L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
        let A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
        let B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
        return (L, A, B)
    }

    /// `oklchToRgb`: OKLCH → sRGB, recortando al gamut.
    static func rgb(_ color: Oklch) -> RGB {
        let radianes = color.h * Double.pi / 180
        return desdeOklab(l: color.l, a: color.c * cos(radianes), b: color.c * sin(radianes))
    }

    /// OKLab → sRGB recortado.
    static func desdeOklab(l: Double, a: Double, b: Double) -> RGB {
        let l1 = pow(l + 0.3963377774 * a + 0.2158037573 * b, 3)
        let m1 = pow(l - 0.1055613458 * a - 0.0638541728 * b, 3)
        let s1 = pow(l - 0.0894841775 * a - 1.291485548 * b, 3)
        let r = 4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1
        let g = -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1
        let bb = -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1
        return RGB(r: recorte(gamma(r)), g: recorte(gamma(g)), b: recorte(gamma(bb)))
    }

    /// `color-mix(in oklab, a p, b)` de dos colores opacos (a1 §2.3).
    static func mezclar(_ a: RGB, _ b: RGB, p: Double) -> RGB {
        let x = oklab(a)
        let y = oklab(b)
        let q = 1 - p
        return desdeOklab(l: p * x.l + q * y.l, a: p * x.a + q * y.a, b: p * x.b + q * y.b)
    }

    /// `oklchCss`: `oklch(0.46 0.11 200)` o con `/ alfa`.
    static func css(_ color: Oklch, alfa: Double = 1) -> String {
        let base = "\(corto(color.l, 3)) \(corto(color.c, 3)) \(corto(color.h, 1))"
        return alfa < 1 ? "oklch(\(base) / \(corto(alfa, 2)))" : "oklch(\(base))"
    }

    /// `Number(n.toFixed(d))` pasado a texto como lo escribe JavaScript (sin ceros de sobra).
    static func corto(_ valor: Double, _ decimales: Int) -> String {
        let factor = pow(10, Double(decimales))
        let redondeado = (valor * factor).rounded(.toNearestOrAwayFromZero) / factor
        if redondeado == redondeado.rounded() { return String(Int(redondeado)) }
        var texto = String(format: "%.\(decimales)f", redondeado)
        while texto.hasSuffix("0") { texto.removeLast() }
        return texto
    }

    /// `parseOklch`: `oklch(0.83 0.12 222)` o `oklch(83% 0.12 222deg / 0.5)` → Oklch (sin el alfa).
    static func leerOklch(_ texto: String) -> Oklch? {
        let patron = #"oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:/\s*[\d.]+%?\s*)?\)"#
        guard let expresion = try? NSRegularExpression(pattern: patron, options: [.caseInsensitive]),
            let hallado = expresion.firstMatch(in: texto, range: NSRange(texto.startIndex..., in: texto))
        else { return nil }
        func grupo(_ n: Int) -> String {
            guard let rango = Range(hallado.range(at: n), in: texto) else { return "" }
            return String(texto[rango])
        }
        let luz = grupo(1)
        let l = luz.hasSuffix("%") ? (numero(String(luz.dropLast())) / 100) : numero(luz)
        return Oklch(l: l, c: numero(grupo(2)), h: numero(grupo(3)))
    }

    /// `Number.parseFloat` de lo que casa con `[\d.]+` (prefijo numérico válido).
    private static func numero(_ texto: String) -> Double {
        var prefijo = ""
        var punto = false
        for caracter in texto {
            if caracter == "." {
                if punto { break }
                punto = true
            } else if !caracter.isASCII || !caracter.isNumber {
                break
            }
            prefijo.append(caracter)
        }
        return Double(prefijo) ?? .nan
    }

    // MARK: Contraste WCAG

    /// `relativeLuminance`.
    static func luminancia(_ color: RGB) -> Double {
        0.2126 * lineal(color.r) + 0.7152 * lineal(color.g) + 0.0722 * lineal(color.b)
    }

    /// `contrastRatio`: contraste WCAG 2.x entre dos colores opacos (1…21).
    static func contraste(_ a: RGB, _ b: RGB) -> Double {
        let x = luminancia(a)
        let y = luminancia(b)
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    // MARK: Tonos de equipo y de canal

    /// `hashText`: FNV-1a de 32 bits sobre las unidades UTF-16 (`charCodeAt`).
    static func hashTexto(_ texto: String) -> UInt32 {
        var h: UInt32 = 0x811C_9DC5
        for unidad in texto.utf16 {
            h ^= UInt32(unidad)
            h = h &* 0x0100_0193
        }
        return h
    }

    /// `FORBIDDEN_HUES`: rojo de «sin señal», verde de «verificada» y violeta (extremos incluidos).
    static let tonosVetados: [(desde: Double, hasta: Double)] = [(15, 40), (140, 160), (280, 320)]

    /// `isForbiddenHue`.
    static func tonoVetado(_ tono: Double) -> Bool {
        let h = (tono.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
        return tonosVetados.contains { h >= $0.desde && h <= $0.hasta }
    }

    /// Múltiplos de 5 de 0 a 355 fuera de las franjas vetadas (52 tonos).
    static let tonosPermitidos: [Double] = stride(from: 0.0, to: 360, by: 5).filter { !tonoVetado($0) }

    /// `hueFromName`: tono sacado del nombre (recortado y en minúsculas).
    static func tonoDeNombre(_ nombre: String) -> Double {
        let clave = nombre.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let indice = Int(hashTexto(clave) % UInt32(tonosPermitidos.count))
        return tonosPermitidos[indice]
    }

    /// `teamLight`: el color de un club como «luz» del tema (halos, velos, focos); `nil` sin color válido.
    static func luzEquipo(primario: String?, secundario: String?, oscuro: Bool) -> Oklch? {
        guard let primero = desdeHex(primario) else { return nil }
        var color = oklch(primero)
        let casiBlanco = { (c: Oklch) -> Bool in c.l > 0.9 && c.c < 0.04 }
        if !oscuro && casiBlanco(color) {
            let alternativo = desdeHex(secundario).map(oklch)
            if let alternativo, !casiBlanco(alternativo) {
                color = alternativo
            } else {
                color = Oklch(l: 0.58, c: 0.06, h: 255)
            }
        }
        let banda: (minimo: Double, maximo: Double) = oscuro ? (0.55, 0.93) : (0.5, 0.74)
        return Oklch(l: min(banda.maximo, max(banda.minimo, color.l)), c: min(color.c, 0.22), h: color.h)
    }
}
