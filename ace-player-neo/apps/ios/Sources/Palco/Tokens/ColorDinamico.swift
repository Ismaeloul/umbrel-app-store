import SwiftUI
import UIKit

// b-arquitectura §2.2.1. Lo escribe I0 en la fase 0.1 porque el generado
// (ColoresPalco.generado.swift) lo necesita para compilar; desde aquí es de P.
// La extensión `RGB.color` llega con `RGB` (Core/Reglas/Color/ColorOKLab.swift, M2).

extension UIColor {
    convenience init(hex: UInt32, alfa: Double = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: CGFloat(alfa))
    }
}

extension Color {
    /// sRGB exacto de tokens.css; cambia con el tema de la ventana.
    init(claro: UInt32, oscuro: UInt32, alfaClaro: Double = 1, alfaOscuro: Double = 1) {
        self.init(
            uiColor: UIColor { rasgos in
                rasgos.userInterfaceStyle == .dark
                    ? UIColor(hex: oscuro, alfa: alfaOscuro) : UIColor(hex: claro, alfa: alfaClaro)
            })
    }

    init(hex: UInt32, alfa: Double = 1) {
        self.init(
            .sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255, opacity: alfa)
    }
}
