import SwiftUI
import UIKit

/* La capa de los vuelos (b-arquitectura §2.4.6 y §3.5, M4; z 45): los escudos que viajan de la tarjeta a la fila de
   equipos del teatro (y de vuelta). El vídeo no pasa por aquí: vuela el propio escenario (`alMini`). Cada pieza pasa de su marco de salida al de llegada con una escala uniforme por el
   ancho y el muelle estándar: la posición y la escala salen de `progreso` con funciones lineales, así que SwiftUI
   las anima con la misma curva. No recibe toques ni sale en VoiceOver. */

struct CapaVuelo: View {
    @Environment(TransicionTeatro.self) private var transicion

    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(transicion.vuelos) { vuelo in
                PiezaEnVuelo(vuelo: vuelo, progreso: transicion.progreso)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// Una pieza entre dos marcos de la ventana.
private struct PiezaEnVuelo: View {
    let vuelo: VueloPieza
    let progreso: Double

    var body: some View {
        let desde = vuelo.desde
        let hasta = vuelo.hasta
        let escalaFinal: Double = desde.width > 0 ? Double(hasta.width / desde.width) : 1
        let escala: Double = GeometriaVuelo.mezclar(1, escalaFinal, progreso)
        let x: Double = GeometriaVuelo.mezclar(Double(desde.minX), Double(hasta.minX), progreso)
        let y: Double = GeometriaVuelo.mezclar(Double(desde.minY), Double(hasta.minY), progreso)
        contenido
            .frame(width: desde.width, height: desde.height)
            .scaleEffect(CGFloat(escala), anchor: .topLeading)
            .offset(x: CGFloat(x), y: CGFloat(y))
            .opacity(opacidad)
    }

    @ViewBuilder private var contenido: some View {
        switch vuelo.contenido {
        case .foto(let foto): FotoVuelo(foto: foto)
        }
    }

    /// En la ida la foto deja paso a la fila de equipos de verdad en la segunda mitad.
    private var opacidad: Double {
        guard vuelo.fundirAlFinal else { return 1 }
        return progreso < 0.5 ? 1 : max(0, 2 - 2 * progreso)
    }
}

/// Una foto de la pantalla (`resizableSnapshotView`) dentro de SwiftUI, estirada a su marco.
struct FotoVuelo: UIViewRepresentable {
    let foto: UIView

    func makeUIView(context: Context) -> Marcofoto {
        let marco = Marcofoto()
        marco.poner(foto)
        return marco
    }

    func updateUIView(_ marco: Marcofoto, context: Context) { marco.poner(foto) }

    /// Contenedor que estira la foto a su tamaño (la foto viene con el de la pieza original).
    final class Marcofoto: UIView {
        private weak var actual: UIView?

        func poner(_ foto: UIView) {
            isUserInteractionEnabled = false
            isAccessibilityElement = false
            guard actual !== foto else { return }
            actual?.removeFromSuperview()
            addSubview(foto)
            actual = foto
            setNeedsLayout()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            actual?.frame = bounds
        }
    }
}
