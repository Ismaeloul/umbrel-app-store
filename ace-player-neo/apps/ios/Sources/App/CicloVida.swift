import Foundation
import Observation

/* Fases de la escena (b-arquitectura §2.3, I0→M4). La única fuente es el `SceneDelegate` (sustituye a
   `scenePhase`, que dentro de un UIHostingController no es fiable). Los objetos de proceso (SesionApp,
   TiempoReal, Reproductor) se apuntan a `alCambiar` desde `ContenedorApp.crear()` (a8 §3.5). */

enum FaseEscena: Sendable { case activa, inactiva, segundoPlano }

@MainActor @Observable final class CicloVida {
    private(set) var fase: FaseEscena = .inactiva
    private(set) var enSegundoPlanoDesde: Date?
    /// Oyentes de proceso (SesionApp, TiempoReal, Reproductor): (antes, después).
    @ObservationIgnored var alCambiar: [(FaseEscena, FaseEscena) -> Void] = []

    func cambiar(a nueva: FaseEscena) {
        let antes = fase
        guard nueva != antes else { return }
        fase = nueva
        if nueva == .segundoPlano {
            enSegundoPlanoDesde = Date()
        } else if nueva == .activa {
            enSegundoPlanoDesde = nil
        }
        for oyente in alCambiar { oyente(antes, nueva) }
    }
}
