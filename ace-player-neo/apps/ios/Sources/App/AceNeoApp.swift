import AVFoundation
import SwiftUI

@main
struct AceNeoApp: App {
    @State private var modelo = AppModel(entorno: .actual())
    @Environment(\.scenePhase) private var fase
    /// Ajustes › Apariencia: Sistema (por defecto), Claro u Oscuro.
    @AppStorage(Apariencia.clave) private var apariencia: Apariencia = .sistema

    init() {
        // Reproducción de vídeo: suena con el silenciador puesto y sigue en
        // segundo plano / PiP (UIBackgroundModes: audio). El reproductor la
        // activa al empezar a reproducir.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
    }

    /// Claro u oscuro a la fuerza solo para las capturas de la CI (nil: el del sistema).
    private static var esquemaForzado: ColorScheme? {
        switch ModoEjecucion.aparienciaForzada {
        case "oscuro": ColorScheme.dark
        case "claro": ColorScheme.light
        default: nil
        }
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
                    .preferredColorScheme(Self.esquemaForzado ?? apariencia.esquema)
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
