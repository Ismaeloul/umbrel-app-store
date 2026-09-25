import Foundation

/* Esperas entre reconexiones del tiempo real (b-arquitectura §2.1.4, contrato I0→M1; a7 §6.2). */

enum EsperaSSE {
    /// 3, 6, 12, 24, 48, 60, 60… s (a7 §6.2): min(60, 3·2^min(n−1, 5)).
    static func espera(intento: Int) -> Double { min(60, 3 * pow(2, Double(min(max(intento, 1) - 1, 5)))) }
}
