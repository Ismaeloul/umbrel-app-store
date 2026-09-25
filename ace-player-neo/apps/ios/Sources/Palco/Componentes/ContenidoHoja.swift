import SwiftUI

enum TamanoHoja: Sendable { case sm, md, lg }  // anchos de la web en ≥ 768: 420 / 560 / 760

/// El contenido de una hoja de la web (a1 §10.18; ui/Sheet.css) para la hoja NATIVA (decisión 5): hueco del
/// asa de 22 (el asa la pinta el sistema), cabecera (relleno 0 12 0 20, separación 12) con el título 22/800/125
/// y «Cerrar» (IconButton `x`), descripción (2 20 0, 15, `--text-2`), cuerpo (16 20 20) y pie opcional (fila a
/// la derecha que salta, separación 8, relleno 12 20, borde superior `--line-soft`, botones que se estiran en
/// el móvil). En ≥ 768 el contenido no pasa de 420 / 560 / 760 y los botones del pie van a su tamaño.
struct ContenidoHoja<Cuerpo: View, Pie: View>: View {
    let titulo: String
    let descripcion: String?
    let tamano: TamanoHoja
    let cerrable: Bool
    let ocultarTitulo: Bool
    let alCerrar: () -> Void
    let cuerpo: Cuerpo
    let pie: Pie
    @Environment(\.maquetacion) private var maquetacion

    init(titulo: String, descripcion: String? = nil, tamano: TamanoHoja = .md, cerrable: Bool = true,
         ocultarTitulo: Bool = false, alCerrar: @escaping () -> Void,
         @ViewBuilder cuerpo: () -> Cuerpo, @ViewBuilder pie: () -> Pie) {
        self.titulo = titulo
        self.descripcion = descripcion
        self.tamano = tamano
        self.cerrable = cerrable
        self.ocultarTitulo = ocultarTitulo
        self.alCerrar = alCerrar
        self.cuerpo = cuerpo()
        self.pie = pie()
    }

    private var ancha: Bool { maquetacion.tipo == .tableta }
    private var hayPie: Bool { Pie.self != EmptyView.self }

    private var anchoMaximo: CGFloat {
        guard ancha else { return .infinity }
        switch tamano {
        case .sm: return 420
        case .md: return 560
        case .lg: return 760
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear.frame(height: ancha ? 14 : 22)  // caja del asa (Sheet.css)
            cabecera
            if let descripcion {
                Text(descripcion)
                    .estilo(.cuerpo)
                    .foregroundStyle(Palco.text2)
                    .padding(.top, 2)
                    .padding(.horizontal, 20)
            }
            cuerpo
                .padding(.top, 16)
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
            if hayPie { piePintado }
        }
        .frame(maxWidth: anchoMaximo)
        .frame(maxWidth: .infinity)
        .foregroundStyle(Palco.text)
    }

    private var cabecera: some View {
        HStack(spacing: 12) {
            Text(titulo)
                .estilo(.tituloHoja)
                .foregroundStyle(Palco.text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .opacity(ocultarTitulo ? 0 : 1)
                .accessibilityAddTraits(.isHeader)
            if cerrable {
                BotonIcono(.x, etiqueta: "Cerrar", accion: alCerrar)
            }
        }
        .padding(.leading, 20)
        .padding(.trailing, 12)
        .frame(minHeight: cerrable ? 44 : 0)
    }

    private var piePintado: some View {
        FilaPieHoja(estirar: !ancha) { pie }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .overlay(alignment: .top) { Rectangle().fill(Palco.lineSoft).frame(height: 1) }
    }
}

extension ContenidoHoja where Pie == EmptyView {
    init(titulo: String, descripcion: String? = nil, tamano: TamanoHoja = .md, cerrable: Bool = true,
         ocultarTitulo: Bool = false, alCerrar: @escaping () -> Void, @ViewBuilder cuerpo: () -> Cuerpo) {
        self.init(titulo: titulo, descripcion: descripcion, tamano: tamano, cerrable: cerrable,
                  ocultarTitulo: ocultarTitulo, alCerrar: alCerrar, cuerpo: cuerpo) { EmptyView() }
    }
}

/// El pie de la hoja: a la derecha, separación 8; en el móvil cada botón crece lo mismo hasta llenar la fila
/// (`flex: 1 1 auto`). Si no caben en una fila, uno por fila a todo el ancho (o a su tamaño en ≥ 768).
struct FilaPieHoja: Layout {
    var estirar: Bool

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let ancho = proposal.width ?? 390
        let medidas = subviews.map { $0.sizeThatFits(.unspecified) }
        if cabenJuntos(medidas, ancho: ancho) {
            return CGSize(width: ancho, height: medidas.map(\.height).max() ?? 0)
        }
        let alto = medidas.reduce(CGFloat(0)) { $0 + $1.height } + 8 * CGFloat(max(0, medidas.count - 1))
        return CGSize(width: ancho, height: alto)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let medidas = subviews.map { $0.sizeThatFits(.unspecified) }
        if cabenJuntos(medidas, ancho: bounds.width) {
            colocarEnFila(subviews, medidas: medidas, en: bounds)
        } else {
            var y = bounds.minY
            for (i, vista) in subviews.enumerated() {
                let ancho = estirar ? bounds.width : medidas[i].width
                vista.place(at: CGPoint(x: bounds.maxX - ancho, y: y), proposal: ProposedViewSize(width: ancho, height: medidas[i].height))
                y += medidas[i].height + 8
            }
        }
    }

    private func cabenJuntos(_ medidas: [CGSize], ancho: CGFloat) -> Bool {
        let total = medidas.reduce(CGFloat(0)) { $0 + $1.width } + 8 * CGFloat(max(0, medidas.count - 1))
        return total <= ancho
    }

    private func colocarEnFila(_ subviews: Subviews, medidas: [CGSize], en bounds: CGRect) {
        let total = medidas.reduce(CGFloat(0)) { $0 + $1.width } + 8 * CGFloat(max(0, medidas.count - 1))
        let extra = estirar && !medidas.isEmpty ? (bounds.width - total) / CGFloat(medidas.count) : 0
        var x = estirar ? bounds.minX : bounds.maxX - total
        for (i, vista) in subviews.enumerated() {
            let ancho = medidas[i].width + extra
            vista.place(at: CGPoint(x: x, y: bounds.minY), proposal: ProposedViewSize(width: ancho, height: medidas[i].height))
            x += ancho + 8
        }
    }
}
