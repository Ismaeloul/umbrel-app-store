import Foundation
import Observation
import SwiftUI

/* Modelo de la raíz (b-arquitectura §2.3, I0→M4): las dos fases emparejar ↔ app (a2 §27.2), el éxito de emparejar
   (a2 §22.6) y el acceso perdido (a2 §23.3), con fundidos de 340 ms entre las dos.

   Lo que se anima es la OPACIDAD de dos contenedores ya montados, nunca un if/else dentro de withAnimation (a8 §9.6:
   con el fundido de la app vieja la tira de días se quedaba sin pintar): primero se monta la capa que entra, un
   fotograma después se anima `app`, y al acabar se desmonta la que sale. Los plazos se esperan con `Task.sleep`
   (no con la terminación de la animación, que fuera de una vista puede no llegar nunca). */

@MainActor @Observable final class Raiz {
    private(set) var armazonMontado: Bool
    private(set) var emparejarMontado: Bool
    private(set) var motivo: MotivoEmparejar?
    /// El armazón es la capa de arriba (a2 §27.2). Mientras se cruzan, las dos están montadas.
    private(set) var app: Bool
    /// Desplazamiento de entrada de cada capa (a2 §11: +16 adelante al entrar en la app, −16 atrás al volver).
    private(set) var entradaApp: Double = 0
    private(set) var entradaEmparejar: Double = 0
    /// Hay un paso en marcha (las pruebas lo esperan; un segundo paso igual no se repite).
    private(set) var cambiando = false

    @ObservationIgnored private weak var avisos: Avisos?
    @ObservationIgnored private weak var haptica: Haptica?
    @ObservationIgnored private weak var hojas: CentroHojas?

    init(faseInicial: FaseSesion) {
        switch faseInicial {
        case .app:
            armazonMontado = true
            emparejarMontado = false
            motivo = nil
            app = true
        case .emparejar(let motivo):
            armazonMontado = false
            emparejarMontado = true
            self.motivo = motivo
            app = false
        }
    }

    /// Los objetos de proceso que la raíz toca al cambiar de fase (los cablea `ContenedorApp`).
    func conectar(avisos: Avisos, haptica: Haptica, hojas: CentroHojas) {
        self.avisos = avisos
        self.haptica = haptica
        self.hojas = hojas
    }

    /// Monta el armazón, funde y avisa «Emparejado con {host}» (a2 §22.6).
    func entrarEnLaApp(host: String, reducido: Bool) async {
        guard !app, !cambiando else { return }
        cambiando = true
        armazonMontado = true  // se monta debajo, a opacidad 0 y sin toques
        entradaApp = GeometriaVuelo.entradaVista(.adelante, reducido: reducido)
        try? await Task.sleep(for: .milliseconds(600))  // a2 §22.6: pausa para leer «Emparejado»
        withAnimation(Raiz.curva(reducido)) {
            app = true
            entradaApp = 0
        }
        try? await Task.sleep(for: .milliseconds(Raiz.duracionMs(reducido)))
        emparejarMontado = false
        motivo = nil
        cambiando = false
        if !host.isEmpty {
            avisos?.avisar("Emparejado con \(host)", tono: .ok, icono: .check)  // a2 §22.6, t = 940 ms
        }
    }

    /// Acceso perdido u «Olvidar este iPhone»: vuelve a emparejar con su motivo (a2 §23.3). Solo la primera vez
    /// cambia el motivo: los siguientes 401 no lo pisan.
    func volverAEmparejar(motivo: MotivoEmparejar, reducido: Bool) async {
        guard app, !cambiando else { return }
        cambiando = true
        self.motivo = motivo
        hojas?.cerrar()  // a2 §23.3 paso 2: cierra hojas, menús y confirmaciones
        if motivo != .olvidadoAqui { haptica?.disparar(.aviso) }  // paso 4 (olvidar lo pide la persona: sin aviso)
        emparejarMontado = true
        entradaEmparejar = GeometriaVuelo.entradaVista(.atras, reducido: reducido)
        try? await Task.sleep(for: .milliseconds(17))  // un fotograma: la capa que entra ya está montada
        withAnimation(Raiz.curva(reducido)) {
            app = false
            entradaEmparejar = 0
        }
        try? await Task.sleep(for: .milliseconds(Raiz.duracionMs(reducido)))
        armazonMontado = false
        cambiando = false
    }

    /// Fundido de vista de la web (a2 §11): 340 ms `ease-out`; reducido o «preferir fundidos», 120 ms.
    static func curva(_ reducido: Bool) -> Animation { Movimiento.vista(reducido) }
    static func duracionMs(_ reducido: Bool) -> Int { reducido ? 120 : 340 }
}
