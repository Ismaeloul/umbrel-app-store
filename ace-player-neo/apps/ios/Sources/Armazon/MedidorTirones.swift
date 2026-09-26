#if DEBUG
    import SwiftUI
    import UIKit

    /* `-AceNeoMedirTirones` (solo Debug, M4): cuenta los fotogramas que llegan tarde en el hilo principal, para
       medir en la CI los tirones al desplazar (prueba de Isma: la agenda y Canales iban a tirones). En el
       simulador `XCTOSSignpostMetric` solo da la duración del desplazamiento, no los tirones. Un `CADisplayLink`
       anota cada fotograma; uno que tarda más de 1,5 veces lo que tocaba es un tirón y suma lo que se pasó.
       XCUITest lo lee del valor de accesibilidad de `IDUI.medidorTirones`, calculado al preguntar (nada se
       repinta para publicarlo). */

    @MainActor final class ContadorTirones: NSObject {
        static let compartido = ContadorTirones()
        private var enlace: CADisplayLink?
        private var anterior: CFTimeInterval = 0
        private var fotogramas = 0
        private var tirones = 0
        private var msTirones: Double = 0
        private var segundos: Double = 0

        func arrancar() {
            guard enlace == nil else { return }
            let nuevo = CADisplayLink(target: self, selector: #selector(paso(_:)))
            nuevo.add(to: .main, forMode: .common)
            enlace = nuevo
        }

        @objc private func paso(_ e: CADisplayLink) {
            let esperado: CFTimeInterval = e.targetTimestamp - e.timestamp
            if anterior > 0 {
                let delta: CFTimeInterval = e.timestamp - anterior
                fotogramas += 1
                segundos += delta
                if esperado > 0 && delta > esperado * 1.5 {
                    tirones += 1
                    msTirones += (delta - esperado) * 1000
                }
            }
            anterior = e.timestamp
        }

        /// «fotogramas tirones ms segundos», separados por espacios.
        var texto: String {
            "\(fotogramas) \(tirones) \(Int((msTirones * 10).rounded())) \(Int((segundos * 1000).rounded()))"
        }
    }

    /// La vista de 1 × 1 que XCUITest lee.
    struct SondaTirones: UIViewRepresentable {
        func makeUIView(context: Context) -> Vista {
            ContadorTirones.compartido.arrancar()
            let vista = Vista()
            vista.isAccessibilityElement = true
            vista.accessibilityIdentifier = IDUI.medidorTirones
            vista.accessibilityLabel = "Medidor de tirones"
            return vista
        }

        func updateUIView(_ vista: Vista, context: Context) {}

        final class Vista: UIView {
            override var accessibilityValue: String? {
                get { ContadorTirones.compartido.texto }
                set {}  // swiftlint:disable:this unused_setter_value
            }
        }
    }
#endif
