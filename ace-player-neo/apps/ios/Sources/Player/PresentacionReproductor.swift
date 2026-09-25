import Foundation
import Observation

/* Cómo se enseña el reproductor (b-arquitectura §2.6, I0→M3): lugar del vídeo (mini, teatro,
   inmersivo o vuelo), controles con autoocultado de 3,2 s, pantalla completa, datos técnicos y cortes
   al cambiar de fuente. Sale del `Reproductor` en la poda (fase 0.2).
   ESQUELETO de I0 (fase 0.3b): el lugar y los interruptores sin plazos ni orientación; M3 escribe el
   autoocultado, `Orientacion.pedir` y PresentacionReproductorTests. */

enum LugarVideo: Sendable { case ninguno, mini, teatro, inmersivo, vuelo }

@MainActor @Observable final class PresentacionReproductor {
    private(set) var controlesVisibles = true
    private(set) var pantallaCompletaForzada = false
    private(set) var datosTecnicosAbiertos = false
    private(set) var cortes = 0  // +1 → CorteNegro (560 ms) al cambiar de fuente
    var voiceOverActivo = false

    private let reproductor: Reproductor

    init(reproductor: Reproductor) { self.reproductor = reproductor }

    func lugar(teatroVisible: Bool, inmersivo: Bool, volando: Bool) -> LugarVideo {
        if volando { return .vuelo }
        if inmersivo { return .inmersivo }
        if teatroVisible { return .teatro }
        return reproductor.canal == nil ? .ninguno : .mini
    }

    func miniVisible(teatroVisible: Bool, inmersivo: Bool) -> Bool {
        !teatroVisible && !inmersivo && reproductor.canal != nil
    }

    func tocarVideo() { controlesVisibles.toggle() }
    func interaccionConControles() { controlesVisibles = true }  // autoocultado 3,2 s solo reproduciendo y nunca con VoiceOver
    func alternarPantallaCompleta() { pantallaCompletaForzada.toggle() }  // Orientacion.pedir(.landscapeRight / .portrait)
    func abrirDatosTecnicos() { datosTecnicosAbiertos = true }
    func cerrarDatosTecnicos() { datosTecnicosAbiertos = false }
    func fuenteCambiada() { cortes += 1 }
}
