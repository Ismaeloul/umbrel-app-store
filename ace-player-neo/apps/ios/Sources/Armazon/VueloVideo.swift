import SwiftUI

/* El hueco `.vuelo` del vídeo (b-arquitectura §2.6 y §3.5, M4): mientras la vuelta lleva el vídeo del escenario al
   mini, este hueco tiene la prioridad más alta (`PrioridadHueco.vuelo`) y se lleva la única `AVPlayerLayer`; al
   acabar se desmonta y la capa vuelve al hueco del mini. Es el ÚNICO `VistaVideo(` fuera de Pantallas (R5).
   Sin la superficie de M3 no se usa: plan B de §3.5 (el mini aparece al acabar la vuelta, sin volar). */

struct VueloVideo: View {
    let superficie: SuperficieVideo

    var body: some View {
        VistaVideo(superficie: superficie, prioridad: .vuelo)
            .clipShape(RoundedRectangle(cornerRadius: R.s, style: .circular))  // a4 §19.2: la imagen del mini, radio 10
            .accessibilityIgnoresInvertColors()
    }
}
