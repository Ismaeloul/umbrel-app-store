import SwiftUI
import UIKit

/* La capa de toques del vídeo (`.player-hit` de la web; b-arquitectura §3.7 y decisión 3): reconocedores UIKit
   para que convivan sin retrasos ni choques.
   - toque: enseña o esconde los controles; exige que falle el doble toque (a4 §5.3);
   - doble toque: pantalla completa (mejora nativa);
   - arrastre con el eje bloqueado a 8 pt: hacia abajo minimiza (solo si `abajoMinimiza`) y a los lados cambia
     de fuente (solo si `ladosCambian`), siguiendo al dedo mientras dura. Cede siempre al borde izquierdo.
   La capa es invisible para VoiceOver (aria-hidden en la web): el camino accesible es ⋯. */

struct CapaToquesVideo: UIViewRepresentable {
    var abajoMinimiza: Bool
    var ladosCambian: Bool
    var alTocar: () -> Void
    var alDobleToque: () -> Void
    /// Mientras se arrastra: (dx, dy) ya con el eje bloqueado (el otro a 0).
    var alMover: (_ dx: CGFloat, _ dy: CGFloat) -> Void
    /// Al soltar: la dirección clasificada con los números de la web (`.ninguna` = vuelve a su sitio).
    var alSoltar: (_ direccion: DireccionGesto) -> Void

    @MainActor final class Coordinador: NSObject, UIGestureRecognizerDelegate {
        var capa: CapaToquesVideo
        private var eje: Eje = .ninguno
        private enum Eje { case ninguno, horizontal, vertical }

        init(_ capa: CapaToquesVideo) { self.capa = capa }

        @objc func toque() { capa.alTocar() }
        @objc func dobleToque() { capa.alDobleToque() }

        @objc func arrastre(_ pan: UIPanGestureRecognizer) {
            let t = pan.translation(in: pan.view?.window)  // la ventana: la capa se mueve con el dedo
            switch pan.state {
            case .began:
                eje = abs(t.x) >= abs(t.y) ? .horizontal : .vertical
            case .changed:
                if eje == .horizontal { capa.alMover(t.x, 0) } else { capa.alMover(0, max(0, t.y)) }
            case .ended:
                let v = pan.velocity(in: pan.view?.window)
                let dx = eje == .horizontal ? Double(t.x) : 0
                let dy = eje == .vertical ? Double(t.y) : 0
                let direccion = GestosTeatro.clasificar(dx: dx, dy: dy, vx: Double(v.x), vy: Double(v.y))
                capa.alSoltar(direccion)
                eje = .ninguno
            case .cancelled, .failed:
                capa.alSoltar(.ninguna)
                eje = .ninguno
            default:
                break
            }
        }

        /// El arrastre solo empieza en un eje permitido, decidido a los 8 pt (lo que mande entonces).
        func gestureRecognizerShouldBegin(_ reconocedor: UIGestureRecognizer) -> Bool {
            guard let pan = reconocedor as? UIPanGestureRecognizer else { return true }
            let t = pan.translation(in: pan.view?.window)  // la ventana: la capa se mueve con el dedo
            let v = pan.velocity(in: pan.view)
            let dx = abs(t.x) > 0 ? abs(t.x) : abs(v.x)
            let dy = abs(t.y) > 0 ? abs(t.y) : abs(v.y)
            if dx > dy { return capa.ladosCambian }
            return capa.abajoMinimiza && (t.y > 0 || v.y > 0)
        }

        /// El borde izquierdo (volver) va primero.
        func gestureRecognizer(
            _ reconocedor: UIGestureRecognizer, shouldRequireFailureOf otro: UIGestureRecognizer
        ) -> Bool {
            otro is UIScreenEdgePanGestureRecognizer
        }
    }

    func makeCoordinator() -> Coordinador { Coordinador(self) }

    func makeUIView(context: Context) -> UIView {
        let vista = UIView()
        vista.backgroundColor = .clear
        vista.isAccessibilityElement = false
        vista.accessibilityElementsHidden = true
        let doble = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinador.dobleToque))
        doble.numberOfTapsRequired = 2
        let simple = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinador.toque))
        simple.require(toFail: doble)
        let pan = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinador.arrastre(_:)))
        pan.maximumNumberOfTouches = 1
        pan.delegate = context.coordinator
        for reconocedor in [doble, simple, pan] as [UIGestureRecognizer] { vista.addGestureRecognizer(reconocedor) }
        return vista
    }

    func updateUIView(_ vista: UIView, context: Context) {
        context.coordinator.capa = self
    }
}
