import Foundation
import Observation

/* Marcadores destapados de proceso: se vacían al cambiar lo que suena (b-arquitectura §2.5.5, M1). ESQUELETO de I0 (fase 0.3b) con la firma del contrato para que
   `ContenedorApp` compile; M1 escribe la lógica y sus pruebas. */

@MainActor @Observable final class MarcadoresDestapados {
    private var destapados: Set<String> = []

    func destapado(_ partido: String) -> Bool { destapados.contains(partido) }
    func destapar(_ partido: String) { destapados.insert(partido) }
    /// Vuelve a tapar UN partido (segundo toque en la cápsula «Marcador»; `hideScore` de score-reveal.ts).
    func tapar(_ partido: String) { destapados.remove(partido) }
    func vaciar() { destapados = [] }
}
