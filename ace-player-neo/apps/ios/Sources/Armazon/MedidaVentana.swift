import SwiftUI
import UIKit

/* La medida de la ventana para `Maquetacion` (b-arquitectura §2.4.6; a2 §15, a8 §9.3). Se lee de la VENTANA
   (tamaño y zonas seguras de verdad), no de un GeometryReader que ignore el área segura: así lo pide §5 (en la
   app vieja las zonas salían a 0 dentro de un contenedor que las ignoraba). Una UIView sin tamaño propio va de
   fondo de la raíz y avisa cuando cambian el tamaño (giro) o las zonas seguras. */

struct MedidaVentana: UIViewRepresentable {
    let alCambiar: @MainActor (Maquetacion) -> Void

    func makeUIView(context: Context) -> Sonda {
        let sonda = Sonda()
        sonda.alCambiar = alCambiar
        sonda.isUserInteractionEnabled = false
        sonda.isAccessibilityElement = false
        return sonda
    }

    func updateUIView(_ sonda: Sonda, context: Context) {
        sonda.alCambiar = alCambiar
        sonda.medir()
    }

    final class Sonda: UIView {
        var alCambiar: (@MainActor (Maquetacion) -> Void)?
        private var ultima: Maquetacion?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            medir()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            medir()
        }

        override func safeAreaInsetsDidChange() {
            super.safeAreaInsetsDidChange()
            medir()
        }

        /// Avisa (fuera de la actualización de la vista en curso) solo si algo cambió.
        func medir() {
            guard let ventana = window, ventana.bounds.width > 0 else { return }
            let medida = MedidaVentana.maquetacion(ventana)
            guard medida != ultima else { return }
            ultima = medida
            guard let aviso = alCambiar else { return }
            Task { @MainActor in aviso(medida) }
        }
    }

    /// Tamaño de la ventana entera y sus cuatro zonas seguras, en pt.
    static func maquetacion(_ ventana: UIWindow) -> Maquetacion {
        let zonas: UIEdgeInsets = ventana.safeAreaInsets
        let seguras = Margenes(arriba: Double(zonas.top), izquierda: Double(zonas.left),
                               abajo: Double(zonas.bottom), derecha: Double(zonas.right))
        return Maquetacion(ancho: Double(ventana.bounds.width), alto: Double(ventana.bounds.height), seguras: seguras)
    }
}
