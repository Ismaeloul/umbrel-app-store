import Foundation
import Observation

/* Modelo de la raíz (b-arquitectura §2.3, I0→M4): las dos fases emparejar ↔ app (a2 §27.2), el éxito
   de emparejar (a2 §22.6) y el acceso perdido (a2 §23.3), con fundidos de 340 ms entre las dos.
   ESQUELETO de I0 (fase 0.3b): cambia de fase sin fundido ni toast; M4 pone los fundidos y el toast
   «Emparejado con {host}». */

@MainActor @Observable final class Raiz {
    private(set) var armazonMontado: Bool
    private(set) var emparejarMontado: Bool
    private(set) var motivo: MotivoEmparejar?

    init(faseInicial: FaseSesion) {
        switch faseInicial {
        case .app:
            armazonMontado = true
            emparejarMontado = false
            motivo = nil
        case .emparejar(let motivo):
            armazonMontado = false
            emparejarMontado = true
            self.motivo = motivo
        }
    }

    /// Monta el armazón, funde y avisa «Emparejado con {host}» (a2 §22.6).
    func entrarEnLaApp(host: String, reducido: Bool) async {
        armazonMontado = true
        emparejarMontado = false
        motivo = nil
    }

    /// Acceso perdido u «Olvidar este iPhone»: vuelve a emparejar con su motivo (a2 §23.3).
    func volverAEmparejar(motivo: MotivoEmparejar, reducido: Bool) async {
        self.motivo = motivo
        emparejarMontado = true
        armazonMontado = false
    }
}
