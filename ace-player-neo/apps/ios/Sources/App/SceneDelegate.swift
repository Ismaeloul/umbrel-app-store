import UIKit

/// Ventana de la app (b-arquitectura §2.3, I0→M4): `HostingRaiz`, el tema de la ventana (llega también
/// a hojas y menús del sistema), los enlaces `aceneo://` en frío y en caliente (a `SesionApp`) y las
/// fases de la escena (a `CicloVida`, única fuente: sustituye a `scenePhase`).
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo sesion: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let escena = scene as? UIWindowScene else { return }
        let ventana = UIWindow(windowScene: escena)
        if ModoEjecucion.testsUnitarios {
            ventana.rootViewController = UIViewController()  // la app anfitriona no arranca nada
        } else {
            let contenedor = ContenedorApp.crear()
            ContenedorApp.actual = contenedor
            ventana.overrideUserInterfaceStyle = contenedor.preferencias.tema.estiloUI
            ventana.rootViewController = HostingRaiz(contenedor: contenedor)
            if let enlace = options.urlContexts.first?.url { contenedor.sesion.abrir(enlace: enlace) }
        }
        window = ventana
        ventana.makeKeyAndVisible()
    }

    func scene(_ scene: UIScene, openURLContexts contextos: Set<UIOpenURLContext>) {
        guard let enlace = contextos.first?.url else { return }
        ContenedorApp.actual?.sesion.abrir(enlace: enlace)
    }

    func sceneDidBecomeActive(_ scene: UIScene) { ContenedorApp.actual?.cicloVida.cambiar(a: .activa) }
    func sceneWillResignActive(_ scene: UIScene) { ContenedorApp.actual?.cicloVida.cambiar(a: .inactiva) }
    func sceneDidEnterBackground(_ scene: UIScene) { ContenedorApp.actual?.cicloVida.cambiar(a: .segundoPlano) }
    func sceneWillEnterForeground(_ scene: UIScene) { ContenedorApp.actual?.cicloVida.cambiar(a: .inactiva) }
}
