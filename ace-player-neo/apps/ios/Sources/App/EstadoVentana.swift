import Observation
import UIKit

/* Lo que la ventana pide al sistema (b-arquitectura §2.3, I0→M4): barra de estado por zona (a3 §4.7,
   pregunta A-3), indicador de inicio y bordes diferidos en inmersivo, orientaciones. Lo aplica
   `HostingRaiz` cuando cambia; las pantallas solo publican aquí. */

@MainActor @Observable final class EstadoVentana {
    var heroeBajoBarra = false  // la agenda con el héroe debajo de la barra de estado (M5 lo publica)
    var fondoOscuroArriba = false  // teatro, emparejar con cámara (M6/M7)
    var inmersivo = false  // M4 lo calcula con Maquetacion.inmersivo
    var mascaraOrientacion: UIInterfaceOrientationMask = [.portrait, .landscapeLeft, .landscapeRight]

    var estiloBarraEstado: UIStatusBarStyle { heroeBajoBarra || fondoOscuroArriba ? .lightContent : .default }
    var barraEstadoOculta: Bool { inmersivo }
}
