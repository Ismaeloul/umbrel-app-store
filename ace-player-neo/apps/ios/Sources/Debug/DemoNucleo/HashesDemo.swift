#if DEBUG
    import Foundation

    /* Hashes y azar de la demo (a7 §13.5, §13.10, §13.11): `demoHash` de sources/demo-data.ts (FNV-1a del
       texto → xorshift32, 8 hex por vuelta hasta 40), `fakeHash` de search/demo.ts (FNV-1a acumulado sobre
       «<título>#<vuelta>»), la semilla del QR de adorno de devices/demo.ts y el `Math.random` sembrado con
       xorshift32 que usa generar-demo.ts (el código de emparejar de la demo sale de ahí). */

    enum HashesDemo {
        /// FNV-1a de 32 bits sobre las unidades UTF-16 (`charCodeAt`).
        static func fnv(_ texto: String, desde inicial: UInt32 = 0x811C_9DC5) -> UInt32 {
            var h = inicial
            for unidad in texto.utf16 {
                h ^= UInt32(unidad)
                h = h &* 0x0100_0193
            }
            return h
        }

        /// Ocho cifras hexadecimales en minúsculas (`toString(16).padStart(8, '0')`).
        static func hex8(_ valor: UInt32) -> String {
            let texto = String(valor, radix: 16)
            return String(repeating: "0", count: 8 - texto.count) + texto
        }

        /// `demoHash`: 40 hex deterministas a partir de un texto.
        static func demoHash(_ semilla: String) -> String {
            var x = fnv(semilla)
            if x == 0 { x = 1 }
            var salida = ""
            while salida.count < 40 {
                x ^= x << 13
                x ^= x >> 17
                x ^= x << 5
                salida += hex8(x)
            }
            return String(salida.prefix(40))
        }

        /// `fakeHash`: FNV-1a acumulado sobre «<semilla>#<vuelta>» (vuelta 0, 1, 2…), 8 hex por vuelta.
        static func fakeHash(_ semilla: String) -> String {
            var h: UInt32 = 0x811C_9DC5
            var salida = ""
            var vuelta = 0
            while salida.count < 40 {
                // `for (const ch of texto)` recorre puntos de código y toma su primera unidad UTF-16.
                for escalar in "\(semilla)#\(vuelta)".unicodeScalars {
                    let unidad = String(escalar).utf16.first ?? 0
                    h = (h ^ UInt32(unidad)) &* 16_777_619
                }
                salida += hex8(h)
                vuelta += 1
            }
            return String(salida.prefix(40))
        }
    }

    /// `Math.random` sembrado de generar-demo.ts: xorshift32 → [0, 1). Estado de valor (lo guarda `EstadoDemo`).
    struct AleatorioDemo: Sendable {
        private(set) var estado: UInt32

        init(semilla: UInt64 = 1) {
            let recortada = UInt32(truncatingIfNeeded: semilla)
            estado = recortada == 0 ? 1 : recortada
        }

        mutating func siguiente() -> Double {
            estado ^= estado << 13
            estado ^= estado >> 17
            estado ^= estado << 5
            return Double(estado) / 4_294_967_296
        }
    }
#endif
