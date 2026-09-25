import Foundation
import Observation

/* «Ahora», que avanza cada 20 s mientras alguien lo mira (b-arquitectura §2.5.5, M1): el reloj compartido
   de apps/web/src/features/agenda/data.ts (`TICK_MS = 20_000`, `useNow`). Un solo tic para todas las
   filas; al empezar a mirar se pone al día; sin nadie mirando se para. Canales (30 s) y Ajustes (60 s)
   crean el suyo con otro periodo. */

@MainActor @Observable final class RelojCompartido {
    private(set) var ahora: Date
    private let reloj: any Reloj
    private let periodo: Duration
    @ObservationIgnored private(set) var observadores = 0
    @ObservationIgnored private var tic: Task<Void, Never>?

    init(reloj: any Reloj, periodo: Duration = .seconds(20)) {
        self.reloj = reloj
        self.periodo = periodo
        ahora = reloj.ahora
    }

    func empezarAMirar() {
        observadores += 1
        ahora = reloj.ahora
        guard tic == nil else { return }
        let periodo = self.periodo
        tic = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: periodo)
                guard !Task.isCancelled, let self else { return }
                self.ahora = self.reloj.ahora
            }
        }
    }

    func dejarDeMirar() {
        observadores = max(0, observadores - 1)
        guard observadores == 0 else { return }
        tic?.cancel()
        tic = nil
    }

    /// ¿Está en marcha el tic? (para las pruebas).
    var enMarcha: Bool { tic != nil }
}
