import SwiftUI

/// `<SkeletonRows>` (a1 §10.24): contenedor de radio 18 (`--surface`, borde `--line-soft`); filas de 88 como
/// mínimo con relleno 14 y separación 12: círculo 46 · tres líneas (62 %×15, 44 %×15, 30 %×11) · 42×18 de
/// radio 10; separadas por una línea `--line-soft`. Anuncia «Cargando…».
struct FilasEsqueleto: View {
    let filas: Int
    let anuncio: String

    init(_ filas: Int, anuncio: String) {
        self.filas = filas
        self.anuncio = anuncio
    }

    private var indices: [Int] { Array(0..<max(0, filas)) }

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.l, style: .circular)
        VStack(spacing: 0) {
            ForEach(indices, id: \.self) { i in
                FilaEsqueleto().overlay(alignment: .top) {
                    if i > 0 { Rectangle().fill(Palco.lineSoft).frame(height: 1) }
                }
            }
        }
        .background(Palco.surface, in: forma)
        .clipShape(forma)
        .bordeInterior(Palco.lineSoft, forma: forma)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(anuncio)
    }
}

private struct FilaEsqueleto: View {
    var body: some View {
        HStack(spacing: 12) {
            Esqueleto(ancho: 46, alto: 46, radio: 23)
            LineasEsqueleto()
            Esqueleto(ancho: 42, alto: 18, radio: R.s)
        }
        .padding(14)
        .frame(minHeight: 88)
    }
}

private struct LineasEsqueleto: View {
    @State private var ancho: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Esqueleto(ancho: ancho * 0.62, alto: 15, radio: R.s)
            Esqueleto(ancho: ancho * 0.44, alto: 15, radio: R.s)
            Esqueleto(ancho: ancho * 0.30, alto: 11, radio: R.s)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { ancho = $0 }
    }
}
