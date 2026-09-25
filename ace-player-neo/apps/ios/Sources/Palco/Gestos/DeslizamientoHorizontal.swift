import SwiftUI
import UIKit

/// Pan horizontal con bloqueo de eje (8 pt) que convive con un ScrollView vertical, cede a los carriles
/// horizontales y al gesto del borde. Lo usan el panel de partidos (cambiar de día), la barra «emitiendo» y el vídeo.
/// (b-arquitectura §2.2.8; canario C3). Los umbrales de qué hace al soltar son puros (Core/Reglas/Gestos).
struct DeslizamientoHorizontal: UIGestureRecognizerRepresentable {
    var activo = true
    var cedeACarriles = true
    var cedeAlBorde = true
    var alMover: (_ dx: CGFloat) -> Void
    var alSoltar: (_ dx: CGFloat, _ dy: CGFloat, _ vx: CGFloat) -> Void

    /// Bloqueo de eje: el pan solo empieza si, pasados 8 pt, lo horizontal manda.
    static let bloqueoEje: CGFloat = 8

    final class Coordinador: NSObject, UIGestureRecognizerDelegate {
        var cedeAlBorde = true
        var cedeACarriles = true

        func gestureRecognizerShouldBegin(_ reconocedor: UIGestureRecognizer) -> Bool {
            guard let pan = reconocedor as? UIPanGestureRecognizer else { return true }
            let t = pan.translation(in: pan.view)
            let v = pan.velocity(in: pan.view)
            let dx = abs(t.x) > 0 ? abs(t.x) : abs(v.x)
            let dy = abs(t.y) > 0 ? abs(t.y) : abs(v.y)
            return dx > dy
        }

        /// El borde (volver) y los carriles horizontales van primero: este pan espera a que fallen.
        func gestureRecognizer(
            _ reconocedor: UIGestureRecognizer, shouldRequireFailureOf otro: UIGestureRecognizer
        ) -> Bool {
            if cedeAlBorde && otro is UIScreenEdgePanGestureRecognizer { return true }
            return cedeACarriles && Coordinador.esCarril(otro)
        }

        /// El ScrollView vertical espera a que este pan decida (así el eje queda bloqueado).
        func gestureRecognizer(
            _ reconocedor: UIGestureRecognizer, shouldBeRequiredToFailBy otro: UIGestureRecognizer
        ) -> Bool {
            guard let scroll = otro.view as? UIScrollView, otro === scroll.panGestureRecognizer else { return false }
            return !Coordinador.esCarril(otro)
        }

        func gestureRecognizer(
            _ reconocedor: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otro: UIGestureRecognizer
        ) -> Bool {
            false
        }

        /// El pan de un ScrollView que se desplaza en horizontal (carriles de carteles, tira de días…).
        static func esCarril(_ reconocedor: UIGestureRecognizer) -> Bool {
            guard let scroll = reconocedor.view as? UIScrollView, reconocedor === scroll.panGestureRecognizer else {
                return false
            }
            return scroll.contentSize.width > scroll.bounds.width + 1
        }
    }

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinador {
        Coordinador()
    }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.delegate = context.coordinator
        pan.maximumNumberOfTouches = 1
        return pan
    }

    func updateUIGestureRecognizer(_ reconocedor: UIPanGestureRecognizer, context: Context) {
        reconocedor.isEnabled = activo
        context.coordinator.cedeAlBorde = cedeAlBorde
        context.coordinator.cedeACarriles = cedeACarriles
    }

    func handleUIGestureRecognizerAction(_ reconocedor: UIPanGestureRecognizer, context: Context) {
        let t = reconocedor.translation(in: reconocedor.view)
        switch reconocedor.state {
        case .changed:
            alMover(t.x)
        case .ended, .cancelled:
            let v = reconocedor.velocity(in: reconocedor.view)
            alSoltar(t.x, t.y, v.x)
        default:
            break
        }
    }
}
