import SwiftUI
import UIKit

// Cristal (b-arquitectura §2.2.5; a1 §6; decisión 3 de Isma: Liquid Glass de verdad). El ÚNICO
// `.glassEffect(` de la app (regla R5). Con transparencia reducida (del sistema o de Ajustes) se pinta el
// sólido exacto de la web (`--glass-solid` / `--glass-video-solid`), que es donde la comparación con las
// capturas es estricta. Las cápsulas de directo y oro NO son cristal: llevan su color siempre (§0.4).
// Varias piezas de cristal juntas (barra, fila de botones del vídeo) van dentro de un `GlassEffectContainer`.

/// `barra`: la barra de pestañas de la app, Liquid Glass de verdad (Isma: se transparenta y refracta como el
/// cristal de iOS 26, sin el velo de la web que la dejaba blanca en claro; en oscuro, igual).
enum TipoCristal: Sendable { case denso, regular, video, videoBoton, barra }

enum CristalPalco {
    /// Interruptor de rendimiento: false = sólido en las filas de listas largas.
    static let vidrioEnListas = true
    /// ÚNICO sitio del tinte (I2 lo calibra contra las capturas). En oscuro, el token tiñe el vidrio (casa con la
    /// web). En claro NO se tiñe: ningún tinte quitaba el reflejo verde/melocotón que Liquid Glass saca de la
    /// imagen de debajo (bloque 9 del banco, c0-cristal/); lo pone `velo(_:)` como la web.
    static func vidrio(_ tipo: TipoCristal) -> Glass {
        switch tipo {
        case .denso: .regular.tint(soloEnOscuro(Palco.glassDense))
        case .regular: .regular.tint(soloEnOscuro(Palco.glass))
        case .video: .regular.tint(Palco.glassVideo)
        case .videoBoton: .regular.tint(Palco.glassVideo).interactive()
        case .barra: .regular.interactive()
        }
    }
    /// El velo de la web encima del vidrio, solo en claro: `.glass { background: var(--glass) }` (72 %, denso
    /// 90 % de blanco) sobre lo desenfocado. Así el color de la imagen solo asoma lo que asoma en la web.
    static func velo(_ tipo: TipoCristal) -> Color {
        switch tipo {
        case .denso: soloEnClaro(Palco.glassDense)
        case .regular: soloEnClaro(Palco.glass)
        case .video, .videoBoton, .barra: Color.clear
        }
    }
    static func solido(_ tipo: TipoCristal) -> Color {
        switch tipo {
        case .denso, .regular, .barra: Palco.glassSolid
        case .video, .videoBoton: Palco.glassVideoSolid
        }
    }

    /// El token en claro y transparente en oscuro (y al revés): tintes y velos que solo cambian un tema.
    private static func soloEnClaro(_ token: Color) -> Color {
        Color(uiColor: UIColor { rasgos in
            rasgos.userInterfaceStyle == .dark ? UIColor.clear : UIColor(token).resolvedColor(with: rasgos)
        })
    }

    private static func soloEnOscuro(_ token: Color) -> Color {
        Color(uiColor: UIColor { rasgos in
            rasgos.userInterfaceStyle == .dark ? UIColor(token).resolvedColor(with: rasgos) : UIColor.clear
        })
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
            content
                .background(CristalPalco.velo(tipo), in: forma)
                .glassEffect(CristalPalco.vidrio(tipo), in: forma)
        }
    }
}
