import SwiftUI

/// `<EmptyState>` de la web (a1 §10.23; ui/EmptyState.css): arte de 104 (dibujo de 120), título 22/800/125
/// (−0,02 em, lh 1,25) centrado, texto 15 en `--text-2` (44 ch como mucho) y acciones SIEMPRE (fila centrada
/// que salta, separación 8). Rejilla centrada con separación 12 y relleno 32 20.
struct EstadoVacio<Acciones: View>: View {
    let titulo: String
    let texto: String?
    let error: Bool
    let acciones: Acciones

    init(titulo: String, texto: String? = nil, error: Bool = false, @ViewBuilder acciones: () -> Acciones) {
        self.titulo = titulo
        self.texto = texto
        self.error = error
        self.acciones = acciones()
    }

    var body: some View {
        VStack(spacing: 12) {
            ArteVacio(error: error).frame(width: 104, height: 104).padding(.bottom, 8)
            Text(titulo)
                .estilo(.tituloVacio)
                .foregroundStyle(Palco.text)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            if let texto {
                Text(texto)
                    .estilo(.cuerpo)
                    .foregroundStyle(Palco.text2)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 44 * 15 * 0.52)  // 44ch ≈ 44 × ancho del «0» a 15 pt
            }
            Flujo(horizontal: 8, vertical: 8, alineacion: .center) { acciones }
                .padding(.top, 8)
        }
        .padding(.vertical, 32)
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity)
    }
}

/// El arte del vacío (viewBox 120): líneas y círculo r 31 en `--line` (2,5), lente r 25 oro lavado con borde
/// oro al 50 % (1,5) y el «play» en `--accent-ink`; en error, lente roja y aspa `--fail` de 3.
private struct ArteVacio: View {
    let error: Bool

    var body: some View {
        Canvas { contexto, tamano in
            let e = tamano.width / 120
            ArteVacio.pintar(&contexto, e: e, error: error)
        }
        .accessibilityHidden(true)
    }

    private static func pintar(_ contexto: inout GraphicsContext, e: CGFloat, error: Bool) {
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * e, y: y * e) }
        var lineas = Path()
        lineas.move(to: p(60, 4))
        lineas.addLine(to: p(60, 30))
        lineas.move(to: p(60, 90))
        lineas.addLine(to: p(60, 116))
        lineas.addEllipse(in: CGRect(x: 29 * e, y: 29 * e, width: 62 * e, height: 62 * e))
        contexto.stroke(lineas, with: .color(Palco.line), lineWidth: 2.5 * e)
        let lente = Path(ellipseIn: CGRect(x: 35 * e, y: 35 * e, width: 50 * e, height: 50 * e))
        contexto.fill(lente, with: .color(error ? Palco.fail.opacity(0.12) : Palco.accentWash))
        contexto.stroke(lente, with: .color(error ? Palco.fail.opacity(0.4) : Palco.accentEdge.opacity(0.5)), lineWidth: 1.5 * e)
        if error {
            var aspa = Path()
            aspa.move(to: p(51, 51))
            aspa.addLine(to: p(69, 69))
            aspa.move(to: p(69, 51))
            aspa.addLine(to: p(51, 69))
            contexto.stroke(aspa, with: .color(Palco.fail), style: StrokeStyle(lineWidth: 3 * e, lineCap: .round))
        } else {
            // M55 49.5v21a1.6 1.6 0 0 0 2.4 1.4l17-10.5a1.6 1.6 0 0 0 0-2.8l-17-10.5a1.6 1.6 0 0 0-2.4 1.4z
            var play = Path()
            play.move(to: p(55, 49.5))
            play.addLine(to: p(55, 70.5))
            play.addQuadCurve(to: p(57.4, 71.9), control: p(55.2, 72.6))
            play.addLine(to: p(74.4, 61.4))
            play.addQuadCurve(to: p(74.4, 58.6), control: p(76.3, 60))
            play.addLine(to: p(57.4, 48.1))
            play.addQuadCurve(to: p(55, 49.5), control: p(55.2, 47.4))
            play.closeSubpath()
            contexto.fill(play, with: .color(Palco.accentInk))
        }
    }
}
