import SwiftUI

/* El inmersivo (b-arquitectura §2.4.6, M4; a2 §16.5 y §16.6.4; z 100): el vídeo a toda la ventana, fondo negro,
   por encima de barras, mini y avisos, y FUERA de cualquier gesto de volver (el borde izquierdo no existe aquí,
   a2 §2.4). Entra con el giro a horizontal del teatro o con ⛶ (`PresentacionReproductor.pantallaCompletaForzada`).
   El escenario y sus controles son de M6 (`EscenarioVideo(inmersivo: true)`). */

struct CapaInmersiva: View {
    let inmersivo: Bool
    @Environment(\.maquetacion) private var maquetacion

    var body: some View {
        ZStack {
            if inmersivo {
                ZStack {
                    EscenarioVideo(inmersivo: true)
                        .frame(width: maquetacion.ancho, height: maquetacion.alto)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                // `.player--immersive { background: #000 }` a sangre: bajo el indicador de inicio y en toda la ventana
                // aunque la medida vaya un paso por detrás al girar (Isma veía una línea blanca abajo).
                .background(Color.black.ignoresSafeArea())
                .ignoresSafeArea()
                .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
