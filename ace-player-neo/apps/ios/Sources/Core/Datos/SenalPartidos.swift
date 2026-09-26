import Foundation
import Observation

/* Lo último que dijo el comprobador de cada partido (b-arquitectura §2.5.5, M1): el `scanStore` de
   apps/web/src/features/agenda/data.ts. Llega por SSE (`scan.progress` con `matchId`), vale 20 min (lo
   que dura un resultado del precalentado) y `cancelled` lo borra. */

@MainActor @Observable final class SenalPartidos {
    private var porPartido: [String: Anotada] = [:]
    /// El reloj de la validez (el repartidor anota con él).
    @ObservationIgnored var reloj: any Reloj = RelojSistema()

    /// `20 * 60_000` de `useScanSignal` (agenda/data.ts).
    static let validez: TimeInterval = 20 * 60

    struct Anotada: Sendable, Equatable {
        var progreso: ScanProgressData
        var recibidaEn: Date
    }

    func senal(partido id: String) -> ScanProgressData? {
        guard let anotada = porPartido[id], reloj.ahora.timeIntervalSince(anotada.recibidaEn) <= Self.validez
        else { return nil }
        return anotada.progreso
    }

    func anotar(_ progreso: ScanProgressData, ahora: Date) {
        guard let id = progreso.matchId else { return }
        if progreso.status == .cancelled {
            porPartido[id] = nil
        } else {
            porPartido[id] = Anotada(progreso: progreso, recibidaEn: ahora)
        }
    }

    /// Olvidar este iPhone o acceso perdido.
    func vaciar() { porPartido = [:] }
}
