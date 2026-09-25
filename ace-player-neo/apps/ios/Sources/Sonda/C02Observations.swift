import Observation
import SwiftUI
import UIKit

// Canario C2 (b-arquitectura §5.3): `Observations { … }` (Swift 6.2, iOS 26) con un elemento
// tupla dentro de un UIHostingController, tal como lo usará App/HostingRaiz.swift (§2.3).
//
// RESULTADO: VALE CON UN AJUSTE. Con Xcode 26.6 (Swift 6.2), si el cierre se anota
// `Observations { @MainActor in … }` (como estaba en §2.3) el compilador se cae en IRGen al
// emitir el «thunk» del cierre @isolated(any) (SyncCallEmission::setArgs → SmallVector «at
// maximum capacity»), da igual que el elemento sea una tupla (CI 36162945144) o un struct
// (CI 36163440026). SIN la anotación (el cierre hereda el aislamiento de la Task @MainActor)
// compila en Debug y Release con la tupla de cinco del contrato (CI 36164502581, rama
// nativa/i0-sonda) y aquí. El plan B (withObservationTracking, C02bSeguimiento.swift) también
// compila y queda de reserva. Se borra al cerrar la fase 0.

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
            // SIN «@MainActor in»: con la anotación, el compilador de Xcode 26.6 se cae.
            let cambios = Observations {
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
