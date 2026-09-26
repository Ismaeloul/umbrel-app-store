import SwiftUI

/// `<PosterRail>` de la web: carrusel horizontal (a1 §10.16; ui/PosterRail.css). Separación 12, ajuste al
/// inicio de cada cartel, sin barra, aire de 6 arriba y 14 abajo para las sombras; con sangrado la pista
/// llega a los bordes y el primer cartel queda alineado con el titular (16 + zona segura). Nunca sube con la
/// barra de estado (a2 §24).
struct CarrilCarteles<Datos: RandomAccessCollection, Celda: View>: View where Datos.Element: Identifiable {
    let datos: Datos
    let anchoCelda: CGFloat
    let sangrado: CGFloat
    let etiqueta: String
    let celda: (Datos.Element) -> Celda

    init(_ datos: Datos, anchoCelda: CGFloat, sangrado: CGFloat = 16, etiqueta: String,
         @ViewBuilder celda: @escaping (Datos.Element) -> Celda) {
        self.datos = datos
        self.anchoCelda = anchoCelda
        self.sangrado = sangrado
        self.etiqueta = etiqueta
        self.celda = celda
    }

    var body: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 12) {
                ForEach(datos) { elemento in
                    celda(elemento).frame(width: anchoCelda)
                }
            }
            .scrollTargetLayout()
            .padding(.top, 6)
            .padding(.bottom, 14)
            .subeConLaBarraDeEstado(false)
            .carrilSoloHorizontal()
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.viewAligned)
        .contentMargins(.horizontal, sangrado, for: .scrollContent)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(etiqueta)
    }
}
