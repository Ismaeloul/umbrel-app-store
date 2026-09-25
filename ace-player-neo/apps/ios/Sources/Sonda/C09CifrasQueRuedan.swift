import SwiftUI

// Canario C9 (b-arquitectura §5.3): `.contentTransition(.numericText(value:))` dentro de una
// celda de ancho fijo por cifra (Num, §2.2.11). Plan B: sin rueda (como la web).
// Se borra al cerrar la fase 0.

struct SondaC9Num: View {
    let goles: Int
    let tamano: CGFloat

    private var cifras: [(offset: Int, element: Character)] { Array(String(goles).enumerated()) }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(cifras, id: \.offset) { par in
                celda(par.element)
            }
        }
        .animation(.spring(duration: 0.4, bounce: 0.15), value: goles)
    }

    private func celda(_ cifra: Character) -> some View {
        let ancho = tamano * 0.49
        return Text(String(cifra))
            .contentTransition(.numericText(value: Double(goles)))
            .frame(width: ancho)
    }
}
