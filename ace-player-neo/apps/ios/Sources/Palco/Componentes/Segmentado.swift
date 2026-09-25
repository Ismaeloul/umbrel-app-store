import SwiftUI

struct OpcionSegmento<Valor: Hashable>: Identifiable {
    var valor: Valor
    var titulo: String
    var icono: NombreIcono?
    var id: Valor { valor }
    /// Contador (`Num` 13 en `--text-3`), p. ej. «Para ti 8».
    var contador: Int? = nil
}

/// `<Segmented>` y `<Tabs>` de la web (a1 §10.17; ui/Segmented.css). Pista en cápsula `--line-soft` con
/// relleno 4 y columnas iguales (n × la opción más ancha, o todo el ancho con `bloque`); la «gota» (`--surface`
/// con su sombra) se desliza con el muelle estándar y el color del texto cambia al instante. Opción de 36 (zona
/// de 44), relleno lateral `clamp(8, 3vw, 16)` (≤ 380: 6 y separación 4). La háptica la pone quien llama.
struct Segmentado<Valor: Hashable>: View {
    let opciones: [OpcionSegmento<Valor>]
    @Binding var seleccion: Valor
    let bloque: Bool
    let etiqueta: String
    let pestanas: Bool
    let alCambiar: ((Valor) -> Void)?
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.movimientoReducido) private var reducido
    @State private var anchoFila: CGFloat = 0

    init(_ opciones: [OpcionSegmento<Valor>], seleccion: Binding<Valor>, bloque: Bool = false, etiqueta: String,
         pestanas: Bool = false, alCambiar: ((Valor) -> Void)? = nil) {
        self.opciones = opciones
        self._seleccion = seleccion
        self.bloque = bloque
        self.etiqueta = etiqueta
        self.pestanas = pestanas
        self.alCambiar = alCambiar
    }

    private var indice: Int { opciones.firstIndex(where: { $0.valor == seleccion }) ?? 0 }
    private var celda: CGFloat { opciones.isEmpty ? 0 : anchoFila / CGFloat(opciones.count) }

    /// `clamp(8, 3vw, 16)`; ≤ 380 de ancho: 6 (Segmented.css:90).
    private var relleno: CGFloat {
        if maquetacion.estrecho380 { return 6 }
        return CGFloat(min(16, max(8, 0.03 * maquetacion.ancho)))
    }

    var body: some View {
        ZStack(alignment: .leading) {
            GotaSegmento()
                .frame(width: celda, height: 36)
                .offset(x: celda * CGFloat(indice))
                .animation(Movimiento.estandar(reducido), value: indice)
            FilaIgual(bloque: bloque) {
                ForEach(opciones) { opcion in
                    boton(opcion)
                }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { anchoFila = $0 }
        }
        .padding(4)
        .background(Palco.lineSoft, in: Capsule())
        .accessibilityElement(children: .contain)
        .accessibilityLabel(etiqueta)
        .accessibilityAddTraits(pestanas ? .isTabBar : [])
    }

    private func boton(_ opcion: OpcionSegmento<Valor>) -> some View {
        let activa = opcion.valor == seleccion
        return Button {
            guard opcion.valor != seleccion else { return }
            seleccion = opcion.valor
            alCambiar?(opcion.valor)
        } label: {
            EtiquetaSegmento(opcion: opcion, activa: activa, relleno: relleno, estrecho: maquetacion.estrecho380)
        }
        .buttonStyle(EstiloPulsar())
        .foregroundStyle(activa ? Palco.text : Palco.text2)
        .accessibilityAddTraits(activa ? .isSelected : [])
    }
}

private struct EtiquetaSegmento<Valor: Hashable>: View {
    let opcion: OpcionSegmento<Valor>
    let activa: Bool
    let relleno: CGFloat
    let estrecho: Bool

    var body: some View {
        HStack(spacing: estrecho ? 4 : 6) {
            if let icono = opcion.icono { IconoPalco(icono, tamano: 18) }
            Text(opcion.titulo).estilo(.segmento).lineLimit(1)
            if let contador = opcion.contador {
                Num(String(contador), tamano: 13).foregroundStyle(Palco.text3)
            }
        }
        .padding(.horizontal, relleno)
        .frame(maxWidth: .infinity)
        .frame(height: 36)
        .contentShape(Rectangle().inset(by: -4))
    }
}

/// `::before` de la pista: `--surface`, `inset 0 1px 0 --glass-hi`, `0 4 14 −6 #000 α.35`, `0 0 0 1 --line-soft`.
private struct GotaSegmento: View {
    var body: some View {
        Capsule()
            .fill(Palco.surface)
            .brilloSuperior(forma: Capsule())
            .background(Capsule().stroke(Palco.lineSoft, lineWidth: 2))
            .sombra([CapaSombra(y: 4, desenfoque: 14, expansion: -6, color: Color.black.opacity(0.35))], forma: Capsule())
    }
}

/// Columnas iguales (`repeat(n, 1fr)`): cada una del ancho de la más ancha, o repartiendo todo el ancho
/// propuesto con `bloque`; nunca más ancho que lo propuesto.
struct FilaIgual: Layout {
    var bloque: Bool

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard !subviews.isEmpty else { return .zero }
        let n = CGFloat(subviews.count)
        let medidas = subviews.map { $0.sizeThatFits(.unspecified) }
        let alto = medidas.map(\.height).max() ?? 0
        let anchoNatural = (medidas.map(\.width).max() ?? 0) * n
        if bloque, let propuesto = proposal.width { return CGSize(width: propuesto, height: alto) }
        let ancho = proposal.width.map { min($0, anchoNatural) } ?? anchoNatural
        return CGSize(width: ancho, height: alto)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard !subviews.isEmpty else { return }
        let celda = bounds.width / CGFloat(subviews.count)
        for (i, vista) in subviews.enumerated() {
            let x = bounds.minX + celda * CGFloat(i)
            vista.place(at: CGPoint(x: x, y: bounds.minY), proposal: ProposedViewSize(width: celda, height: bounds.height))
        }
    }
}
