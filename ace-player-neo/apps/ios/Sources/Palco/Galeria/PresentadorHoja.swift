import SwiftUI
import UIKit

/// Presenta un contenido de Palco en una hoja NATIVA con el alto medido (detent propio), el asa del sistema,
/// radio 24 y fondo opaco `--glass-solid` (decisión 5; a1 §10.18), desde UIKit. Solo lo usan la galería y el
/// laboratorio: la puerta de las hojas de la app es `Armazon/Hojas.swift` (M4, regla R5).
@MainActor enum PresentadorHoja {
    static func presentar<Contenido: View>(grande: Bool = false, @ViewBuilder _ contenido: () -> Contenido) {
        guard let arriba = VentanaPalco.arriba else { return }
        let hosting = UIHostingController(rootView: contenido())
        hosting.view.backgroundColor = UIColor(Palco.glassSolid)
        let ancho = arriba.view.bounds.width
        let medida = hosting.sizeThatFits(in: CGSize(width: ancho, height: .greatestFiniteMagnitude))
        let alto = medida.height
        if let hoja = hosting.sheetPresentationController {
            let medido = UISheetPresentationController.Detent.custom(identifier: .init("medido")) { _ in alto }
            hoja.detents = grande ? [.large()] : [medido]
            hoja.prefersGrabberVisible = true
            hoja.preferredCornerRadius = 24
        }
        arriba.present(hosting, animated: true)
    }

    static func cerrar() {
        VentanaPalco.arriba?.dismiss(animated: true)
    }
}
