import Foundation
import Observation

/* scan.progress por partido: 20 min; `cancelled` lo borra (b-arquitectura §2.5.5, M1). ESQUELETO de I0 (fase 0.3b) con la firma del contrato para que
   `ContenedorApp` compile; M1 escribe la lógica y sus pruebas. */

@MainActor @Observable final class SenalPartidos {
    private var porPartido: [String: ScanProgressData] = [:]

    func senal(partido id: String) -> ScanProgressData? { porPartido[id] }

    func anotar(_ progreso: ScanProgressData, ahora: Date) {
        guard let id = progreso.matchId else { return }
        porPartido[id] = progreso
    }
}
