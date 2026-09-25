import Observation
import SwiftUI
import UIKit

// Canario C2 (b-arquitectura §5.3): `Observations { … }` (Swift 6.2, iOS 26) con un elemento
// tupla, dentro de un UIHostingController, tal como lo usará App/HostingRaiz.swift (§2.3).
// Plan B: withObservationTracking en bucle. Se borra al cerrar la fase 0.

enum SondaTemaApp: String, CaseIterable, Sendable {
    case sistema, claro, oscuro
    var estiloUI: UIUserInterfaceStyle {
        switch self {
        case .sistema: .unspecified
        case .claro: .light
        case .oscuro: .dark
        }
    }
}

@MainActor @Observable final class SondaEstadoVentana {
    var heroeBajoBarra = false
    var fondoOscuroArriba = false
    var inmersivo = false
    var mascaraOrientacion: UIInterfaceOrientationMask = [.portrait, .landscapeLeft, .landscapeRight]
    var tema: SondaTemaApp = .sistema

    var estiloBarraEstado: UIStatusBarStyle { heroeBajoBarra || fondoOscuroArriba ? .lightContent : .default }
    var barraEstadoOculta: Bool { inmersivo }
}

struct SondaRaizView: View {
    let estado: SondaEstadoVentana
    var body: some View { Color.clear }
}

final class SondaHostingObservations: UIHostingController<SondaRaizView> {
    private let estado: SondaEstadoVentana
    private var vigilante: Task<Void, Never>?

    init(estado: SondaEstadoVentana) {
        self.estado = estado
        super.init(rootView: SondaRaizView(estado: estado))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("sin storyboard") }

    override func viewDidLoad() {
        super.viewDidLoad()
        let estado = estado
        vigilante = Task { @MainActor [weak self] in
            let cambios = Observations { @MainActor in
                (estado.estiloBarraEstado, estado.barraEstadoOculta, estado.inmersivo, estado.mascaraOrientacion,
                 estado.tema)
            }
            for await _ in cambios { self?.aplicarEstadoVentana() }
        }
    }

    private func aplicarEstadoVentana() {
        view.window?.overrideUserInterfaceStyle = estado.tema.estiloUI
        setNeedsStatusBarAppearanceUpdate()
    }
}
