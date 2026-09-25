#if DEBUG
    import SwiftUI
    import UIKit

    /// Enseña una pieza y, debajo, su caja medida frente a la de la web (Chrome, mismo build): verde si las dos
    /// medidas caen a ±1 pt, rojo si no. Así cada captura del banco se revisa sola.
    struct Medido<Contenido: View>: View {
        let web: CGSize?
        let contenido: Contenido
        @State private var caja: CGSize = .zero

        init(web ancho: CGFloat? = nil, _ alto: CGFloat? = nil, @ViewBuilder contenido: () -> Contenido) {
            if let ancho { self.web = CGSize(width: ancho, height: alto ?? 0) } else { self.web = nil }
            self.contenido = contenido()
        }

        private var casa: Bool {
            guard let web else { return true }
            let dx = abs(caja.width - web.width)
            let dy = web.height > 0 ? abs(caja.height - web.height) : 0
            return dx <= 1 && dy <= 1
        }

        var body: some View {
            VStack(alignment: .leading, spacing: 2) {
                contenido
                    .fixedSize()
                    .onGeometryChange(for: CGSize.self) { $0.size } action: { caja = $0 }
                Text(texto)
                    .font(Martian.fuente(10))
                    .foregroundStyle(casa ? Palco.okInk : Palco.failInk)
            }
        }

        private var texto: String {
            let propia = "\(Medido.pt(caja.width))×\(Medido.pt(caja.height))"
            guard let web else { return propia }
            let marca = casa ? "✓" : "✗"
            return "\(propia) · web \(Medido.pt(web.width))×\(Medido.pt(web.height)) \(marca)"
        }

        static func pt(_ v: CGFloat) -> String { String(format: "%.2f", Double(v)) }
    }
#endif
