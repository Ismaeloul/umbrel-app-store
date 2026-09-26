import SwiftUI

/* Dónde va el mini-reproductor (b-arquitectura §2.4.6, M4; a2 §7, a4 §19.1; z 41). El dibujo y los gestos son de M6
   (`MiniReproductor`); aquí, su marco (`Maquetacion.marcoMini`: móvil a 12 del borde y safeB + 82 del fondo;
   tableta abajo a la izquierda, ≤ 440) y su entrada: de opacidad 0 y 12 más abajo a su sitio con el muelle
   estándar (`player-sube`; reducido, fundido). Se monta cuando algo suena fuera del teatro y del inmersivo; durante
   la vuelta del teatro espera a que acabe y, si el vídeo ha volado hasta su sitio (`TransicionTeatro.alMini`),
   aparece ya colocado, sin entrada. */

struct CapaMini: View {
    let inmersivo: Bool
    @Environment(Navegador.self) private var navegador
    @Environment(PresentacionReproductor.self) private var presentacion
    @Environment(TransicionTeatro.self) private var transicion
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        let visible: Bool = presentacion.miniVisible(teatroVisible: navegador.teatroVisible, inmersivo: inmersivo)
            && !(transicion.activa && !transicion.ida)
        let marco: Marco = maquetacion.marcoMini()
        ZStack(alignment: .topLeading) {
            if visible {
                MiniReproductor()
                    .frame(width: marco.ancho, height: marco.alto)
                    .offset(x: marco.x, y: marco.y)
                    .transition(transicion.miniSinEntrada ? .identity : entrada)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .animation(Movimiento.estandar(reducido), value: visible)
    }

    /// `player-sube` (a2 §7): desde opacidad 0 y 12 más abajo; reducido, solo fundido.
    private var entrada: AnyTransition {
        reducido ? .opacity : .opacity.combined(with: .offset(y: 12))
    }
}
