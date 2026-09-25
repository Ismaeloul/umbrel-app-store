import AVFoundation
import UIKit

/// Arranque UIKit (b-arquitectura §2.3, I0→M4): la migración de claves antes de nada, la sesión de
/// audio y las orientaciones que pide `EstadoVentana`.
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
        MigracionClaves.ejecutar(UserDefaults.standard)
        // Vídeo: suena con el silenciador puesto y sigue en segundo plano / PiP (UIBackgroundModes: audio).
        let audio: AVAudioSession = AVAudioSession.sharedInstance()
        try? audio.setCategory(.playback, mode: .moviePlayback, policy: .longFormVideo, options: [])
        return true
    }

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?)
        -> UIInterfaceOrientationMask
    {
        let porDefecto: UIInterfaceOrientationMask = [.portrait, .landscapeLeft, .landscapeRight]
        guard let contenedor = ContenedorApp.actual else { return porDefecto }
        return contenedor.estadoVentana.mascaraOrientacion
    }
}
