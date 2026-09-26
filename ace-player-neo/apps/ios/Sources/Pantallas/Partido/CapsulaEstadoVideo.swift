import SwiftUI

/* La cápsula de estado sobre el vídeo (`.stage__status` de shell.css, a4 §7): abajo a la izquierda, UNA cosa a
   la vez (el aviso de 4,5 s de `Avisos.linea` o, sin aviso, el estado base del reproductor). Sube 60 (64 desde
   768) con los controles de abajo visibles; con el panel del vídeo no se ve; con los controles escondidos solo
   se queda si es un aviso o un error. Entra de 0,96 con fundido (340 ms) y sale con fundido (320 ms). */

struct CapsulaEstadoVideo: View {
    let variante: VarianteEscenario
    let relleno: Margenes
    let hayPanel: Bool
    let controlesAbajo: Bool
    @Environment(Avisos.self) private var avisos
    @Environment(\.movimientoReducido) private var reducido

    private var visible: (contenido: ContenidoLinea, repeticiones: Int)? {
        if let mensaje = avisos.linea.mensaje, !mensaje.saliendo { return (mensaje.contenido, mensaje.repeticiones) }
        return avisos.linea.base.map { ($0, 1) }
    }

    var body: some View {
        let actual = visible
        let tono = actual?.contenido.tono ?? .info
        let seQueda = controlesAbajo || tono == .warn || tono == .err
        ZStack(alignment: .bottomLeading) {
            if let actual, !hayPanel, seQueda {
                LineaEstadoVista(actual.contenido, repeticiones: actual.repeticiones, variante: .sobreVideo)
                    .id(actual.contenido)
                    .transition(.asymmetric(insertion: .opacity.combined(with: .scale(scale: 0.96)), removal: .opacity))
                    .accessibilityIdentifier(IDUI.capsulaEstado)
            }
        }
        .frame(maxWidth: 560, alignment: .leading)
        .padding(.leading, CGFloat(relleno.izquierda))
        .padding(.trailing, CGFloat(relleno.derecha))
        .padding(.bottom, CGFloat(relleno.abajo))
        .offset(y: controlesAbajo ? -CGFloat(variante.subidaEstado) : 0)
        .animation(Movimiento.estandar(reducido), value: controlesAbajo)
        .animation(.timingCurve(0.2, 0.7, 0.3, 1, duration: 0.34), value: actual?.contenido)
        .allowsHitTesting(false)
    }
}
