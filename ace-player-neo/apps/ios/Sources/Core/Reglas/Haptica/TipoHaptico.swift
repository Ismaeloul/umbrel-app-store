import Foundation

/* Háptica pura (b-arquitectura §2.1.3, contrato I0→M2), de lib/haptics.ts: los ocho tipos y la regla
   que decide si un pulso suena. El pulso de verdad (Haptica, TipoHaptico.feedback) es de Palco (P,
   §2.2.7); la tabla de sitios (SitiosHapticos) es de M2. */

/// Las ocho sensaciones de lib/haptics.ts (a1 §8).
enum TipoHaptico: String, CaseIterable, Sendable {
    case seleccion, ligera, media, fuerte, rigida, exito, aviso, error
}

enum ReglaHaptica {
    /// Anti-ráfaga de lib/haptics.ts (a1 §8).
    static let rafagaMs = 40.0

    /// «selección» calla con movimiento reducido; la misma sensación no se repite en < 40 ms.
    static func suena(_ tipo: TipoHaptico, ahoraMs: Double, ultimo: (tipo: TipoHaptico, ms: Double)?,
                      reducirMovimiento: Bool) -> Bool {
        if tipo == .seleccion && reducirMovimiento { return false }
        if let ultimo, ultimo.tipo == tipo, ahoraMs - ultimo.ms < rafagaMs { return false }
        return true
    }
}
