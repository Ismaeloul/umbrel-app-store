import SwiftUI
import UIKit

/* La capa de los vuelos (b-arquitectura §2.4.6 y §3.5, M4; z 45): los escudos que viajan de la tarjeta a la fila de
   equipos del teatro (y de vuelta) y el hueco `.vuelo` del vídeo que viaja del escenario al mini (`VueloVideo`,
   cuando M3 da la superficie). Cada pieza pasa de su marco de salida al de llegada con una escala uniforme por el
   ancho y el muelle estándar: la posición y la escala salen de `progreso` con funciones lineales, así que SwiftUI
   las anima con la misma curva. No recibe toques ni sale en VoiceOver. */

struct CapaVuelo: View {
    @Environment(TransicionTeatro.self) private var transicion

    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(transicion.vuelos) { vuelo in
                if case .cruce(let vieja, let nueva) = vuelo.contenido {
                    CruceEnVuelo(vuelo: vuelo, vieja: vieja, nueva: nueva, progreso: transicion.progreso)
                } else {
                    PiezaEnVuelo(vuelo: vuelo, progreso: transicion.progreso)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .opacity(transicion.opacidadVuelos)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/* El grupo de la web (a3 §4.8, `::view-transition-group` + `image-pair`): la caja va del marco de salida al de
   llegada (posición y ancho) y, dentro, cada imagen se estira al ANCHO del grupo conservando su proporción,
   anclada arriba; la vieja se apaga (1 − p) y la nueva se enciende (p) a la vez, en `plus-lighter` entre ellas
   (grupo aislado: `compositingGroup`), así la suma no «baja» a media animación. */
private struct CruceEnVuelo: View {
    let vuelo: VueloPieza
    let vieja: UIView
    let nueva: ContenidoPieza
    let progreso: Double

    var body: some View {
        let desde = vuelo.desde
        let hasta = vuelo.hasta
        let p: Double = min(1, max(0, progreso))
        let ancho: Double = GeometriaVuelo.mezclar(Double(desde.width), Double(hasta.width), progreso)
        let alto: Double = GeometriaVuelo.mezclar(Double(desde.height), Double(hasta.height), progreso)
        let x: Double = GeometriaVuelo.mezclar(Double(desde.minX), Double(hasta.minX), progreso)
        let y: Double = GeometriaVuelo.mezclar(Double(desde.minY), Double(hasta.minY), progreso)
        ZStack(alignment: .top) {
            FotoVuelo(foto: vieja)
                .frame(width: desde.width, height: desde.height)
                .scaleEffect(escala(ancho, desde.width), anchor: .top)
                .opacity(1 - p)
                .blendMode(.plusLighter)
            PiezaDeVerdad(pieza: nueva)
                .frame(width: hasta.width, height: hasta.height, alignment: .topLeading)
                .scaleEffect(escala(ancho, hasta.width), anchor: .top)
                .opacity(p)
                .blendMode(.plusLighter)
        }
        .compositingGroup()
        .frame(width: CGFloat(max(1, ancho)), height: CGFloat(max(1, alto)), alignment: .top)
        .offset(x: CGFloat(x), y: CGFloat(y))
    }

    private func escala(_ ancho: Double, _ base: CGFloat) -> CGFloat {
        base > 0 ? CGFloat(ancho) / base : 1
    }
}

/// La pieza de llegada, pintada con su vista de Palco (la tarjeta es una isla oscura; el teatro, del tema).
private struct PiezaDeVerdad: View {
    let pieza: ContenidoPieza

    var body: some View {
        switch pieza {
        case .escudos(let datos, let tamano):
            BloqueEscudos(datos, tamano: tamano).islaOscura()
        case .filaEquipos(let local, let visitante, let encendido):
            FilaEquiposPartido(local: local, visitante: visitante, encendido: encendido)
        }
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
        case .foto(let foto), .cruce(let foto, _): FotoVuelo(foto: foto)
        case .video(let superficie): VueloVideo(superficie: superficie)
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
