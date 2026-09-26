import SwiftUI
import UIKit

/// Pan horizontal que convive con un ScrollView vertical, cede a los carriles horizontales y al gesto del borde.
/// Lo usan el panel de partidos (cambiar de día), las pestañas de Canales y la barra «emitiendo».
/// (b-arquitectura §2.2.8; canario C3). Los umbrales de qué hace al soltar son puros (Core/Reglas/Gestos).
///
/// Prueba de Isma en su iPhone: la lista no subía ni bajaba hasta mover antes el dedo de lado. Antes el
/// ScrollView vertical ESPERABA a que este pan fallara (y este, a los carriles): mientras tanto no se desplazaba
/// nada. Ahora nadie espera a nadie: los dos pan empiezan a la vez y, si este arranca (el gesto es claramente
/// horizontal, `EjeGesto`), cancela el del ScrollView para que la página no se mueva en vertical. Un gesto
/// sobre todo vertical no lo arranca nunca, así que la página se desplaza desde el primer punto.
/// Mientras se decide el eje, la página puede haberse movido unos puntos en vertical: al arrancar este pan, la
/// lista vuelve (animada) a donde estaba al posar el dedo, así que el cambio de día o pestaña no la deja movida.
/// La coordinación la deciden los métodos del delegado (SwiftUI los respeta en los reconocedores de UIKit).
struct DeslizamientoHorizontal: UIGestureRecognizerRepresentable {
    var activo = true
    var cedeACarriles = true
    var cedeAlBorde = true
    var alMover: (_ dx: CGFloat) -> Void
    var alSoltar: (_ dx: CGFloat, _ dy: CGFloat, _ vx: CGFloat) -> Void

    final class Coordinador: NSObject, UIGestureRecognizerDelegate {
        var cedeAlBorde = true
        var cedeACarriles = true
        /// El pan del ScrollView vertical que se mueve a la vez (se cancela si este arranca).
        weak var desplazable: UIGestureRecognizer?
        /// El toque empezó dentro de un carril horizontal: el carril se lo queda.
        private var empiezaEnCarril = false
        /// La lista vertical bajo el dedo y dónde estaba al posarlo.
        private weak var listaAlPosar: UIScrollView?
        private var desplazamientoAlPosar: CGPoint = .zero

        func gestureRecognizer(_ reconocedor: UIGestureRecognizer, shouldReceive toque: UITouch) -> Bool {
            empiezaEnCarril = cedeACarriles && Coordinador.dentroDeCarril(toque.view)
            listaAlPosar = Coordinador.listaVertical(toque.view)
            desplazamientoAlPosar = listaAlPosar?.contentOffset ?? .zero
            return true
        }

        func gestureRecognizerShouldBegin(_ reconocedor: UIGestureRecognizer) -> Bool {
            guard let pan = reconocedor as? UIPanGestureRecognizer else { return true }
            guard !empiezaEnCarril else { return false }
            let t = pan.translation(in: pan.view)
            let v = pan.velocity(in: pan.view)
            return EjeGesto.horizontal(dx: Double(t.x), dy: Double(t.y), vx: Double(v.x), vy: Double(v.y))
        }

        /// Solo el borde (volver) va primero: este pan espera a que falle.
        func gestureRecognizer(
            _ reconocedor: UIGestureRecognizer, shouldRequireFailureOf otro: UIGestureRecognizer
        ) -> Bool {
            cedeAlBorde && otro is UIScreenEdgePanGestureRecognizer
        }

        /// Con el ScrollView vertical, a la vez (nadie espera; ver arriba). Con lo demás, uno u otro.
        func gestureRecognizer(
            _ reconocedor: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otro: UIGestureRecognizer
        ) -> Bool {
            guard Coordinador.esDesplazableVertical(otro) else { return false }
            desplazable = otro
            return true
        }

        /// Arranca el pan horizontal: el ScrollView vertical suelta este toque (deshabilitarlo lo reinicia y ya
        /// no recibe el dedo que está puesto).
        func soltarDesplazable() {
            guard let desplazable, desplazable.isEnabled else { return }
            desplazable.isEnabled = false
            desplazable.isEnabled = true
            devolverLista(desplazable.view as? UIScrollView)
        }

        /// Lo que la lista se movió en vertical antes de decidirse el eje, de vuelta (solo unos puntos).
        private func devolverLista(_ lista: UIScrollView?) {
            guard let lista, lista === listaAlPosar else { return }
            let movido: CGFloat = abs(lista.contentOffset.y - desplazamientoAlPosar.y)
            guard movido > 0.5, movido < 40 else { return }
            lista.setContentOffset(CGPoint(x: lista.contentOffset.x, y: desplazamientoAlPosar.y), animated: true)
        }

        static func esDesplazableVertical(_ reconocedor: UIGestureRecognizer) -> Bool {
            guard let scroll = reconocedor.view as? UIScrollView, reconocedor === scroll.panGestureRecognizer else {
                return false
            }
            return !esCarril(scroll)
        }

        /// Un ScrollView que se desplaza en horizontal (carriles de carteles, tira de días…).
        static func esCarril(_ scroll: UIScrollView) -> Bool {
            scroll.contentSize.width > scroll.bounds.width + 1
        }

        /// La primera lista vertical (no carril) que contiene la vista tocada.
        static func listaVertical(_ vista: UIView?) -> UIScrollView? {
            var actual = vista
            while let v = actual {
                if let scroll = v as? UIScrollView, !esCarril(scroll) { return scroll }
                actual = v.superview
            }
            return nil
        }

        static func dentroDeCarril(_ vista: UIView?) -> Bool {
            var actual = vista
            while let v = actual {
                if let scroll = v as? UIScrollView, esCarril(scroll) { return true }
                actual = v.superview
            }
            return false
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
        case .began:
            context.coordinator.soltarDesplazable()
            alMover(t.x)
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
