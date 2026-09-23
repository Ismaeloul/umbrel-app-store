import AVFoundation
import SwiftUI

@main
struct AceNeoApp: App {
    @State private var modelo = AppModel(entorno: .actual())
    @Environment(\.scenePhase) private var fase

    init() {
        // Reproducción de vídeo: suena con el silenciador puesto y sigue en
        // segundo plano / PiP (UIBackgroundModes: audio). El reproductor la
        // activa al empezar a reproducir.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
    }

    var body: some Scene {
        WindowGroup {
            if ModoEjecucion.testsUnitarios {
                // Anfitriona de los tests unitarios: no arranca red ni tiempo real.
                Color.clear
            } else {
                RootView()
                    .environment(modelo)
                    .tint(Tinta.acentoTinta)
            }
        }
        .onChange(of: fase) { _, nueva in
            guard !ModoEjecucion.testsUnitarios else { return }
            switch nueva {
            case .active: modelo.volvioAPrimerPlano()
            case .background: modelo.pasoASegundoPlano()
            default: break
            }
        }
    }
}
