import SwiftUI

// Canario C6 (b-arquitectura §5.3): hoja nativa con detent medido (.height del alto del
// contenido), fondo opaco, asa, radio y contenido desplazable, tal como la usará
// Armazon/Hojas.swift (§2.4.2). Plan B: .fraction fija por hoja. Se borra al cerrar la fase 0.

enum SondaDetentsHoja: Sendable { case medido, grande, medioYGrande }

enum SondaHoja: String, Identifiable, Hashable, Sendable {
    case gustos, pegar, encontrarCanal
    var id: String { rawValue }
    var detents: SondaDetentsHoja {
        switch self {
        case .gustos: .grande
        case .encontrarCanal: .medioYGrande
        case .pegar: .medido
        }
    }
}

@MainActor @Observable final class SondaCentroHojas {
    var actual: SondaHoja?
    private(set) var cerradasArrastrando = 0
    func alDescartar() -> Bool {
        cerradasArrastrando += 1
        return true
    }
}

extension View {
    func sondaHojas(_ centro: SondaCentroHojas) -> some View { modifier(SondaModificadorHojas(centro: centro)) }
}

private struct SondaModificadorHojas: ViewModifier {
    @Bindable var centro: SondaCentroHojas
    @State private var altoMedido: CGFloat = 320

    func body(content: Content) -> some View {
        content.sheet(item: $centro.actual, onDismiss: { _ = centro.alDescartar() }) { hoja in
            Text(hoja.rawValue)
                .padding(24)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { altoMedido = $0 }
                .presentationDetents(detents(hoja.detents))
                .presentationDragIndicator(.visible)
                .presentationBackground(Color.white)
                .presentationCornerRadius(24)
                .presentationContentInteraction(.scrolls)
        }
    }

    private func detents(_ d: SondaDetentsHoja) -> Set<PresentationDetent> {
        switch d {
        case .medido: [.height(altoMedido)]
        case .grande: [.large]
        case .medioYGrande: [.medium, .large]
        }
    }
}
