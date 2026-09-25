import SwiftUI
import UIKit

// Canario C13 (b-arquitectura §5.3): barra de estado, indicador de inicio, bordes diferidos y
// orientaciones pedidos por un UIHostingController con raíz SwiftUI, tal como lo hará
// App/HostingRaiz.swift (§2.3). Plan B: .statusBarHidden + .preferredColorScheme por zona.
// Se borra al cerrar la fase 0.

final class SondaHostingBarraEstado: UIHostingController<SondaRaizView> {
    private let estado: SondaEstadoVentana

    init(estado: SondaEstadoVentana) {
        self.estado = estado
        super.init(rootView: SondaRaizView(estado: estado))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("sin storyboard") }

    override var preferredStatusBarStyle: UIStatusBarStyle { estado.estiloBarraEstado }
    override var prefersStatusBarHidden: Bool { estado.barraEstadoOculta }
    override var prefersHomeIndicatorAutoHidden: Bool { estado.inmersivo }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { estado.inmersivo ? .all : [] }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { estado.mascaraOrientacion }

    func aplicar() {
        setNeedsStatusBarAppearanceUpdate()
        setNeedsUpdateOfHomeIndicatorAutoHidden()
        setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
        setNeedsUpdateOfSupportedInterfaceOrientations()
    }
}
