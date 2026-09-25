import SwiftUI

// Base de la primitiva `Flujo` (b-arquitectura §2.2.11), rescatada en la poda (fase 0.2, §1.11) de
// `DisposicionFlujo` (Design/Componentes.swift) sin cambiar cómo coloca. Ya lleva la firma del contrato;
// `alineacion` se guarda y de momento solo se coloca a la izquierda (`.leading`): P completa el resto.

/// Coloca los hijos en filas, saltando de línea cuando no caben (chips, pastillas).
struct Flujo: Layout {
    var horizontal: CGFloat
    var vertical: CGFloat
    var alineacion: HorizontalAlignment

    init(horizontal: CGFloat = 8, vertical: CGFloat = 8, alineacion: HorizontalAlignment = .leading) {
        self.horizontal = horizontal
        self.vertical = vertical
        self.alineacion = alineacion
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let ancho = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var altoFila: CGFloat = 0
        var anchoMaximo: CGFloat = 0
        for vista in subviews {
            let medida = vista.sizeThatFits(ProposedViewSize(width: ancho, height: nil))
            if x > 0 && x + medida.width > ancho {
                y += altoFila + vertical
                x = 0
                altoFila = 0
            }
            x += medida.width + horizontal
            altoFila = max(altoFila, medida.height)
            anchoMaximo = max(anchoMaximo, x - horizontal)
        }
        return CGSize(width: ancho.isFinite ? ancho : anchoMaximo, height: y + altoFila)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var altoFila: CGFloat = 0
        for vista in subviews {
            let medida = vista.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX && x + medida.width > bounds.maxX {
                y += altoFila + vertical
                x = bounds.minX
                altoFila = 0
            }
            vista.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(medida))
            x += medida.width + horizontal
            altoFila = max(altoFila, medida.height)
        }
    }
}
