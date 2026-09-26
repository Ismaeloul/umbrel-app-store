import Foundation

/* Esperas del tiempo real (b-arquitectura §2.1.4, contrato I0→M1; a7 §6.2; api/sse.ts). Los vectores de
   scripts/vectores/datos.ts las sacan de un `startRealtime` de verdad. */

enum EsperaSSE {
    /// 3, 6, 12, 24, 48, 60, 60… s (a7 §6.2): min(60, 3·2^min(n−1, 5)).
    static func espera(intento: Int) -> Double { min(60, 3 * pow(2, Double(min(max(intento, 1) - 1, 5)))) }

    /// `SSE_FALLBACK_AFTER_MS`: si en 10 s no abre, respaldo (contrato aditivo de M1, ronda 2).
    static let respaldoTras = 10.0
    /// `FALLBACK_PLAYBACK_MS`: en respaldo, la reproducción cada 5 s.
    static let sondeoReproduccion = 5.0
    /// `FALLBACK_ENGINE_MS`: en respaldo, el motor cada 20 s.
    static let sondeoMotor = 20.0
}
