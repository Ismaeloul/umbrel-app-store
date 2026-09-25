#if DEBUG
    import SwiftUI

    /* La imagen del reproductor en la demo (a7 §13.13; b-arquitectura §1.9, M2): el campo de fútbol de
       player/index.tsx › `DemoPicture` (SVG 160×90 con `slice`) dibujado en un `Canvas`, y encima el rótulo de
       PlayerSurface.tsx (`.player-demo`): el TÍTULO en mayúsculas y «reproducción simulada — en el Umbrel
       verías el stream real». Lo pinta el escenario (M6) cuando el motor simulado ya «tiene señal». */

    struct ImagenDemo: View {
        /// El canal que suena (el rótulo solo sale con título y sin mensaje del escenario).
        var titulo: String?
        var conRotulo = true
        /// Contenedor ≤ 480 pt de ancho: el título baja de 17 a 15 (`@container (max-width: 480px)`).
        var estrecho = true

        var body: some View {
            ZStack {
                CampoDemo()
                if conRotulo, let titulo { rotulo(titulo) }
            }
            .accessibilityHidden(true)
        }

        private func rotulo(_ titulo: String) -> some View {
            VStack(spacing: 2) {  // player.css: gap 2px
                Text(titulo.uppercased())
                    .estilo(EstiloTexto(tamano: estrecho ? 15 : 17, peso: 800, anchura: 125, trackingEm: 0.04, altoLinea: 1.45))
                Text(TextosDemo.rotuloImagen)
                    .estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45))
                    .opacity(0.9)
            }
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .shadow(color: .black.opacity(0.65), radius: 4, y: 1)  // text-shadow: 0 1px 8px rgb(0 0 0 / .65)
            .padding(.horizontal, 16)
        }
    }

    /// El `DemoPicture` de la web: césped con degradado, franjas y las líneas del campo, recortado como `slice`.
    private struct CampoDemo: View {
        private static let cespedArriba = RGB(r: 31.0 / 255, g: 107.0 / 255, b: 58.0 / 255)  // #1f6b3a
        private static let cespedAbajo = RGB(r: 15.0 / 255, g: 68.0 / 255, b: 36.0 / 255)  // #0f4424

        var body: some View {
            Canvas { contexto, tamano in
                // `preserveAspectRatio="xMidYMid slice"`: la escala que cubre todo, centrada.
                let escala = max(tamano.width / 160, tamano.height / 90)
                let dx = (tamano.width - 160 * escala) / 2
                let dy = (tamano.height - 90 * escala) / 2
                contexto.translateBy(x: dx, y: dy)
                contexto.scaleBy(x: escala, y: escala)
                Self.pintar(&contexto)
            }
        }

        private static func pintar(_ contexto: inout GraphicsContext) {
            let todo = CGRect(x: 0, y: 0, width: 160, height: 90)
            let degradado = Gradient(colors: [cespedArriba.color, cespedAbajo.color])
            contexto.fill(
                Path(todo), with: .linearGradient(degradado, startPoint: .zero, endPoint: CGPoint(x: 0, y: 90)))
            for franja in stride(from: 0.0, to: 160, by: 20) {  // patrón de 20 con una franja de 10 al 4,5 %
                contexto.fill(Path(CGRect(x: franja, y: 0, width: 10, height: 90)), with: .color(.white.opacity(0.045)))
            }
            var lineas = Path()
            lineas.addRect(CGRect(x: 8, y: 8, width: 144, height: 74))
            lineas.move(to: CGPoint(x: 80, y: 8))
            lineas.addLine(to: CGPoint(x: 80, y: 82))
            lineas.addEllipse(in: CGRect(x: 69, y: 34, width: 22, height: 22))
            lineas.addRect(CGRect(x: 8, y: 25, width: 20, height: 40))
            lineas.addRect(CGRect(x: 132, y: 25, width: 20, height: 40))
            contexto.stroke(lineas, with: .color(.white.opacity(0.7)), lineWidth: 0.6)
            contexto.fill(Path(ellipseIn: CGRect(x: 79.1, y: 44.1, width: 1.8, height: 1.8)), with: .color(.white))
        }
    }
#endif
