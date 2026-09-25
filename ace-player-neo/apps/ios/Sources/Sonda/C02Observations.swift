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

/// Lo que vigila HostingRaiz, en un valor (una tupla hace caer al compilador).
struct SondaInstantaneaVentana: Equatable, Sendable {
    var estilo: Int
    var oculta: Bool
    var inmersivo: Bool
    var mascara: UInt
    var tema: SondaTemaApp
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
            // Primer intento (con una TUPLA de cinco): el compilador de Xcode 26.6 se cae en IRGen
            // (SyncCallEmission::setArgs, CI 36162945144). Segundo: un struct Sendable y Equatable.
            let cambios = Observations { @MainActor in
                SondaInstantaneaVentana(
                    estilo: estado.estiloBarraEstado.rawValue, oculta: estado.barraEstadoOculta, inmersivo: estado.inmersivo,
                    mascara: estado.mascaraOrientacion.rawValue, tema: estado.tema)
            }
            for await _ in cambios { self?.aplicarEstadoVentana() }
        }
    }

    private func aplicarEstadoVentana() {
        view.window?.overrideUserInterfaceStyle = estado.tema.estiloUI
        setNeedsStatusBarAppearanceUpdate()
    }
}
