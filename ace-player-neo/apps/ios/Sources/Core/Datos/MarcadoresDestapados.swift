import Foundation
import Observation

/* Marcadores destapados de proceso (b-arquitectura §2.5.5, M1): el almacén de
   apps/web/src/features/agenda/score-reveal.ts. El marcador del partido que estás VIENDO sale tapado; se
   destapa con un toque y sigue así hasta cambiar de partido o detener. Lo comparten la agenda, el
   partido, la biblioteca y el mini. Qué partido se ve lo dice quien lo sabe (`fijarViendo`, el
   `playerPresence` de la web). */

@MainActor @Observable final class MarcadoresDestapados {
    private var destapados: Set<String> = []
    /// Partido que suena ahora (id de la agenda), o nil (un canal suelto no es un partido).
    private(set) var viendo: String?

    func destapado(_ partido: String) -> Bool { destapados.contains(partido) }
    func destapar(_ partido: String) { destapados.insert(partido) }
    /// Volver a tapar uno (`hideScore`).
    func tapar(_ partido: String) { destapados.remove(partido) }
    /// Vuelve a tapar todos (`resetScoreReveal`: al cambiar de fuente o de canal).
    func vaciar() { if !destapados.isEmpty { destapados = [] } }

    /// Cambiar de partido o detener vuelve a tapar: el destapado era para ESA reproducción.
    func fijarViendo(_ partido: String?) {
        guard partido != viendo else { return }
        viendo = partido
        vaciar()
    }
}
