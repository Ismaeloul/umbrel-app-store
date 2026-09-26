import SwiftUI

/* El botón Directo del vídeo (`LiveButton` de PlayerSurface.tsx, `.player-live` de player.css; a4 §5.4): alto
   44, relleno 0 14 0 10, separación 6, píldora, 13/720 con +0,01 em. Cuatro modos: `off` apagado al 50 %;
   `live` relleno `#D12E25` con el punto BLANCO que late; `behind` borde interior 1,5 oro con el icono
   `directo` 18 oro; `resume` borde interior 1,5 blanco al 45 %. Va dentro de la cápsula de cristal. */

struct BotonDirectoVideo: View {
    let boton: BotonDirecto
    let conPrefijo: Bool
    let soloIcono: Bool
    let accion: () -> Void

    private var texto: String { (conPrefijo ? boton.prefijo : "") + boton.texto }

    var body: some View {
        Button(action: accion) {
            HStack(spacing: 6) {
                marca
                if !soloIcono {
                    Text(texto)
                        .estilo(EstiloTexto(tamano: 13, peso: 720, trackingEm: 0.01, altoLinea: 1))
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            .padding(.leading, soloIcono ? 13 : 10)
            .padding(.trailing, soloIcono ? 13 : 14)
            .frame(height: 44)
            .background(fondo)
            .contentShape(Capsule())
        }
        .buttonStyle(EstiloPulsar())
        .foregroundStyle(Palco.onVideo)
        .disabled(boton.modo == .off)
        .opacity(boton.modo == .off ? 0.5 : 1)
        .accessibilityLabel(boton.etiqueta)
        .accessibilityIdentifier(IDUI.botonDirecto)
    }

    @ViewBuilder private var marca: some View {
        if boton.modo == .behind {
            IconoPalco(.directo, tamano: 18).foregroundStyle(Palco.accent)
        } else if boton.modo == .live {
            PuntoBlanco()
        } else {
            PuntoDirecto()
        }
    }

    @ViewBuilder private var fondo: some View {
        switch boton.modo {
        case .live: Capsule().fill(PalcoMezcla.liveCapsula)
        case .behind: Capsule().strokeBorder(Palco.accent, lineWidth: 1.5)
        case .resume: Capsule().strokeBorder(Color.white.opacity(0.45), lineWidth: 1.5)
        case .off: Color.clear
        }
    }
}

/// El punto de directo en blanco (sobre el relleno rojo): caja 18, punto 8 y el aro que late a 1,45 (2 s).
private struct PuntoBlanco: View {
    var body: some View {
        ZStack {
            AroOnda(color: Palco.onVideo, escalaMaxima: 1.45, diametro: 12, grosor: 1.5)
            Circle().fill(Palco.onVideo).frame(width: 8, height: 8)
        }
        .frame(width: 18, height: 18)
        .clipped()
        .accessibilityHidden(true)
    }
}
