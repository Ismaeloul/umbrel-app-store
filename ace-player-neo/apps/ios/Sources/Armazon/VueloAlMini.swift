import SwiftUI

/* El vídeo que vuela al mini (decisión 3; Isma, 26-sep: interactivo, como YouTube). `TransicionTeatro.alMini` va de
   0 (el vídeo en el teatro) a 1 (en el sitio del vídeo del mini), con el dedo al arrastrar el vídeo hacia abajo o
   con el muelle estándar al minimizar. Estos modificadores son lo único que lo lee: el escenario escala y baja
   hasta el vídeo del mini con el radio de su imagen, sus controles se van en el primer cuarto y la página y la
   franja negra se funden y dejan ver la pestaña de debajo. La geometría es pura (GeometriaVuelo). */

extension View {
    /// El escenario camino del mini. Va ANTES de `.piezaVuelo(.escenario, …)`: el marco publicado es el de su sitio.
    func escenarioAlMini() -> some View { modifier(EscenarioAlMini()) }

    /// Lo que rodea al vídeo se funde mientras va al mini; `rapido`: los controles, en el primer cuarto.
    func fundidoAlMini(rapido: Bool = false) -> some View { modifier(FundidoAlMini(rapido: rapido)) }

    /// Un fondo que se funde mientras el vídeo va al mini.
    func fondoAlMini(_ color: Color) -> some View { modifier(FondoAlMini(color: color)) }
}

/// Solo este modificador se vuelve a pintar a cada paso del dedo, no el escenario (si no, la capa de toques se
/// recrearía y el arrastre se cancelaría).
private struct EscenarioAlMini: ViewModifier {
    @Environment(TransicionTeatro.self) private var transicion

    func body(content: Content) -> some View {
        let t: TransformacionVuelo = transicion.transformacionAlMini
        let escala = CGFloat(max(0.01, t.escala))
        let radio = CGFloat(GeometriaVuelo.radioAlMini(transicion.alMini)) / escala
        content
            .clipShape(RoundedRectangle(cornerRadius: radio, style: .circular))
            .scaleEffect(escala, anchor: .topLeading)
            .offset(x: CGFloat(t.dx), y: CGFloat(t.dy))
    }
}

private struct FundidoAlMini: ViewModifier {
    let rapido: Bool
    @Environment(TransicionTeatro.self) private var transicion

    func body(content: Content) -> some View {
        let p: Double = transicion.alMini
        let opacidad: Double = rapido ? GeometriaVuelo.opacidadControlesAlMini(p) : GeometriaVuelo.opacidadTeatroAlMini(p)
        content.opacity(opacidad)
    }
}

private struct FondoAlMini: ViewModifier {
    let color: Color
    @Environment(TransicionTeatro.self) private var transicion

    func body(content: Content) -> some View {
        content.background(color.opacity(GeometriaVuelo.opacidadTeatroAlMini(transicion.alMini)))
    }
}
