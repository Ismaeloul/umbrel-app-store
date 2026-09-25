import SwiftUI
import UIKit

/* Las pestañas vivas (b-arquitectura §2.4.6, M4; a2 §11, §12, §21.2). Cada pestaña visitada queda montada (su
   estado y su scroll se conservan solos, como `<Activity mode="hidden">` de la web); solo la actual se ve, recibe
   toques, está en el árbol de accesibilidad y tiene `vistaActiva` (las ocultas paran sondeos y relojes).

   Cambio de pestaña (a2 §11): la que sale se funde en 340 ms sin moverse; la que entra se funde y llega desde +16
   (adelante) o −16 (atrás). Reducido: fundido de 120 ms. Encima del teatro, la capa entera sigue a
   `TransicionTeatro` (se funde en la ida, entra desde −16 en la vuelta y sigue al dedo con el borde).

   Tocar la pestaña activa (decisión 3) sube su vista: la pantalla lo hace con `Navegador.subirArriba`; además,
   aquí se sube la vista desplazable que la pantalla marcó con `.subeConLaBarraDeEstado(true)` (a2 §27.5), para
   que funcione aunque la pantalla no escuche el contador. */

struct CapaPestanas: View {
    @Environment(Navegador.self) private var navegador
    @Environment(TransicionTeatro.self) private var transicion
    @Environment(CicloVida.self) private var cicloVida
    @Environment(\.movimientoReducido) private var reducido
    @State private var mostrada: Pestana?
    @State private var saliendo: Pestana?

    var body: some View {
        let actual: Pestana = mostrada ?? navegador.pestana
        let despierta: Bool = navegador.capa == nil && cicloVida.fase != .segundoPlano
        ZStack(alignment: .topLeading) {
            ForEach(Pestana.allCases) { p in
                if navegador.visitadas.contains(p) {
                    PantallaPestana(pestana: p)
                        .modifier(EstadoPestana(activa: p == actual, despierta: despierta,
                                                desplazamiento: desplazamiento(p, actual: actual)))
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .opacity(transicion.opacidadDebajo)
        .offset(x: transicion.entradaDebajo)
        .allowsHitTesting(navegador.capa == nil)
        .accessibilityHidden(navegador.capa != nil && !transicion.activa)
        .onChange(of: navegador.pestana, initial: true) { _, nueva in cambiar(a: nueva) }
        .onChange(of: navegador.subirArriba) { _, _ in SubirArriba.visible() }
    }

    /// Las ocultas esperan a ±16 del lado por el que entrarán; la que sale y la visible, a 0.
    private func desplazamiento(_ p: Pestana, actual: Pestana) -> Double {
        if p == actual || p == saliendo || reducido { return 0 }
        return p.indice > actual.indice ? 16 : -16
    }

    private func cambiar(a nueva: Pestana) {
        guard let antes = mostrada else {
            mostrada = nueva  // primer pintado: sin animación
            return
        }
        guard antes != nueva else { return }
        saliendo = antes
        withAnimation(Movimiento.vista(reducido)) {
            mostrada = nueva
        } completion: {
            if mostrada == nueva { saliendo = nil }
        }
    }
}

/// Visible o no, y el entorno de cada pestaña.
private struct EstadoPestana: ViewModifier {
    let activa: Bool
    let despierta: Bool
    let desplazamiento: Double

    func body(content: Content) -> some View {
        content
            .environment(\.vistaActiva, activa && despierta)
            .opacity(activa ? 1 : 0)
            .offset(x: desplazamiento)
            .allowsHitTesting(activa)
            // Las ocultas fuera del árbol de accesibilidad (XCUITest y VoiceOver): con solo `accessibilityHidden`
            // se seguía viendo la pestaña oculta (CI 36175911002); como elemento que ignora a sus hijos y oculto,
            // no queda nada que ver.
            .accessibilityElement(children: activa ? .contain : .ignore)
            .accessibilityHidden(!activa)
            .zIndex(activa ? 1 : 0)
    }
}

/// La pantalla de cada pestaña.
private struct PantallaPestana: View {
    let pestana: Pestana

    var body: some View {
        switch pestana {
        case .agenda: AgendaView()
        case .canales: CanalesView()
        case .buscar: BuscarView()
        case .ajustes: AjustesView()
        }
    }
}

/// Sube la vista desplazable que se ve: la única con `scrollsToTop` (la sonda de a2 §27.5 se lo pone a la de la
/// pestaña visible y se lo quita al resto). Sin sonda no hace nada: la pantalla sube con `subirArriba`.
@MainActor enum SubirArriba {
    static func visible() {
        guard let vista = vistaVisible() else { return }
        let arriba = CGPoint(x: vista.contentOffset.x, y: -vista.adjustedContentInset.top)
        vista.setContentOffset(arriba, animated: true)
    }

    /// La vista desplazable vertical que se ve (la de `scrollsToTop`), si la hay.
    static func vistaVisible() -> UIScrollView? {
        guard let ventana = Instantanea.ventanaClave() else { return nil }
        return buscar(en: ventana)
    }

    private static func buscar(en vista: UIView) -> UIScrollView? {
        if let desplazable = vista as? UIScrollView, desplazable.scrollsToTop, !desplazable.isHidden,
            desplazable.window != nil, desplazable.contentSize.height > desplazable.bounds.height
        {
            return desplazable
        }
        for hija in vista.subviews {
            if let hallada = buscar(en: hija) { return hallada }
        }
        return nil
    }
}
