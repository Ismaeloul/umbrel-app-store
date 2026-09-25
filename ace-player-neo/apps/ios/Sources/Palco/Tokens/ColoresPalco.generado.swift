// GENERADO por scripts/generar-tokens.mjs desde apps/web/src/styles/tokens.css
// (y las mezclas de apps/web/src/**/*.css). No editar: cambia la web y vuelve a generarlo
// (la CI comprueba que está al día con --check).

import SwiftUI

/// Colores de la web (a1 §2.1-2.2): sRGB exacto, claro y oscuro según el tema de la ventana.
/// Una mezcla con transparente se escribe `Palco.token.opacity(p)`.
enum Palco {
    /// `--bg`
    static let bg = Color(claro: 0xF3F3F4, oscuro: 0x05070A)
    /// `--bg-sunk`
    static let bgSunk = Color(claro: 0xE9E9EB, oscuro: 0x020305)
    /// `--surface`
    static let surface = Color(claro: 0xFFFFFF, oscuro: 0x0F1218)
    /// `--surface-2`
    static let surface2 = Color(claro: 0xECECEE, oscuro: 0x171B23)
    /// `--line`
    static let line = Color(claro: 0xD9D9DC, oscuro: 0x282A2C)
    /// `--line-soft`
    static let lineSoft = Color(claro: 0x0C0C0E, oscuro: 0xFFFFFF, alfaClaro: 0.08, alfaOscuro: 0.1)
    /// `--line-strong`
    static let lineStrong = Color(claro: 0x83858C, oscuro: 0x696A6C)
    /// `--text`
    static let text = Color(claro: 0x0C0C0E, oscuro: 0xFFFFFF)
    /// `--text-2`
    static let text2 = Color(claro: 0x4A4C52, oscuro: 0xB9BABA)
    /// `--text-3`
    static let text3 = Color(claro: 0x66686F, oscuro: 0x878889)
    /// `--accent`
    static let accent = Color(hex: 0xFFD60A)
    /// `--on-accent`
    static let onAccent = Color(hex: 0x1A1400)
    /// `--accent-ink`
    static let accentInk = Color(claro: 0x7E6100, oscuro: 0xFFD60A)
    /// `--accent-edge`
    static let accentEdge = Color(claro: 0x9A6D01, oscuro: 0xFFD60A)
    /// `--accent-wash`
    static let accentWash = Color(claro: 0xFFD60A, oscuro: 0xFFD60A, alfaClaro: 0.22, alfaOscuro: 0.16)
    /// `--live`
    static let live = Color(claro: 0xD92D22, oscuro: 0xFF3B30)
    /// `--live-ink`
    static let liveInk = Color(claro: 0xCE1E16, oscuro: 0xFF3B30)
    /// `--ok`
    static let ok = Color(claro: 0x1F7A46, oscuro: 0x35C759)
    /// `--ok-ink`
    static let okInk = Color(claro: 0x006A37, oscuro: 0x35C759)
    /// `--weak`
    static let weak = Color(claro: 0x8F5B00, oscuro: 0xFFB340)
    /// `--weak-ink`
    static let weakInk = Color(claro: 0x805100, oscuro: 0xFFB340)
    /// `--fail`
    static let fail = Color(claro: 0xC93A2E, oscuro: 0xFF453A)
    /// `--fail-ink`
    static let failInk = Color(claro: 0xB01E16, oscuro: 0xFE5547)
    /// `--glass`
    static let glass = Color(claro: 0xFFFFFF, oscuro: 0x0A0C10, alfaClaro: 0.72, alfaOscuro: 0.62)
    /// `--glass-dense`
    static let glassDense = Color(claro: 0xFFFFFF, oscuro: 0x161A22, alfaClaro: 0.9, alfaOscuro: 0.86)
    /// `--glass-solid`
    static let glassSolid = Color(claro: 0xFAFAFB, oscuro: 0x12161D)
    /// `--glass-hi`
    static let glassHi = Color(claro: 0xFFFFFF, oscuro: 0xFFFFFF, alfaClaro: 0.95, alfaOscuro: 0.1)
    /// `--glass-rim`
    static let glassRim = Color(claro: 0x0C0C0E, oscuro: 0xFFFFFF, alfaClaro: 0.1, alfaOscuro: 0.12)
    /// `--scrim`
    static let scrim = Color(claro: 0x0C0C0E, oscuro: 0x000000, alfaClaro: 0.4, alfaOscuro: 0.62)
    /// `--shadow-1` (color de las sombras, sin alfa)
    static let sombra = Color(claro: 0x14151F, oscuro: 0x000000)
    /// `--glass-video`
    static let glassVideo = Color(hex: 0x090C11, alfa: 0.62)
    /// `--glass-video-solid`
    static let glassVideoSolid = Color(hex: 0x0F1218)
    /// `--on-video`
    static let onVideo = Color(hex: 0xFFFFFF)
    /// `--on-video-2`
    static let onVideo2 = Color(hex: 0xFFFFFF, alfa: 0.76)
    /// `--veil`
    static let veil = Color(hex: 0x000000, alfa: 0.55)
    /// `--veil-strong`
    static let veilStrong = Color(hex: 0x000000, alfa: 0.85)

    /// Todos los tokens y mezclas con su nombre (galería «Sistema» y TokensTests).
    static let catalogo: [MuestraToken] = [
        MuestraToken(nombre: "bg", token: "--bg", color: bg),
        MuestraToken(nombre: "bgSunk", token: "--bg-sunk", color: bgSunk),
        MuestraToken(nombre: "surface", token: "--surface", color: surface),
        MuestraToken(nombre: "surface2", token: "--surface-2", color: surface2),
        MuestraToken(nombre: "line", token: "--line", color: line),
        MuestraToken(nombre: "lineSoft", token: "--line-soft", color: lineSoft),
        MuestraToken(nombre: "lineStrong", token: "--line-strong", color: lineStrong),
        MuestraToken(nombre: "text", token: "--text", color: text),
        MuestraToken(nombre: "text2", token: "--text-2", color: text2),
        MuestraToken(nombre: "text3", token: "--text-3", color: text3),
        MuestraToken(nombre: "accent", token: "--accent", color: accent),
        MuestraToken(nombre: "onAccent", token: "--on-accent", color: onAccent),
        MuestraToken(nombre: "accentInk", token: "--accent-ink", color: accentInk),
        MuestraToken(nombre: "accentEdge", token: "--accent-edge", color: accentEdge),
        MuestraToken(nombre: "accentWash", token: "--accent-wash", color: accentWash),
        MuestraToken(nombre: "live", token: "--live", color: live),
        MuestraToken(nombre: "liveInk", token: "--live-ink", color: liveInk),
        MuestraToken(nombre: "ok", token: "--ok", color: ok),
        MuestraToken(nombre: "okInk", token: "--ok-ink", color: okInk),
        MuestraToken(nombre: "weak", token: "--weak", color: weak),
        MuestraToken(nombre: "weakInk", token: "--weak-ink", color: weakInk),
        MuestraToken(nombre: "fail", token: "--fail", color: fail),
        MuestraToken(nombre: "failInk", token: "--fail-ink", color: failInk),
        MuestraToken(nombre: "glass", token: "--glass", color: glass),
        MuestraToken(nombre: "glassDense", token: "--glass-dense", color: glassDense),
        MuestraToken(nombre: "glassSolid", token: "--glass-solid", color: glassSolid),
        MuestraToken(nombre: "glassHi", token: "--glass-hi", color: glassHi),
        MuestraToken(nombre: "glassRim", token: "--glass-rim", color: glassRim),
        MuestraToken(nombre: "scrim", token: "--scrim", color: scrim),
        MuestraToken(nombre: "sombra", token: "--shadow-1", color: sombra),
        MuestraToken(nombre: "glassVideo", token: "--glass-video", color: glassVideo),
        MuestraToken(nombre: "glassVideoSolid", token: "--glass-video-solid", color: glassVideoSolid),
        MuestraToken(nombre: "onVideo", token: "--on-video", color: onVideo),
        MuestraToken(nombre: "onVideo2", token: "--on-video-2", color: onVideo2),
        MuestraToken(nombre: "veil", token: "--veil", color: veil),
        MuestraToken(nombre: "veilStrong", token: "--veil-strong", color: veilStrong),
        MuestraToken(nombre: "fail9SobreSurface", token: "color-mix(in oklab, var(--fail) 9%, var(--surface))", color: PalcoMezcla.fail9SobreSurface),
        MuestraToken(nombre: "liveCapsula", token: "color-mix(in oklab, var(--live) 86%, #000)", color: PalcoMezcla.liveCapsula),
        MuestraToken(nombre: "ok10SobreBgSunk", token: "color-mix(in oklab, var(--ok) 10%, var(--bg-sunk))", color: PalcoMezcla.ok10SobreBgSunk),
        MuestraToken(nombre: "ok10SobreSurface", token: "color-mix(in oklab, var(--ok) 10%, var(--surface))", color: PalcoMezcla.ok10SobreSurface),
        MuestraToken(nombre: "ok8SobreBg", token: "color-mix(in oklab, var(--ok) 8%, var(--bg))", color: PalcoMezcla.ok8SobreBg),
        MuestraToken(nombre: "weak10SobreBg", token: "color-mix(in oklab, var(--weak) 10%, var(--bg))", color: PalcoMezcla.weak10SobreBg),
    ]
}

/// Un color con nombre del catálogo.
struct MuestraToken: Sendable {
    let nombre: String
    let token: String
    let color: Color
}

/// Mezclas entre dos colores que usan los componentes de la web, ya resueltas en OKLab (a1 §2.3).
enum PalcoMezcla {
    /// `color-mix(in oklab, var(--fail) 9%, var(--surface))` · apps/web/src/features/sources/sources.css:85
    static let fail9SobreSurface = Color(claro: 0xFDEEEC, oscuro: 0x22191D)
    /// `color-mix(in oklab, var(--live) 86%, #000)` · apps/web/src/player/player.css:623, apps/web/src/ui/Capsule.css:62, apps/web/src/ui/Capsule.css:101
    static let liveCapsula = Color(claro: 0xB1231A, oscuro: 0xD12E25)
    /// `color-mix(in oklab, var(--ok) 10%, var(--bg-sunk))` · apps/web/src/features/paste-hash/paste-hash.css:31
    static let ok10SobreBgSunk = Color(claro: 0xD6DEDA, oscuro: 0x05100C)
    /// `color-mix(in oklab, var(--ok) 10%, var(--surface))` · apps/web/src/features/search/search.css:99
    static let ok10SobreSurface = Color(claro: 0xE9F1EB, oscuro: 0x15211F)
    /// `color-mix(in oklab, var(--ok) 8%, var(--bg))` · apps/web/src/features/devices/devices.css:227
    static let ok8SobreBg = Color(claro: 0xE3E9E5, oscuro: 0x091311)
    /// `color-mix(in oklab, var(--weak) 10%, var(--bg))` · apps/web/src/features/health/health.css:119
    static let weak10SobreBg = Color(claro: 0xE9E3DD, oscuro: 0x171512)
}
