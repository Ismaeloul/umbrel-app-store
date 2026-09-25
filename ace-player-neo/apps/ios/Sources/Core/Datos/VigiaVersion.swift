import Foundation

/* ping tras resync, al reabrir o tras 30 min o más fuera (a7 §5.2) (b-arquitectura §2.5.5, M1). ESQUELETO de I0 (fase 0.3b) con la firma del contrato para que
   `ContenedorApp` compile; M1 escribe la lógica y sus pruebas. */

@MainActor final class VigiaVersion {
    private let api: APIClient
    private let avisos: Avisos

    init(api: APIClient, avisos: Avisos) {
        self.api = api
        self.avisos = avisos
    }

    func revisar(motivo: String) async {}
}
