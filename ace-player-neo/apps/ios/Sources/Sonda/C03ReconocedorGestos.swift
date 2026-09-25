import SwiftUI
import UIKit

// Canario C3 (b-arquitectura §5.3): UIGestureRecognizerRepresentable con delegado (ceder al
// borde y a los carriles), tal como lo usará Palco/Gestos/DeslizamientoHorizontal.swift (§2.2.8).
// Plan B: UIViewRepresentable transparente que instala el reconocedor. Se borra al cerrar la fase 0.

struct SondaDeslizamientoHorizontal: UIGestureRecognizerRepresentable {
    var activo = true
    var cedeACarriles = true
    var cedeAlBorde = true
    var alMover: (_ dx: CGFloat) -> Void
    var alSoltar: (_ dx: CGFloat, _ dy: CGFloat, _ vx: CGFloat) -> Void

    final class Coordinador: NSObject, UIGestureRecognizerDelegate {
        var cedeAlBorde = true
        var cedeACarriles = true

        func gestureRecognizerShouldBegin(_ reconocedor: UIGestureRecognizer) -> Bool {
            guard let pan = reconocedor as? UIPanGestureRecognizer else { return true }
            let v = pan.velocity(in: pan.view)
            return abs(v.x) > abs(v.y)  // bloqueo de eje: solo horizontal
        }

        func gestureRecognizer(
            _ reconocedor: UIGestureRecognizer, shouldBeRequiredToFailBy otro: UIGestureRecognizer
        ) -> Bool {
            cedeAlBorde && otro is UIScreenEdgePanGestureRecognizer
        }

        func gestureRecognizer(
            _ reconocedor: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otro: UIGestureRecognizer
        ) -> Bool {
            !cedeACarriles
        }
    }

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinador {
        Coordinador()
    }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.delegate = context.coordinator
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

struct SondaC3Gestos: View {
    @State private var dx: CGFloat = 0

    var body: some View {
        ScrollView {
            Color.gray.frame(height: 900).offset(x: dx)
        }
        .gesture(SondaDeslizamientoHorizontal(alMover: { dx = $0 }, alSoltar: { _, _, _ in dx = 0 }))
    }
}
