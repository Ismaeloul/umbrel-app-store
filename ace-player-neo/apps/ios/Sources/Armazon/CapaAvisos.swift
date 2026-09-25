import SwiftUI

/* Los toasts (b-arquitectura §2.4.6, M4; a2 §8.2-§8.3, §16.3; notices/Toaster.tsx; z 60). Móvil: abajo y centrados,
   a `Maquetacion.bordeInferiorToasts` (safeB + 94 con la barra, + 178 con barra y mini, + 12 en el teatro), ancho
   `min(420, ancho − 24 − zonas)`, separación 8, el más viejo arriba. Tableta: abajo a la derecha (safeR + 20),
   ancho `min(420, ancho − 40)`. Entra desde opacidad 0, 12 más abajo y escala 0,98 con el muelle estándar; sale
   con opacidad 0 y 6 más abajo en 320 ms (`ease-out`). Mejora nativa (§0.4): cuando uno entra o sale, los demás
   se recolocan con el muelle estándar en vez de saltar. En inmersivo se apagan (340 ms) y no reciben toques
   (VoiceOver los sigue anunciando: lo hace `Avisos`). La línea de estado del teatro la pinta M6. */

struct CapaAvisos: View {
    let inmersivo: Bool
    @Environment(Avisos.self) private var avisos
    @Environment(Navegador.self) private var navegador
    @Environment(PresentacionReproductor.self) private var presentacion
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        let teatro: Bool = navegador.teatroVisible
        let barra: Bool = maquetacion.barraInferior(teatroVisible: teatro, inmersivo: inmersivo, emparejando: false)
        let mini: Bool = presentacion.miniVisible(teatroVisible: teatro, inmersivo: inmersivo)
        let abajo: Double = maquetacion.bordeInferiorToasts(barra: barra, mini: mini)
        let toasts: [Toast] = avisos.cola.toasts
        VStack(alignment: maquetacion.toastsALaDerecha ? .trailing : .center, spacing: S.s2) {
            ForEach(toasts) { toast in
                FilaToast(toast: toast)
                    .frame(maxWidth: CGFloat(maquetacion.anchoToasts))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alineacion)
        .padding(.bottom, CGFloat(abajo))
        .padding(.leading, CGFloat(maquetacion.seguras.izquierda + 12))
        .padding(.trailing, CGFloat(maquetacion.seguras.derecha + (maquetacion.toastsALaDerecha ? 20 : 12)))
        .animation(Movimiento.estandar(reducido), value: toasts.map(\.id))
        .opacity(inmersivo ? 0 : 1)
        .animation(Movimiento.vista(reducido), value: inmersivo)
        .allowsHitTesting(!inmersivo)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Avisos")
    }

    private var alineacion: Alignment { maquetacion.toastsALaDerecha ? .bottomTrailing : .bottom }
}

/// Un toast con su entrada, su salida y sus dos acciones.
private struct FilaToast: View {
    let toast: Toast
    @Environment(Avisos.self) private var avisos
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        let id = toast.id
        let avisos = self.avisos
        ToastVista(toast, alAccion: { avisos.ejecutarAccion(id) }, alCerrar: { avisos.cerrar(id) })
            .opacity(toast.saliendo ? 0 : 1)
            .offset(y: toast.saliendo && !reducido ? 6 : 0)
            .animation(Movimiento.salida, value: toast.saliendo)
            .transition(entrada)
    }

    /// `toast-entra` (a2 §8.3): opacidad 0, +12 y escala 0,98; reducido, solo fundido. La salida la hace
    /// `saliendo` (el modelo lo quita a los 320 ms).
    private var entrada: AnyTransition {
        let llega: AnyTransition = reducido
            ? .opacity : .opacity.combined(with: .offset(y: 12)).combined(with: .scale(scale: 0.98))
        return .asymmetric(insertion: llega, removal: .identity)
    }
}
