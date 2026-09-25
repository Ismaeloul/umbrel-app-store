import Foundation
import Observation

/* Tic de 20 s mientras haya quien mire (b-arquitectura §2.5.5, M1). ESQUELETO de I0 (fase 0.3b) con la firma del contrato para que
   `ContenedorApp` compile; M1 escribe la lógica y sus pruebas. */

@MainActor @Observable final class RelojCompartido {
    private(set) var ahora: Date
    private let reloj: any Reloj
    private let periodo: Duration
    @ObservationIgnored private var observadores = 0

    init(reloj: any Reloj, periodo: Duration = .seconds(20)) {
        self.reloj = reloj
        self.periodo = periodo
        ahora = reloj.ahora
    }

    func empezarAMirar() {
        observadores += 1
        ahora = reloj.ahora
    }

    func dejarDeMirar() { observadores = max(0, observadores - 1) }
}
