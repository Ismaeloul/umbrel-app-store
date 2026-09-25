import SwiftUI
import UIKit

/// Ventana de la app (b-arquitectura §2.3, I0→M4). PROVISIONAL de la poda (fase 0.2): la ventana con la
/// `RaizView` provisional. La fase 0.3b pone `HostingRaiz`, el tema de la ventana, los enlaces
/// `aceneo://` (en frío y en caliente, a `SesionApp.abrir(enlace:)`) y las fases de `CicloVida`.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo sesion: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let escena = scene as? UIWindowScene else { return }
        let ventana = UIWindow(windowScene: escena)
        if ModoEjecucion.testsUnitarios {
            ventana.rootViewController = UIViewController()  // la app anfitriona no arranca nada
        } else {
            ventana.rootViewController = UIHostingController(rootView: RaizView())
        }
        window = ventana
        ventana.makeKeyAndVisible()
    }
}
