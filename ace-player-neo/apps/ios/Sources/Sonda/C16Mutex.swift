import Foundation
import Synchronization

// Canario C16 (añadido por I0; b-arquitectura §0.1 y §1.9): `final class` con `let` + `Mutex`
// (Synchronization, iOS 18 / Swift 6) SIN @unchecked Sendable, como Debug/DemoNucleo/EstadoDemo.swift,
// que además es [L] y compila en Linux. Plan B: OSAllocatedUnfairLock en iOS y NSLock en Linux.
// Se borra al cerrar la fase 0.

final class SondaEstadoDemo: Sendable {
    private let biblioteca = Mutex<[String: String]>([:])
    private let trabajos = Mutex<Int>(0)

    func guardar(_ hash: String, titulo: String) {
        biblioteca.withLock { $0[hash] = titulo }
    }

    func titulo(_ hash: String) -> String? {
        biblioteca.withLock { $0[hash] }
    }

    func nuevoTrabajo() -> Int {
        trabajos.withLock { valor in
            valor += 1
            return valor
        }
    }
}
