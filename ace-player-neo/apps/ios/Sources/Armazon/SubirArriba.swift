import UIKit

/* La vista desplazable de la pestaña que se ve (b-arquitectura §3.5, M4; a2 §12 y §27.5), para «tocar la pestaña
   activa sube» (respaldo de `Navegador.subirArriba`) y para el vigía de la barra superior.

   Las pestañas visitadas siguen montadas a opacidad 0 (sin `isHidden`) y UIKit deja `scrollsToTop = true` por
   defecto, así que buscar «la primera con scrollsToTop» podía dar con la Agenda oculta y subirla sin que nadie lo
   pidiera (perdía el scroll que conservaba). Aquí solo cuentan las que se ven de verdad (ninguna capa de encima
   transparente u oculta); si aun así quedan varias, gana la única marcada con `.subeConLaBarraDeEstado(true)`, y
   si sigue habiendo dudas no se toca nada. */

@MainActor enum SubirArriba {
    static func visible() {
        guard let vista = vistaVisible() else { return }
        let arriba = CGPoint(x: vista.contentOffset.x, y: -vista.adjustedContentInset.top)
        vista.setContentOffset(arriba, animated: true)
    }

    /// La vista desplazable vertical de la pestaña que se ve, si hay exactamente una.
    static func vistaVisible() -> UIScrollView? {
        guard let ventana = Instantanea.ventanaClave() else { return nil }
        var candidatas: [UIScrollView] = []
        reunir(ventana, &candidatas)
        if candidatas.count == 1 { return candidatas[0] }
        let marcadas: [UIScrollView] = candidatas.filter { marcada($0) }
        return marcadas.count == 1 ? marcadas[0] : nil
    }

    private static func reunir(_ vista: UIView, _ candidatas: inout [UIScrollView]) {
        guard !vista.isHidden, vista.alpha > 0.01 else { return }
        if let desplazable = vista as? UIScrollView, desplazable.scrollsToTop, vertical(desplazable), seVe(desplazable) {
            candidatas.append(desplazable)
        }
        for hija in vista.subviews { reunir(hija, &candidatas) }
    }

    /// Los carriles horizontales no cuentan (su sonda ya les quita `scrollsToTop`; esto es por si falta).
    private static func vertical(_ vista: UIScrollView) -> Bool {
        vista.contentSize.width <= vista.bounds.width + 1 || vista.contentSize.height > vista.bounds.height
    }

    /// En la ventana y sin ninguna capa de encima oculta o transparente (SwiftUI pinta la opacidad en las capas).
    private static func seVe(_ vista: UIView) -> Bool {
        guard vista.window != nil else { return false }
        var capa: CALayer? = vista.layer
        while let actual = capa {
            if actual.isHidden || actual.opacity < 0.01 { return false }
            capa = actual.superlayer
        }
        return true
    }

    /// Lleva dentro la sonda `.subeConLaBarraDeEstado(true)` (sin otra vista desplazable por medio).
    private static func marcada(_ vista: UIScrollView) -> Bool {
        tieneSondaActiva(vista, raiz: vista)
    }

    private static func tieneSondaActiva(_ vista: UIView, raiz: UIScrollView) -> Bool {
        for hija in vista.subviews {
            if let sonda = hija as? SubeConLaBarra.Sonda, sonda.activo { return true }
            if hija is UIScrollView && hija !== raiz { continue }
            if tieneSondaActiva(hija, raiz: raiz) { return true }
        }
        return false
    }
}
