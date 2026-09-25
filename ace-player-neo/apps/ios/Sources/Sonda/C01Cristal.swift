import SwiftUI

// Canario C1 (b-arquitectura §5.3): glassEffect(_:in:), Glass.regular.tint(_:).interactive() y
// GlassEffectContainer, tal como los usará Palco/Cristal/Cristal.swift (§2.2.5).
// Se borra al cerrar la fase 0.

enum SondaTipoCristal: Sendable { case denso, regular, video, videoBoton }

enum SondaCristalPalco {
    static func vidrio(_ tipo: SondaTipoCristal) -> Glass {
        switch tipo {
        case .denso: .regular.tint(Color.white.opacity(0.9))
        case .regular: .regular.tint(Color.white.opacity(0.72))
        case .video: .regular.tint(Color.black.opacity(0.62))
        case .videoBoton: .regular.tint(Color.black.opacity(0.62)).interactive()
        }
    }

    static func solido(_ tipo: SondaTipoCristal) -> Color {
        switch tipo {
        case .denso, .regular: Color.white
        case .video, .videoBoton: Color.black
        }
    }
}

extension View {
    func sondaCristal(_ tipo: SondaTipoCristal, en forma: some Shape = Capsule()) -> some View {
        modifier(SondaModificadorCristal(tipo: tipo, forma: forma))
    }
}

private struct SondaModificadorCristal<Forma: Shape>: ViewModifier {
    let tipo: SondaTipoCristal
    let forma: Forma
    @Environment(\.accessibilityReduceTransparency) private var opaco

    func body(content: Content) -> some View {
        if opaco {
            content.background(SondaCristalPalco.solido(tipo), in: forma)
        } else {
            content.glassEffect(SondaCristalPalco.vidrio(tipo), in: forma)
        }
    }
}

struct SondaC1Cristal: View {
    var body: some View {
        GlassEffectContainer(spacing: 8) {
            HStack(spacing: 8) {
                Text("Agenda").padding(12).sondaCristal(.denso)
                Text("Vídeo").padding(12).sondaCristal(.videoBoton, en: Circle())
                Text("Hoja").padding(12).sondaCristal(.regular, en: RoundedRectangle(cornerRadius: 18))
            }
        }
    }
}
