import SwiftUI

// Medidas de la web (b-arquitectura §2.2.2; a1 §4). 1 px CSS = 1 pt.

/// Espacio, base 4 (a1 §4.1; tokens.css `--s-*`).
enum S {
    static let s1: CGFloat = 4, s2: CGFloat = 8, s3: CGFloat = 12, s4: CGFloat = 16, s5: CGFloat = 20
    static let s6: CGFloat = 24, s8: CGFloat = 32, s10: CGFloat = 40, s12: CGFloat = 48
    static let gutter: CGFloat = 16, tap: CGFloat = 44
}

/// Radios (a1 §4.2; tokens.css `--r-*`). Las formas van con esquinas circulares, no continuas (a1 §13.4).
enum R {
    static let xl: CGFloat = 24, l: CGFloat = 18, m: CGFloat = 14, s: CGFloat = 10, xs: CGFloat = 6
    /// Radio de algo metido en un contenedor de radio `exterior` con `relleno`.
    static func interior(_ exterior: CGFloat, relleno: CGFloat) -> CGFloat { max(0, exterior - relleno) }
    /// `--r-inner` de Card y Panel: `max(6, exterior − relleno)` (Surface.css; a1 §4.2).
    static func interiorTarjeta(_ exterior: CGFloat, relleno: CGFloat) -> CGFloat { max(6, exterior - relleno) }
}

/// zIndex del armazón (a2 §4; tokens.css `--z-*`). Hojas y menús son del sistema.
enum Capa {
    static let pestanas = 0.0, partido = 20.0, velo = 39.0, barra = 40.0, mini = 41.0, vuelo = 45.0
    static let avisos = 60.0, inmersivo = 100.0
}

/// Alturas fijas de la maquetación (tokens.css; a1 §4.3). Las posiciones salen de `Maquetacion`.
enum Alturas {
    /// `--tabbar-h`
    static let barra: CGFloat = 64
    /// `--tabbar-gap`
    static let huecoBarra: CGFloat = 10
    /// `--topbar-h` (≥ 768)
    static let barraSuperior: CGFloat = 64
    /// `--mini-h` dentro de `.app` (shell.css:171; a1 §4.3)
    static let mini: CGFloat = 72
    /// Botón y fila de menú, campo, toast (a1 §10.2, §10.19, §10.20)
    static let control: CGFloat = 44
    static let botonSm: CGFloat = 36
    static let campo: CGFloat = 52
    static let toast: CGFloat = 52
}

/// Formas de la web: esquinas circulares (a1 §13.4).
extension Shape where Self == RoundedRectangle {
    static func palco(_ radio: CGFloat) -> RoundedRectangle { RoundedRectangle(cornerRadius: radio, style: .circular) }
}
