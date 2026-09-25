// GENERADO por scripts/generar-plazos.mjs desde apps/web/src/api/client.ts y
// apps/web/src/features/sources/session.ts. No editar.

import Foundation

/// Plazos de la web, en segundos.
enum PlazosWeb {
    /// `DEFAULT_GET_TIMEOUT`
    static let lectura: Double = 12
    /// `DEFAULT_MUTATION_TIMEOUT`
    static let escritura: Double = 12

    /// `timeoutFor(id)`: el de `TIMEOUTS` o el de su método.
    static func plazo(_ ruta: RutaID) -> Double {
        switch ruta {
        case .footballSchedule: 14
        case .footballResolve: 30
        case .footballScan: 5
        case .channelStream: 60
        case .search: 15
        case .directoriesSync: 50
        case .engineRestart: 20
        case .healthLive: 4
        default: ruta.metodo == .get ? lectura : escritura
        }
    }

    // features/sources/session.ts
    /// `SCAN_POLL_MS`
    static let sondeoComprobador: Double = 1.5
    /// `SCAN_MAX_FAILURES`
    static let fallosSondeoMaximos = 3
    /// `REPORT_MAX_POLLS`
    static let consultasReporteMaximas = 32
    /// `REPORT_MAX_WAIT_MS`
    static let esperaReporteMaxima: Double = 1860
    /// `RESOLVE_TIMEOUT_MS`
    static let resolver: Double = 20
    /// `RESEARCH_TIMEOUT_MS`
    static let rebuscar: Double = 30
}
