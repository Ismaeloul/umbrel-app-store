import SwiftUI

// Canario C15 (b-arquitectura §5.3): onGeometryChange(for:of:action:) en .global durante un
// ScrollView (marcos del vuelo tarjeta → teatro), tal como lo usará `.piezaVuelo(…)` (§2.4.5).
// Plan B: coordenadas con nombre del AppShell. Se borra al cerrar la fase 0.

@MainActor @Observable final class SondaTransicion {
    @ObservationIgnored private(set) var marcos: [String: CGRect] = [:]
    func publicar(_ marco: CGRect, para clave: String) { marcos[clave] = marco }
    func olvidar(_ clave: String) { marcos[clave] = nil }
}

extension View {
    func sondaPiezaVuelo(_ clave: String, transicion: SondaTransicion) -> some View {
        onGeometryChange(for: CGRect.self) { proxy in
            proxy.frame(in: .global)
        } action: { marco in
            transicion.publicar(marco, para: clave)
        }
        .onDisappear { transicion.olvidar(clave) }
    }
}

struct SondaC15Vuelo: View {
    @State private var transicion = SondaTransicion()

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(0..<20, id: \.self) { i in
                    Color.gray.frame(height: 120).sondaPiezaVuelo("tarjeta-\(i)", transicion: transicion)
                }
            }
        }
    }
}
