import SwiftUI
import UIKit

// b-arquitectura §2.2.1. Lo escribió I0 en la fase 0.1 porque el generado (ColoresPalco.generado.swift)
// lo necesita para compilar; desde la fase 0.4 es de P. Es el único sitio (con el generado) donde se
// escribe un color a mano (regla R6 del linter).

extension UIColor {
    convenience init(hex: UInt32, alfa: Double = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: CGFloat(alfa))
    }
}

extension Color {
    /// sRGB exacto de tokens.css; cambia con el tema de la ventana (y con `.islaOscura()`).
    init(claro: UInt32, oscuro: UInt32, alfaClaro: Double = 1, alfaOscuro: Double = 1) {
        self.init(
            uiColor: UIColor { rasgos in
                rasgos.userInterfaceStyle == .dark
                    ? UIColor(hex: oscuro, alfa: alfaOscuro) : UIColor(hex: claro, alfa: alfaClaro)
            })
    }

    init(hex: UInt32, alfa: Double = 1) {
        self.init(
            .sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255, opacity: alfa)
    }
}

extension RGB {
    var color: Color { Color(.sRGB, red: r, green: g, blue: b) }

    /// `#rrggbb` de la web (colores de club de la API, muestras de la galería).
    init(hex: UInt32) {
        self.init(
            r: Double((hex >> 16) & 0xFF) / 255, g: Double((hex >> 8) & 0xFF) / 255, b: Double(hex & 0xFF) / 255)
    }
}

/// Colores fijos de las primitivas que la web escribe literales en su CSS (no son tokens).
enum PalcoFijo {
    /// Fondo de la placa de siglas del escudo: `rgb(8 20 34 / .86)` (TeamMark.css; a1 §10.12).
    static let placaSiglas = Color(hex: 0x081422, alfa: 0.86)
    /// Tinta oscura de las mitades del versus y de las teselas: `#0a0d12` (VersusCard.css, ChannelMark.css).
    static let tintaOscura = RGB(hex: 0x0A0D12)
    /// Sombras azuladas del vídeo y del pulgar: `rgb(2 8 18)` (a1 §5).
    static let sombraVideo = Color(hex: 0x020812)
    /// Césped de la «retransmisión de mentira» de la galería (SistemaPage.css; a1 §11 punto 9).
    static let cesped1 = Color(hex: 0x1F6B36)
    static let cesped2 = Color(hex: 0x237A3D)
    static let focoRojo = Color(hex: 0xCB3524, alfa: 0.7)
    static let focoAzul = Color(hex: 0x132257, alfa: 0.8)
}

/// Mezcla OKLab de dos colores opacos, como `color-mix(in oklab, a p%, b)` (lib/color.ts; a1 §2.3).
/// PROVISIONAL hasta que M2 porte lib/color.ts en Core/Reglas/Color: entonces esto llama a ese port.
enum MezclaOKLab {
    static func mezclar(_ a: RGB, _ b: RGB, p: Double) -> RGB {
        let x = oklab(a)
        let y = oklab(b)
        let q = 1 - p
        return rgb(L: p * x.L + q * y.L, A: p * x.A + q * y.A, B: p * x.B + q * y.B)
    }

    /// OKLCH → sRGB recortado (oklchToRgb de lib/color.ts).
    static func oklch(_ l: Double, _ c: Double, _ h: Double) -> RGB {
        let radianes = h * Double.pi / 180
        return rgb(L: l, A: c * cos(radianes), B: c * sin(radianes))
    }

    /// `oklch(0.93 0.03 tono)` con el tono del color (aro del monograma sin secundario; a1 §2.5).
    static func aclarar(_ c: RGB) -> RGB {
        let lab = oklab(c)
        let tono = atan2(lab.B, lab.A) * 180 / Double.pi
        return oklch(0.93, 0.03, tono)
    }

    private static func lineal(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
    private static func gamma(_ c: Double) -> Double { c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1 / 2.4) - 0.055 }
    private static func recorte(_ v: Double) -> Double { min(1, max(0, v)) }

    private static func oklab(_ c: RGB) -> (L: Double, A: Double, B: Double) {
        let r = lineal(c.r)
        let g = lineal(c.g)
        let b = lineal(c.b)
        let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        let L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
        let A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
        let B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
        return (L, A, B)
    }

    private static func rgb(L: Double, A: Double, B: Double) -> RGB {
        let l1 = L + 0.3963377774 * A + 0.2158037573 * B
        let m1 = L - 0.1055613458 * A - 0.0638541728 * B
        let s1 = L - 0.0894841775 * A - 1.291485548 * B
        let l = l1 * l1 * l1
        let m = m1 * m1 * m1
        let s = s1 * s1 * s1
        let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
        let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
        let b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
        return RGB(r: recorte(gamma(r)), g: recorte(gamma(g)), b: recorte(gamma(b)))
    }
}
