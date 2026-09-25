import SwiftUI

// Cristal (b-arquitectura §2.2.5; a1 §6; decisión 3 de Isma: Liquid Glass de verdad). El ÚNICO
// `.glassEffect(` de la app (regla R5). Con transparencia reducida (del sistema o de Ajustes) se pinta el
// sólido exacto de la web (`--glass-solid` / `--glass-video-solid`), que es donde la comparación con las
// capturas es estricta. Las cápsulas de directo y oro NO son cristal: llevan su color siempre (§0.4).
// Varias piezas de cristal juntas (barra, fila de botones del vídeo) van dentro de un `GlassEffectContainer`.

enum TipoCristal: Sendable { case denso, regular, video, videoBoton }

enum CristalPalco {
    /// Interruptor de rendimiento: false = sólido en las filas de listas largas.
    static let vidrioEnListas = true
    /// ÚNICO sitio del tinte (I2 lo calibra contra las capturas).
    static func vidrio(_ tipo: TipoCristal) -> Glass {
        switch tipo {
        case .denso: .regular.tint(Palco.glassDense)
        case .regular: .regular.tint(Palco.glass)
        case .video: .regular.tint(Palco.glassVideo)
        case .videoBoton: .regular.tint(Palco.glassVideo).interactive()
        }
    }
    static func solido(_ tipo: TipoCristal) -> Color {
        switch tipo {
        case .denso, .regular: Palco.glassSolid
        case .video, .videoBoton: Palco.glassVideoSolid
        }
    }
}

extension View {
    /// El ÚNICO `.glassEffect(` de la app. Con transparencia reducida (sistema o app) pinta el sólido exacto de la web.
    func cristal(_ tipo: TipoCristal, en forma: some Shape = Capsule()) -> some View {
        modifier(ModificadorCristal(tipo: tipo, forma: forma))
            .modifier(EsquemaCristal(video: tipo == .video || tipo == .videoBoton))
    }
}

/// El cristal de vídeo es oscuro siempre (`.glass--video { color-scheme: dark }`, base.css): Liquid Glass sigue
/// el esquema de su entorno y, en claro, el botón de vídeo salía gris sobre la imagen.
private struct EsquemaCristal: ViewModifier {
    let video: Bool
    @Environment(\.colorScheme) private var esquema

    func body(content: Content) -> some View {
        content.environment(\.colorScheme, video ? .dark : esquema)
    }
}

private struct ModificadorCristal<Forma: Shape>: ViewModifier {
    let tipo: TipoCristal
    let forma: Forma
    @Environment(\.cristalOpaco) private var opaco
    func body(content: Content) -> some View {
        if opaco {
            content.background(CristalPalco.solido(tipo), in: forma)
        } else {
            content.glassEffect(CristalPalco.vidrio(tipo), in: forma)
        }
    }
}
