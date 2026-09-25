import Foundation

/* NWPathMonitor → ServerResolver.invalidar() + TiempoReal.reconectarYa() (b-arquitectura §2.5.5, M1). ESQUELETO de I0 (fase 0.3b) con la firma del contrato para que
   `ContenedorApp` compile; M1 escribe la lógica y sus pruebas. */

@MainActor final class VigiaRed {
    private let servidores: ServerResolver
    private let alCambiar: () -> Void

    init(servidores: ServerResolver, alCambiar: @escaping () -> Void) {
        self.servidores = servidores
        self.alCambiar = alCambiar
    }
}
