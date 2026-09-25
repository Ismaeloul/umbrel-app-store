import SwiftUI

// Primitiva `Flujo` (b-arquitectura §2.2.11): `flex-wrap` de la web (chips, pastillas, acciones que saltan).
// Base rescatada en la poda de `DisposicionFlujo`; P añade la alineación de cada fila (izquierda, centro o
// derecha, como `justify-content`) y el centrado vertical dentro de la fila (`align-items: center`).

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

    /// Una fila: qué hijos lleva, su ancho y su alto.
    private struct Fila {
        var indices: [Int] = []
        var ancho: CGFloat = 0
        var alto: CGFloat = 0
    }

    private func filas(_ medidas: [CGSize], ancho: CGFloat) -> [Fila] {
        var resultado: [Fila] = []
        var actual = Fila()
        for (i, medida) in medidas.enumerated() {
            let conHueco = actual.indices.isEmpty ? medida.width : actual.ancho + horizontal + medida.width
            if !actual.indices.isEmpty && conHueco > ancho {
                resultado.append(actual)
                actual = Fila()
            }
            actual.ancho = actual.indices.isEmpty ? medida.width : actual.ancho + horizontal + medida.width
            actual.alto = max(actual.alto, medida.height)
            actual.indices.append(i)
        }
        if !actual.indices.isEmpty { resultado.append(actual) }
        return resultado
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let ancho = proposal.width ?? .infinity
        let medidas = subviews.map { $0.sizeThatFits(ProposedViewSize(width: ancho, height: nil)) }
        let lista = filas(medidas, ancho: ancho)
        let alto = lista.reduce(CGFloat(0)) { $0 + $1.alto } + vertical * CGFloat(max(0, lista.count - 1))
        let anchoMaximo = lista.map(\.ancho).max() ?? 0
        return CGSize(width: ancho.isFinite ? ancho : anchoMaximo, height: alto)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let medidas = subviews.map { $0.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil)) }
        var y = bounds.minY
        for fila in filas(medidas, ancho: bounds.width) {
            var x = bounds.minX + sobrante(fila.ancho, en: bounds.width)
            for i in fila.indices {
                let medida = medidas[i]
                let dy = (fila.alto - medida.height) / 2
                subviews[i].place(at: CGPoint(x: x, y: y + dy), proposal: ProposedViewSize(medida))
                x += medida.width + horizontal
            }
            y += fila.alto + vertical
        }
    }

    /// Desplazamiento de la fila según la alineación.
    private func sobrante(_ anchoFila: CGFloat, en ancho: CGFloat) -> CGFloat {
        let libre = max(0, ancho - anchoFila)
        if alineacion == .center { return libre / 2 }
        if alineacion == .trailing { return libre }
        return 0
    }
}
