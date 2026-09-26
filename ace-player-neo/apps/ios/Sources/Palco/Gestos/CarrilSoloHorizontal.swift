import SwiftUI
import UIKit

// Los carriles horizontales (carteles, tira de días) dentro de una página vertical (prueba de Isma en su
// iPhone: empezar sobre un partido movía el carril en vez de subir y bajar). Un detector en el propio carril
// arranca cuando el arrastre NO es claramente horizontal (`EjeGesto`) y el pan del carril espera a que falle:
// así lo vertical va siempre a la página y el carril solo se queda lo claramente horizontal.

extension View {
    /// Va en el CONTENIDO del ScrollView horizontal: el carril solo se queda los arrastres claramente horizontales.
    func carrilSoloHorizontal() -> some View {
        background(GuardaCarril().frame(width: 0, height: 0).accessibilityHidden(true))
    }
}

/// Sonda que pone el detector en el ScrollView que la contiene (una vez por carril).
struct GuardaCarril: UIViewRepresentable {
    func makeUIView(context: Context) -> Sonda { Sonda() }

    func updateUIView(_ sonda: Sonda, context: Context) {}

    final class Sonda: UIView {
        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard window != nil else { return }
            var vista = superview
            while let actual = vista, !(actual is UIScrollView) { vista = actual.superview }
            guard let carril = vista as? UIScrollView else { return }
            DetectorVertical.instalar(en: carril)
        }
    }
}

/// Arranca con los arrastres que no son claramente horizontales; no hace nada más que ganar al pan del carril.
/// No cancela toques (las tarjetas siguen recibiendo el suyo) y convive con cualquier otro gesto (la página).
final class DetectorVertical: UIPanGestureRecognizer, UIGestureRecognizerDelegate {
    static func instalar(en carril: UIScrollView) {
        let yaEsta: Bool = (carril.gestureRecognizers ?? []).contains { (g: UIGestureRecognizer) -> Bool in g is DetectorVertical }
        guard !yaEsta else { return }
        let detector = DetectorVertical(target: nil, action: nil)
        detector.delegate = detector
        detector.cancelsTouchesInView = false
        detector.delaysTouchesEnded = false
        detector.maximumNumberOfTouches = 1
        carril.addGestureRecognizer(detector)
        carril.panGestureRecognizer.require(toFail: detector)
    }

    func gestureRecognizerShouldBegin(_ reconocedor: UIGestureRecognizer) -> Bool {
        let t = translation(in: view)
        let v = velocity(in: view)
        return !EjeGesto.horizontal(dx: Double(t.x), dy: Double(t.y), vx: Double(v.x), vy: Double(v.y))
    }

    func gestureRecognizer(
        _ reconocedor: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otro: UIGestureRecognizer
    ) -> Bool {
        true
    }
}
