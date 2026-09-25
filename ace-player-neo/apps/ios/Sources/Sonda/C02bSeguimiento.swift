import Observation
import SwiftUI
import UIKit

// Canario C2, plan B (b-arquitectura §2.3): withObservationTracking en bucle dentro del
// UIHostingController, por si `Observations` no sirve. Se borra al cerrar la fase 0.

final class SondaHostingSeguimiento: UIHostingController<SondaRaizView> {
    private let estado: SondaEstadoVentana

    init(estado: SondaEstadoVentana) {
        self.estado = estado
        super.init(rootView: SondaRaizView(estado: estado))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("sin storyboard") }

    override func viewDidLoad() {
        super.viewDidLoad()
        vigilar()
    }

    /// Lee lo que importa; al primer cambio, aplica en el hilo principal y vuelve a vigilar.
    private func vigilar() {
        let estado = estado
        withObservationTracking {
            _ = (estado.estiloBarraEstado, estado.barraEstadoOculta, estado.inmersivo, estado.mascaraOrientacion)
            _ = estado.tema
        } onChange: {
            Task { @MainActor [weak self] in
                self?.aplicarEstadoVentana()
                self?.vigilar()
            }
        }
    }

    private func aplicarEstadoVentana() {
        view.window?.overrideUserInterfaceStyle = estado.tema.estiloUI
        setNeedsStatusBarAppearanceUpdate()
    }
}
