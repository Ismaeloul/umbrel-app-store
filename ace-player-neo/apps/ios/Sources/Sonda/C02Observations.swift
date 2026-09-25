import Observation
import SwiftUI
import UIKit

// Canario C2 (b-arquitectura §5.3): `Observations { … }` (Swift 6.2, iOS 26) dentro de un
// UIHostingController, tal como lo iba a usar App/HostingRaiz.swift (§2.3).
//
// RESULTADO: FALLA. Con Xcode 26.6 (Swift 6.2) el compilador se cae en IRGen al emitir el
// «thunk» del cierre @isolated(any) que recibe `Observations` (SyncCallEmission::setArgs →
// SmallVector «at maximum capacity»):
//   - con una tupla de cinco valores (el contrato): CI 36162945144;
//   - con un struct Sendable y Equatable en lugar de la tupla: CI 36163440026.
// Plan B aplicado: withObservationTracking en bucle (C02bSeguimiento.swift), que compila.
// Aquí quedan solo los tipos que comparten C2, C2b y C13. Se borra al cerrar la fase 0.

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
