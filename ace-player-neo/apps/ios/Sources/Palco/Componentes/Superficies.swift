import SwiftUI

// Superficies (a1 §10.4; ui/Surface.css). `Card` = tarjeta opaca (contenido que se lee); `Panel` de cristal =
// lo que flota. Las dos publican el radio interior concéntrico (`max(6, radio − relleno)`) en el entorno.

enum TonoPanel: Sendable { case normal, hundido, acento }

extension View {
    /// `<Card>`: `--surface`, borde interior `--line-soft`, `--shadow-1`. Por defecto radio xl 24 y relleno 16
    /// (Surface.tsx:49-50, a1 §10.4).
    func tarjeta(radio: CGFloat = R.xl, relleno: CGFloat = S.s4) -> some View {
        let forma = RoundedRectangle(cornerRadius: radio, style: .circular)
        return self
            .environment(\.radioInterior, R.interiorTarjeta(radio, relleno: relleno))
            .padding(relleno)
            .background(Palco.surface, in: forma)
            .bordeInterior(Palco.lineSoft, forma: forma)
            .sombra(.s1, forma: forma)
    }

    /// Bloque dentro de una tarjeta: `normal` = muestra (`--surface` + borde `--line-soft`), `hundido` = el
    /// fondo de la pantalla (`--bg`, a6 §0.1: radios de modo, listas guardadas, salud…), `acento` = oro lavado.
    func panel(_ tono: TonoPanel = .normal, radio: CGFloat = R.m, relleno: CGFloat = S.s3) -> some View {
        modifier(ModificadorPanel(tono: tono, radio: radio, relleno: relleno))
    }

    /// `<Panel material>` de cristal (a1 §10.4, §6): el cristal de la app + la sombra `--shadow-2` (vídeo: la suya).
    func panelCristal(_ tipo: TipoCristal = .regular, radio: CGFloat = R.l, relleno: CGFloat = S.s3) -> some View {
        let forma = RoundedRectangle(cornerRadius: radio, style: .circular)
        let video = tipo == .video || tipo == .videoBoton
        return self
            .environment(\.radioInterior, R.interiorTarjeta(radio, relleno: relleno))
            .padding(relleno)
            .foregroundStyle(video ? Palco.onVideo : Palco.text)
            .cristal(tipo, en: forma)
            .sombra(video ? .video : .s2, forma: forma)
            .modifier(IslaSiVideo(video: video))
    }

    /// Contenido sobre vídeo o héroe: los tokens del tema oscuro aunque la app esté en claro (a1 §0.2).
    func islaOscura() -> some View { environment(\.colorScheme, .dark) }
}

private struct ModificadorPanel: ViewModifier {
    let tono: TonoPanel
    let radio: CGFloat
    let relleno: CGFloat

    func body(content: Content) -> some View {
        let forma = RoundedRectangle(cornerRadius: radio, style: .circular)
        content
            .environment(\.radioInterior, R.interiorTarjeta(radio, relleno: relleno))
            .padding(relleno)
            .background(fondo, in: forma)
            .bordeInterior(borde, forma: forma)
    }

    private var fondo: Color {
        switch tono {
        case .normal: Palco.surface
        case .hundido: Palco.bg
        case .acento: Palco.accentWash
        }
    }

    private var borde: Color {
        switch tono {
        case .normal: Palco.lineSoft
        case .hundido: Color.clear
        case .acento: Palco.accentEdge.opacity(0.55)
        }
    }
}

/// El cristal de vídeo es una isla oscura (`color-scheme: dark` en `.glass--video`).
private struct IslaSiVideo: ViewModifier {
    let video: Bool
    @Environment(\.colorScheme) private var esquema

    func body(content: Content) -> some View {
        content.environment(\.colorScheme, video ? .dark : esquema)
    }
}
