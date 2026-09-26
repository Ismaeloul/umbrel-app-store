import Foundation

/* Reintentos de las consultas (a7 §4.1; `retry` y `retryDelay` de apps/web/src/api/query.ts). Contrato
   aditivo de M1 (ronda 2): `Consulta` los usa y los vectores de scripts/vectores/datos.ts los vigilan. */

enum Reintentos {
    /// `count < 2`: como mucho dos reintentos.
    static let maximo = 2

    /// `retry(count, error)`: tras `fallos` fallos, ¿se vuelve a pedir? Solo si el error es reintentable.
    static func reintenta(fallos: Int, error: APIError) -> Bool { fallos < maximo && error.reintentable }

    /// `retryDelay(attempt)`: min(8000, 1000·2^n) ms → 1 s, 2 s, 4 s, 8 s, 8 s… (en segundos).
    static func espera(intento: Int) -> Double { min(8, pow(2, Double(max(intento, 0)))) }
}
