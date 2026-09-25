import AVFoundation
import UIKit

/// Arranque UIKit (b-arquitectura §2.3, I0→M4). PROVISIONAL de la poda (fase 0.2): sustituye a
/// `AceNeoApp` con lo justo para enseñar la `RaizView` provisional. La fase 0.3b añade
/// `MigracionClaves`, las orientaciones de `EstadoVentana` y `ContenedorApp`.
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

    func application(
        _ application: UIApplication, configurationForConnecting sesion: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        // Tipos escritos a mano: `delegateClass = SceneDelegate.self` tardaba 302 ms en tiparse (CI 36168823914).
        let rol: UISceneSession.Role = sesion.role
        let configuracion = UISceneConfiguration(name: "Principal", sessionRole: rol)
        let clase: AnyClass = SceneDelegate.self
        configuracion.delegateClass = clase
        return configuracion
    }
}
