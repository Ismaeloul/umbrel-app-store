import SwiftUI
import UIKit

// Tocar la barra de estado sube la vista que se ve (b-arquitectura §2.2.8; a2 §24, §27.5). UIKit solo
// sube si en la ventana hay EXACTAMENTE una UIScrollView con `scrollsToTop = true`: cada ScrollView lleva
// esta sonda y solo la de la capa visible (sin hoja ni menú) vale `true`. Los carriles horizontales,
// siempre `false`.

extension View {
    /// Tocar la barra de estado sube esta vista (scrollsToTop solo en la pestaña visible, a2 §27.5).
    /// Va en el CONTENIDO del ScrollView.
    func subeConLaBarraDeEstado(_ activo: Bool) -> some View {
        background(SubeConLaBarra(activo: activo).frame(width: 0, height: 0).accessibilityHidden(true))
    }
}

/// Le dice a UIKit qué ScrollView sube al tocar la barra de estado.
struct SubeConLaBarra: UIViewRepresentable {
    var activo: Bool

    func makeUIView(context: Context) -> Sonda { Sonda() }

    func updateUIView(_ sonda: Sonda, context: Context) {
        sonda.activo = activo
        sonda.aplicar()
    }

    final class Sonda: UIView {
        var activo = false

        override func didMoveToWindow() {
            super.didMoveToWindow()
            aplicar()
        }

        func aplicar() {
            var vista = superview
            while let actual = vista, !(actual is UIScrollView) { vista = actual.superview }
            (vista as? UIScrollView)?.scrollsToTop = activo
        }
    }
}
