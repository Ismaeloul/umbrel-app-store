import Observation
import SwiftUI
import UIKit

/// El controlador raíz (b-arquitectura §2.3, I0→M4; injerto de B1): lo que SwiftUI no deja pedir desde
/// una vista (barra de estado por zona, indicador de inicio, bordes diferidos en inmersivo, orientaciones
/// y el tema de la ventana). Vigila `EstadoVentana` y el tema con `Observations` y lo aplica.
final class HostingRaiz: UIHostingController<RaizView> {
    private let contenedor: ContenedorApp
    private var vigilante: Task<Void, Never>?

    init(contenedor: ContenedorApp) {
        self.contenedor = contenedor
        super.init(rootView: RaizView(contenedor: contenedor))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("sin storyboard") }

    override var preferredStatusBarStyle: UIStatusBarStyle { contenedor.estadoVentana.estiloBarraEstado }
    override var prefersStatusBarHidden: Bool { contenedor.estadoVentana.barraEstadoOculta }
    override var prefersHomeIndicatorAutoHidden: Bool { contenedor.estadoVentana.inmersivo }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge {
        contenedor.estadoVentana.inmersivo ? .all : []
    }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        contenedor.estadoVentana.mascaraOrientacion
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let estado = contenedor.estadoVentana
        let preferencias = contenedor.preferencias
        vigilante = Task { @MainActor [weak self] in
            // SIN «@MainActor in»: con la anotación el compilador de Xcode 26.6 se cae (§5.3.1, C2).
            let cambios = Observations {
                (estado.estiloBarraEstado, estado.barraEstadoOculta, estado.inmersivo, estado.mascaraOrientacion,
                 preferencias.tema)
            }
            for await _ in cambios { self?.aplicarEstadoVentana() }
        }
    }

    /// La primera vez, con la ventana ya puesta (la primera vuelta de `Observations` puede llegar antes).
    override func viewIsAppearing(_ animated: Bool) {
        super.viewIsAppearing(animated)
        aplicarEstadoVentana()
    }

    private func aplicarEstadoVentana() {
        view.window?.overrideUserInterfaceStyle = contenedor.preferencias.estiloVentana
        // En inmersivo, lo que SwiftUI no llegue a pintar (el giro, el borde bajo el indicador de inicio) es negro y
        // no el fondo claro del sistema: sin línea blanca abajo (Isma, 26-sep).
        let negro: Bool = contenedor.estadoVentana.inmersivo
        view.backgroundColor = negro ? .black : .systemBackground
        view.window?.backgroundColor = negro ? .black : nil
        setNeedsStatusBarAppearanceUpdate()
        setNeedsUpdateOfHomeIndicatorAutoHidden()
        setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
        setNeedsUpdateOfSupportedInterfaceOrientations()
    }
}
