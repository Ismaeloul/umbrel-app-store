import Foundation
import Observation

/* Sesión de la app (b-arquitectura §2.5.4, I0→M1). ESQUELETO de la poda (fase 0.2): solo lo rescatado
   de la interfaz vieja, sin cambiar el comportamiento:
   - la fase inicial de `AppModel.init` (hay token y direcciones → la app; si no, emparejar);
   - la lógica de `RootView.onOpenURL` en `abrir(enlace:)`: con la app emparejada, el enlace espera en
     `enlacePendiente` (hoja «¿Emparejar con otro servidor?»); sin emparejar, rellena la pantalla de
     emparejar (`enlaceParaEmparejar`).
   La fase 0.3b completa el contrato (conexión, dispositivo, versión, capacidades, olvidar, acceso
   perdido) y M1 lo rellena. */

enum MotivoEmparejar: Hashable, Sendable {
    case olvidadoAqui, revocadoDesdeOtro, noAutorizado, dispositivoRetirado, llaveroIlegible
}

enum FaseSesion: Hashable, Sendable { case emparejar(MotivoEmparejar?), app }

@MainActor
@Observable
final class SesionApp {
    private(set) var fase: FaseSesion
    /// aceneo://pair con la app ya emparejada → hoja «¿Emparejar con otro servidor?».
    var enlacePendiente: PairingLink?
    /// aceneo://pair sin emparejar: rellena la pantalla de emparejar (de `RootView.enlacePendiente`).
    var enlaceParaEmparejar: PairingLink?

    private let entorno: Entorno

    init(entorno: Entorno) {
        self.entorno = entorno
        let tieneToken = ((try? entorno.tokens.leerToken()) ?? nil) != nil
        fase = tieneToken && !entorno.configuracion.leer().vacia ? .app : .emparejar(nil)
    }

    /// El QR abierto con la Cámara (o un enlace `aceneo://pair`) llega aquí. Si ya está emparejada,
    /// se pregunta antes de cambiar de servidor.
    func abrir(enlace url: URL) {
        guard let enlace = PairingLink(url: url) else { return }
        if fase == .app {
            enlacePendiente = enlace
        } else {
            enlaceParaEmparejar = enlace
        }
    }
}
