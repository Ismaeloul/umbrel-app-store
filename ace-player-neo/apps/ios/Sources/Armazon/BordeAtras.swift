import SwiftUI
import UIKit

/* Volver deslizando desde el borde izquierdo (a2 §2.4 y §27.4; decisión 3 de Isma). Solo en la capa del teatro en
   vertical: nunca en las pestañas (robaría «cambiar de día», las pestañas de Canales y los carriles a sangre), ni
   en inmersivo, ni con una hoja abierta. `UIScreenEdgePanGestureRecognizer` (la franja la decide iOS, ≈ 20 pt):
   los pan horizontales del teatro («Emitiendo», el vídeo) exigen que falle este (`DeslizamientoHorizontal` de
   Palco cede al borde). */

struct BordeAtras: UIGestureRecognizerRepresentable {
    var activo: Bool
    var alMover: (_ dx: CGFloat) -> Void
    var alSoltar: (_ dx: CGFloat, _ vx: CGFloat) -> Void

    func makeUIGestureRecognizer(context: Context) -> UIScreenEdgePanGestureRecognizer {
        let reconocedor = UIScreenEdgePanGestureRecognizer()
        reconocedor.edges = .left
        reconocedor.isEnabled = activo
        return reconocedor
    }

    func updateUIGestureRecognizer(_ reconocedor: UIScreenEdgePanGestureRecognizer, context: Context) {
        reconocedor.isEnabled = activo
    }

    func handleUIGestureRecognizerAction(_ reconocedor: UIScreenEdgePanGestureRecognizer, context: Context) {
        let vista: UIView? = reconocedor.view?.window ?? reconocedor.view
        let dx: CGFloat = max(0, reconocedor.translation(in: vista).x)
        switch reconocedor.state {
        case .began, .changed: alMover(dx)
        case .ended: alSoltar(dx, reconocedor.velocity(in: vista).x)
        case .cancelled, .failed: alSoltar(0, 0)
        default: break
        }
    }
}
