import Foundation
import Observation

/* Sesión de la app (b-arquitectura §2.5.4, I0→M1): fase emparejar ↔ app, conexión, dispositivo,
   versión del servidor, capacidades (403 origin_forbidden de un servidor 0.8.0), olvidar este iPhone y
   acceso perdido. ESQUELETO de I0 (fase 0.3b) con lo rescatado en la poda (0.2), sin cambiar el
   comportamiento:
   - la fase inicial de `AppModel.init` (hay token y direcciones → la app; si no, emparejar);
   - la lógica de `RootView.onOpenURL` en `abrir(enlace:)`: con la app emparejada, el enlace espera en
     `enlacePendiente` (hoja «¿Emparejar con otro servidor?»); sin emparejar, rellena la pantalla de
     emparejar (`enlaceParaEmparejar`).
   El resto (arranque, canje, olvidar, acceso perdido de verdad) lo escribe M1. */

enum MotivoEmparejar: Hashable, Sendable {
    case olvidadoAqui, revocadoDesdeOtro, noAutorizado, dispositivoRetirado, llaveroIlegible
}

enum FaseSesion: Hashable, Sendable { case emparejar(MotivoEmparejar?), app }

enum EstadoConexion: Hashable, Sendable { case conectando, conectado(ServerVia), sinServidor, backendNoDisponible }

@MainActor @Observable final class SesionApp {
    private(set) var fase: FaseSesion
    private(set) var conexion: EstadoConexion = .conectando
    private(set) var dispositivo: String?
    private(set) var versionServidor: String?
    private(set) var capacidades = Capacidades()
    private(set) var olvidando = false
    /// Lo que impidió «Olvidar este iPhone» (red, plazo, 403 de un servidor 0.8.0…): si tras
    /// `olvidarEsteIPhone()` la sesión sigue en la app, Ajustes lo enseña en el toast «No se pudo olvidar este
    /// iPhone. {motivo}» (a6 §8.10.3). `nil` si no hubo fallo. (Añadido aditivo de M7; lo rellena M1.)
    private(set) var falloOlvidar: APIError?
    /// aceneo://pair con la app ya emparejada → hoja «¿Emparejar con otro servidor?».
    var enlacePendiente: PairingLink?
    /// aceneo://pair sin emparejar: rellena la pantalla de emparejar (de `RootView.enlacePendiente`).
    var enlaceParaEmparejar: PairingLink?
    @ObservationIgnored var alPerderAcceso: ((MotivoEmparejar) -> Void)?

    private let entorno: Entorno

    init(entorno: Entorno) {
        self.entorno = entorno
        let tieneToken = ((try? entorno.tokens.leerToken()) ?? nil) != nil
        fase = tieneToken && !entorno.configuracion.leer().vacia ? .app : .emparejar(nil)
    }

    /// Hay token → .app y arranque; si no, .emparejar(nil).
    func arrancar() async {}

    func emparejado(_ respuesta: PairingClaimResponse, servidores: [URL]) async {
        dispositivo = IdentidadDispositivo.id(token: respuesta.token)
        fase = .app
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

    /// Borra el token y conserva las direcciones (a9 §3.3). Esqueleto: cambia la fase y avisa a la raíz.
    func accesoPerdido(_ motivo: MotivoEmparejar) async {
        fase = .emparejar(motivo)
        alPerderAcceso?(motivo)
    }

    /// Revoca el propio, borra token y cachés y vuelve a emparejar (sin aviso, a2 §23.3).
    func olvidarEsteIPhone() async {}

    func volvioAPrimerPlano() {}
    func pasoASegundoPlano() {}

    func anotar(_ error: APIError, en ruta: RutaAdministracion) {
        guard case .servidor(let codigo, _, _, _) = error else { return }
        capacidades.registrar(codigo, en: ruta)
    }
}
