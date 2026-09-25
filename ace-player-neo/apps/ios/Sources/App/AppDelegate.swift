import AVFoundation
import UIKit

/// Arranque UIKit (b-arquitectura §2.3, I0→M4). PROVISIONAL de la poda (fase 0.2): sustituye a
/// `AceNeoApp` con lo justo para enseñar la `RaizView` provisional. La fase 0.3b añade
/// `MigracionClaves`, las orientaciones de `EstadoVentana` y `ContenedorApp`.
///
/// La escena (`SceneDelegate`) la declara Config/Info.plist (`UISceneConfigurations`), no
/// `application(_:configurationForConnecting:options:)`: escribir `SceneDelegate.self` aquí tardaba
/// ~300 ms en tiparse y la alarma de la CI lo rechazaba (ejecuciones 36168823914 y 36169354654).
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions opciones: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // Reproducción de vídeo: suena con el silenciador puesto y sigue en segundo plano / PiP
        // (UIBackgroundModes: audio). Lo hacía `AceNeoApp.init`.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        return true
    }
}
