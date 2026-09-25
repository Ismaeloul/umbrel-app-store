import Observation
import SwiftUI

/// «Toca otra vez para confirmar» (3 s): el segundo toque ejecuta. El primero arma el botón `id` (la vista
/// cambia su texto, p. ej. «¿Olvidar? Pulsa otra vez»); pasado el plazo, o al tocar otro, se desarma.
@MainActor @Observable final class SegundoToque {
    private(set) var armado: String?
    @ObservationIgnored private var tarea: Task<Void, Never>?

    func tocar(_ id: String, plazo: Duration = .seconds(3), ejecutar: @escaping () -> Void) {
        if armado == id {
            desarmar()
            ejecutar()
            return
        }
        armado = id
        tarea?.cancel()
        tarea = Task { [weak self] in
            try? await Task.sleep(for: plazo)
            guard !Task.isCancelled else { return }
            self?.desarmar()
        }
    }

    func desarmar() {
        tarea?.cancel()
        tarea = nil
        armado = nil
    }
}
