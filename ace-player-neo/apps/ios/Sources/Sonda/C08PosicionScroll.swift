import SwiftUI

// Canario C8 (b-arquitectura §5.3): `scrollPosition(_:)` con `ScrollPosition` y
// `onScrollGeometryChange(for:of:action:)` (subir arriba, velo del héroe, tira de días).
// Plan B: ScrollViewReader + onGeometryChange. Se borra al cerrar la fase 0.

struct SondaC8Scroll: View {
    @State private var posicion = ScrollPosition(edge: .top)
    @State private var heroeBajoBarra = false
    let subir: Int

    var body: some View {
        ScrollView {
            LazyVStack {
                ForEach(0..<40, id: \.self) { i in
                    Text("Fila \(i)").id(i)
                }
            }
        }
        .scrollPosition($posicion)
        .onScrollGeometryChange(for: Double.self) { geometria in
            Double(geometria.contentOffset.y + geometria.contentInsets.top)
        } action: { _, nuevo in
            heroeBajoBarra = nuevo < 300
        }
        .onChange(of: subir) { _, _ in
            withAnimation(.spring(duration: 0.4, bounce: 0.15)) { posicion.scrollTo(edge: .top) }
        }
    }
}
