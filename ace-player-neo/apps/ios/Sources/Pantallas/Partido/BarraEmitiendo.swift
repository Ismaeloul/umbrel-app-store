import SwiftUI

/* La barra «Emitiendo» (`NowBar` de SourcesPanel.tsx, `.src-now` de sources.css; a4 §12.5): ‹ · «EMITIENDO» +
   canal + «Fuente 1 de 6 · desliza para cambiar» · ›. Deslizar en horizontal (el vertical queda para el
   scroll) mueve el texto `clamp(dx/3, −60, 60)` y, al soltar, izquierda = siguiente y derecha = anterior, en
   bucle por las visibles (háptica rígida). Las flechas solo si hay más de una. */

struct BarraEmitiendo: View {
    let titulo: String
    let numero: Int
    let total: Int
    let puedeCambiar: Bool
    let video = EntornoVideo()
    @Environment(\.movimientoReducido) private var reducido
    @State private var desplazamiento = DesplazamientoGesto()

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.l, style: .circular)
        HStack(spacing: 4) {
            if puedeCambiar { BotonIcono(.chevL, etiqueta: "Fuente anterior") { video.pasoFuente(-1) } }
            texto.modifier(SigueAlDedo(gesto: desplazamiento, eje: .horizontal))
            if puedeCambiar { BotonIcono(.chevR, etiqueta: "Fuente siguiente") { video.pasoFuente(1) } }
        }
        .padding(4)
        .frame(minHeight: 60)
        .background(Palco.surface, in: forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
        .clipShape(forma)
        .gesture(
            DeslizamientoHorizontal(
                activo: puedeCambiar,
                alMover: { dx in desplazamiento.valor = CGFloat(Self.arrastreTexto(Double(dx))) },
                alSoltar: { dx, dy, vx in soltar(dx: dx, dy: dy, vx: vx) }))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.barraEmitiendo)
    }

    private var texto: some View {
        VStack(spacing: 0) {
            Text("Emitiendo")
                .estilo(EstiloTexto(tamano: 11, peso: 650, trackingEm: 0.06, altoLinea: 1.45, mayusculas: true))
                .foregroundStyle(Palco.accentInk)
            Text(titulo)
                .estilo(EstiloTexto(tamano: 15, peso: 650, anchura: 88, altoLinea: 1.25))
                .foregroundStyle(Palco.text)
                .lineLimit(1)
            meta
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
        .frame(maxWidth: .infinity)
    }

    private var meta: some View {
        let estilo = EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.45)
        return HStack(spacing: 0) {
            Text("Fuente ").estilo(estilo)
            Num(String(numero), tamano: 12)
            Text(" de ").estilo(estilo)
            Num(String(total), tamano: 12)
            if puedeCambiar { Text(" · desliza para cambiar").estilo(estilo) }
        }
        .foregroundStyle(Palco.text2)
        .lineLimit(1)
        .accessibilityElement(children: .combine)
    }

    /// El texto sigue al dedo `clamp(dx / 3, −60, 60)` (`move` de SourcesPanel.tsx; el vídeo hace lo mismo).
    static func arrastreTexto(_ dx: Double) -> Double { max(-60, min(60, dx / 3)) }

    private func soltar(dx: CGFloat, dy: CGFloat, vx: CGFloat) {
        withAnimation(Movimiento.rapido(reducido)) { desplazamiento.valor = 0 }
        switch Deslizamiento.clasificar(dx: Double(dx), dy: Double(dy), vx: Double(vx), vy: 0, eje: .horizontal) {
        case .izquierda: video.pasoFuente(1)
        case .derecha: video.pasoFuente(-1)
        default: break
        }
    }
}
