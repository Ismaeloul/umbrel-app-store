import AVFoundation
import Combine
import AVKit
import SwiftUI

/* Fila de abajo de los controles (a4 §5.2, §18): pausa grande 52 · [Detener] · −30 · silencio a la izquierda y
   [Directo · AirPlay · pantalla completa] a la derecha. Detener solo fuera de «compacto» con el vídeo ≥ 580;
   AirPlay solo si hay rutas (`AVRouteDetector`, decisión 6); a 375 con «Reanudar» y AirPlay el Directo pasa a
   solo icono antes que solaparse. Sin volumen deslizante (táctil). */

struct FilaInferiorControles: View {
    let variante: VarianteEscenario
    let video = EntornoVideo()
    @State private var hayRutas = false

    var body: some View {
        let foto = video.foto
        HStack(spacing: 8) {
            HStack(spacing: 8) {
                BotonPausaGrande(foto: foto) { video.alternar() }
                CapsulaVideo { izquierda(foto) }
            }
            Spacer(minLength: 0)
            CapsulaVideo { derecha(foto) }.layoutPriority(1)
        }
        .modifier(RutasAirPlay(hay: $hayRutas))
    }

    @ViewBuilder private func izquierda(_ foto: FotoEscenario) -> some View {
        if variante.detenerEnFila {
            BotonIcono(.stop, etiqueta: "Detener", variante: .video) { video.detener() }
                .accessibilityIdentifier(IDUI.botonDetener)
        }
        BotonRetroceder(habilitado: foto.puedeRetroceder) { video.retroceder() }
        let silenciado: Bool = video.silenciadoAhora
        BotonIcono(silenciado ? .mute : .vol, etiqueta: silenciado ? "Activar sonido" : "Silenciar", variante: .video) {
            video.alternarSilencio()
        }
        .accessibilityIdentifier(IDUI.botonSilencio)
    }

    @ViewBuilder private func derecha(_ foto: FotoEscenario) -> some View {
        let boton = EstadoEscenario.directo(foto)
        let ancho = variante.anchoDirecto(boton.modo)
        BotonDirectoVideo(
            boton: boton, conPrefijo: variante.prefijoDirecto,
            soloIcono: variante.directoSoloIcono(anchoDirecto: ancho, airPlay: hayRutas)
        ) { video.irAlDirecto() }
        if hayRutas {
            BotonAirPlay().frame(width: 44, height: 44)
        }
        BotonIcono(
            .full, etiqueta: video.presentacion.pantallaCompletaForzada ? "Salir de pantalla completa" : "Pantalla completa",
            variante: .video, pulsado: video.presentacion.pantallaCompletaForzada
        ) { video.alternarPantallaCompleta() }
        .accessibilityIdentifier(IDUI.botonPantallaCompleta)
    }
}

/// Pausa grande (`.player-play`): círculo de 52 blanco al 92 %, icono 24 relleno `#0C0C0E`, sombra
/// `0 6 18 −6 rgba(0,0,0,.6)`. Conectando: deshabilitado al 60 %, ⏸ y «Conectando…» (a4 §5.2).
private struct BotonPausaGrande: View {
    let foto: FotoEscenario
    let accion: () -> Void

    private var icono: NombreIcono { foto.quiereSonar || foto.conectando ? .pause : .play }
    private var etiqueta: String { foto.conectando ? "Conectando…" : (foto.quiereSonar ? "Pausar" : "Reproducir") }

    var body: some View {
        Button(action: accion) {
            IconoPalco(icono, tamano: 24, relleno: true)
                .foregroundStyle(Palco.text)
                .environment(\.colorScheme, .light)
                .frame(width: 52, height: 52)
                .background(Circle().fill(Color.white.opacity(0.92)))
                .sombra([CapaSombra(y: 6, desenfoque: 18, expansion: -6, color: Color.black.opacity(0.6))], forma: Circle())
        }
        .buttonStyle(EstiloPulsar(forma: AnyShape(Circle())))
        .disabled(foto.conectando)
        .opacity(foto.conectando ? 0.6 : 1)
        .accessibilityLabel(etiqueta)
        .accessibilityIdentifier(IDUI.botonPausa)
    }
}

/// −30 (`.player-back`): alto 44, relleno 0 12 0 8, separación 2, icono `back` 18 + «30» (13, cifra condensada).
/// Deshabilitado al 45 % salvo conexión activa, ya con imagen y fuera de la demo.
private struct BotonRetroceder: View {
    let habilitado: Bool
    let accion: () -> Void

    var body: some View {
        Button(action: accion) {
            HStack(spacing: 2) {
                IconoPalco(.back, tamano: 18)
                Num("30", tamano: 13)
            }
            .padding(.leading, 8)
            .padding(.trailing, 12)
            .frame(height: 44)
            .contentShape(Capsule())
        }
        .buttonStyle(EstiloPulsar())
        .foregroundStyle(Palco.onVideo)
        .disabled(!habilitado)
        .opacity(habilitado ? 1 : 0.45)
        .accessibilityLabel("Retroceder 30 segundos")
        .accessibilityIdentifier(IDUI.botonRetroceder)
    }
}

/// ¿Hay adónde mandar el vídeo por AirPlay? (`AVRouteDetector.multipleRoutesDetected`, por notificación).
private struct RutasAirPlay: ViewModifier {
    @Binding var hay: Bool
    @State private var detector = AVRouteDetector()

    /// El aviso de AVFoundation, entregado en el hilo principal.
    private var avisosRutas: AnyPublisher<Notification, Never> {
        NotificationCenter.default.publisher(for: .AVRouteDetectorMultipleRoutesDetectedDidChange)
            .receive(on: RunLoop.main)
            .eraseToAnyPublisher()
    }

    func body(content: Content) -> some View {
        content
            .onAppear {
                detector.isRouteDetectionEnabled = true
                hay = detector.multipleRoutesDetected
            }
            .onDisappear { detector.isRouteDetectionEnabled = false }
            .onReceive(avisosRutas) { _ in
                hay = detector.multipleRoutesDetected
            }
    }
}
