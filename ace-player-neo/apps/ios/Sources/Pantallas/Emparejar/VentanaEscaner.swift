import SwiftUI

/* La ventana del escáner (a2 §22.3): el velo `rgba(0,0,0,.35)` sobre todo el cartel menos un rectángulo
   redondeado de 232 × 232 y radio 24 (relleno par-impar), y el marco de cuatro esquinas encima: arco de
   radio 24 + 14 pt rectos por cada lado, trazo 4 con puntas redondas. */

/// El velo con el agujero de la ventana (se rellena con `FillStyle(eoFill: true)`).
struct VeloVentana: Shape {
    var ventana: CGRect

    func path(in rect: CGRect) -> Path {
        var camino = Path(rect)
        camino.addRoundedRect(in: ventana, cornerSize: CGSize(width: 24, height: 24), style: .circular)
        return camino
    }
}

/// Las cuatro esquinas del marco sobre la ventana.
struct EsquinasMarco: Shape {
    var ventana: CGRect
    /// Escala alrededor del centro de la ventana (1 → 0,94 → 1 al leer un QR, a2 §22.3.1).
    var escala: CGFloat = 1
    var radio: CGFloat = 24  // a2 §22.3: el de la ventana
    var recto: CGFloat = 14  // a2 §22.3: 14 pt rectos por cada lado

    var animatableData: CGFloat {
        get { escala }
        set { escala = newValue }
    }

    func path(in rect: CGRect) -> Path {
        var camino = Path()
        let margenX: CGFloat = ventana.width * (1 - escala) / 2
        let margenY: CGFloat = ventana.height * (1 - escala) / 2
        let v = ventana.insetBy(dx: margenX, dy: margenY)
        let r = radio * escala
        let l = recto * escala
        esquina(&camino, desde: CGPoint(x: v.minX, y: v.minY + r + l), centro: CGPoint(x: v.minX + r, y: v.minY + r),
                inicio: 180, hasta: CGPoint(x: v.minX + r + l, y: v.minY))
        esquina(&camino, desde: CGPoint(x: v.maxX - r - l, y: v.minY), centro: CGPoint(x: v.maxX - r, y: v.minY + r),
                inicio: 270, hasta: CGPoint(x: v.maxX, y: v.minY + r + l))
        esquina(&camino, desde: CGPoint(x: v.maxX, y: v.maxY - r - l), centro: CGPoint(x: v.maxX - r, y: v.maxY - r),
                inicio: 0, hasta: CGPoint(x: v.maxX - r - l, y: v.maxY))
        esquina(&camino, desde: CGPoint(x: v.minX + r + l, y: v.maxY), centro: CGPoint(x: v.minX + r, y: v.maxY - r),
                inicio: 90, hasta: CGPoint(x: v.minX, y: v.maxY - r - l))
        return camino
    }

    /// Recto, cuarto de círculo en el sentido de las agujas y recto.
    private func esquina(_ camino: inout Path, desde: CGPoint, centro: CGPoint, inicio: Double, hasta: CGPoint) {
        camino.move(to: desde)
        camino.addArc(center: centro, radius: radio * escala, startAngle: .degrees(inicio), endAngle: .degrees(inicio + 90),
                      clockwise: false)
        camino.addLine(to: hasta)
    }
}

/// Velo + marco de la ventana (el color del marco lo decide el estado de la cámara).
struct VentanaEscaner: View {
    let ventana: CGRect
    let colorMarco: Color
    let marcoVisible: Bool
    let opacidadVelo: Double
    let escala: CGFloat

    var body: some View {
        ZStack {
            VeloVentana(ventana: ventana)
                .fill(Color.black.opacity(opacidadVelo), style: FillStyle(eoFill: true))
            if marcoVisible {
                EsquinasMarco(ventana: ventana, escala: escala)
                    .stroke(colorMarco, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
