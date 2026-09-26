import Foundation
import Observation

/* Sesión de la app (b-arquitectura §2.5.4, I0→M1): fase emparejar ↔ app, conexión, dispositivo,
   versión del servidor, capacidades (403 origin_forbidden de un servidor 0.8.0), olvidar este iPhone y
   acceso perdido.
   - Arranque (a7 §5, a2 §23.1): pinta en frío, pide `bootstrap` y la agenda a la vez, siembra y abre el
     tiempo real. Sin servidor: toast «Backend no disponible; la app seguirá reintentando» (4 s), una vez.
   - Acceso perdido (a2 §23.3): una sola vez y con el primer motivo; borra token y cachés, conserva las
     direcciones (`servidores.v1`: las mismas claves que la 0.8.0) y vuelve a emparejar.
   - Olvidar este iPhone (a9 §3.5.2-§3.5.3): `DELETE devices/<propio>`; mientras dura, su propio
     `devices.changed revoked` y los 401 se callan. Con un servidor 0.8.0, olvido local (a9 §9.1.3).
   - Casa ↔ Tailscale sin aviso: al cambiar la red o volver a primer plano se vuelve a elegir dirección. */

enum MotivoEmparejar: Hashable, Sendable {
    case olvidadoAqui, revocadoDesdeOtro, noAutorizado, dispositivoRetirado, llaveroIlegible
}

enum FaseSesion: Hashable, Sendable { case emparejar(MotivoEmparejar?), app }

enum EstadoConexion: Hashable, Sendable { case conectando, conectado(ServerVia), sinServidor, backendNoDisponible }

/// Un aviso que la sesión pide enseñar (lo pinta `Avisos`; el repartidor los une).
struct AvisoSesion: Sendable, Equatable {
    var texto: String
    var tono: TonoAviso
    var icono: NombreIcono?
    var duracion: Double?
}

@MainActor @Observable final class SesionApp {
    private(set) var fase: FaseSesion
    private(set) var conexion: EstadoConexion = .conectando
    private(set) var dispositivo: String?
    private(set) var versionServidor: String?
    private(set) var capacidades = Capacidades()
    private(set) var olvidando = false
    /// aceneo://pair con la app ya emparejada → hoja «¿Emparejar con otro servidor?».
    var enlacePendiente: PairingLink?
    /// aceneo://pair sin emparejar: rellena la pantalla de emparejar (de `RootView.enlacePendiente`).
    var enlaceParaEmparejar: PairingLink?
    @ObservationIgnored var alPerderAcceso: ((MotivoEmparejar) -> Void)?
    /// Toasts de la sesión (arranque, olvidar). Lo engancha el repartidor a `Avisos`.
    @ObservationIgnored var alAvisar: ((AvisoSesion) -> Void)?
    /// Pregunta la versión al volver tras ≥ 30 min fuera (a7 §5.2). Lo pone el repartidor.
    @ObservationIgnored var vigiaVersion: VigiaVersion?
    /// Al salir y al emparejar: lo que se sabía del servidor anterior (señales del comprobador, versión base)
    /// se olvida. Lo engancha el repartidor.
    @ObservationIgnored var alOlvidarServidor: (() -> Void)?
    /// El reloj de la app (-AceNeoReloj en Debug): cuánto estuvo en segundo plano (contrato aditivo, ronda 2).
    @ObservationIgnored var reloj: any Reloj = RelojSistema()

    let entorno: Entorno
    @ObservationIgnored private weak var datos: DatosApp?
    @ObservationIgnored private weak var tiempoReal: TiempoReal?
    @ObservationIgnored private var vigiaRed: VigiaRed?
    @ObservationIgnored private var escuchaAcceso: Task<Void, Never>?
    @ObservationIgnored private var enSegundoPlanoDesde: Date?
    @ObservationIgnored private var arrancando = false

    /// «Tras ≥ 30 min oculta» (`RECHECK_AFTER_HIDDEN_MS`, features/pwa/install.ts).
    static let revisarVersionTras: TimeInterval = 1_800
    static let textoDemo = "Modo demo: sin backend, canales de muestra cargados"
    static let textoSinBackend = "Backend no disponible; la app seguirá reintentando"
    static let textoOlvidarViejo =
        "No se pudo olvidar este iPhone. Esta opción necesita Ace Player Neo 0.8.1 o posterior en tu Umbrel."

    init(entorno: Entorno) {
        self.entorno = entorno
        let config = entorno.configuracion.leer()
        do {
            if let token = try entorno.tokens.leerToken(), !token.isEmpty, !config.vacia {
                fase = .app
                dispositivo = IdentidadDispositivo.id(token: token)
            } else {
                fase = .emparejar(nil)
            }
        } catch KeychainError.datosIlegibles {
            fase = .emparejar(.llaveroIlegible)
        } catch {
            fase = .emparejar(nil)
        }
        let avisos = entorno.accesoPerdido
        escuchaAcceso = Task { [weak self] in
            for await _ in avisos { await self?.accesoPerdidoEnPeticion() }
        }
    }

    /// Une la sesión con los datos y el tiempo real (lo hace el repartidor al crearse).
    func conectar(datos: DatosApp, tiempoReal: TiempoReal) {
        self.datos = datos
        self.tiempoReal = tiempoReal
        guard vigiaRed == nil else { return }
        vigiaRed = VigiaRed(servidores: entorno.servidores) { [weak self] in self?.redCambiada() }
    }

    // MARK: Arranque

    /// Hay token → arranque (pintar en frío, `bootstrap` ∥ agenda, sembrar, tiempo real); si no, nada.
    func arrancar() async {
        guard fase == .app, !arrancando, let datos else { return }
        arrancando = true
        defer { arrancando = false }
        if ModoEjecucion.demo { avisar(AvisoSesion(texto: Self.textoDemo, tono: .info, duracion: 4)) }
        await datos.pintarEnFrio()
        conexion = .conectando
        async let agenda: Void = datos.agenda.asegurar(tiempoRealAbierto: false)
        await datos.arranque.refrescar()
        await agenda
        if datos.arranque.error == nil, datos.arranque.actualizadaEn != nil, let arranque = datos.arranque.datos {
            datos.sembrar(con: arranque)
            await marcarConectado()
        } else if let error = datos.arranque.error {
            sinConexion(error, avisar: true)
        }
        guard fase == .app else { return }
        tiempoReal?.arrancar()
    }

    /// Cada `bootstrap` que llega (el primero o los que se vuelven a pedir): versión y «Este iPhone».
    func arranqueRecibido(_ arranque: BootstrapResponse) {
        versionServidor = arranque.version
        if let propio = arranque.device?.id { dispositivo = propio }
    }

    /// El tiempo real ha abierto por esta dirección: conectado; si el arranque no llegó, se pide ahora.
    func conectado(a servidor: ActiveServer) {
        conexion = .conectado(servidor.via)
        guard let datos else { return }
        if datos.arranque.actualizadaEn == nil {
            Task {
                await datos.arranque.refrescar()
                if datos.arranque.error == nil, let arranque = datos.arranque.datos { datos.sembrar(con: arranque) }
            }
        }
        datos.reintentarFallidas()
    }

    private func marcarConectado() async {
        let via = await entorno.servidores.conocido()?.via ?? .lan
        if fase == .app { conexion = .conectado(via) }
    }

    private func sinConexion(_ error: APIError, avisar mostrar: Bool) {
        switch error {
        case .necesitaEmparejar, .cancelado:
            return
        case .sinServidor:
            conexion = .sinServidor
        default:
            conexion = .backendNoDisponible
            if mostrar && !ModoEjecucion.demo {
                avisar(AvisoSesion(texto: Self.textoSinBackend, tono: .warn, duracion: 4))
            }
        }
    }

    /// Vuelve a elegir dirección (casa o Tailscale) y dice si hay servidor.
    private func comprobarConexion(avisar mostrar: Bool) async {
        guard fase == .app else { return }
        do {
            let servidor = try await entorno.servidores.resolver()
            if fase == .app { conexion = .conectado(servidor.via) }
        } catch {
            sinConexion(APIError.desde(error), avisar: mostrar)
        }
    }

    private func redCambiada() {
        guard fase == .app, !ModoEjecucion.demo else { return }
        tiempoReal?.renovar()
        Task { await self.comprobarConexion(avisar: false) }
    }

    // MARK: Emparejar

    /// El canje ha ido bien (token y direcciones ya guardados por `PairingService`): a la app.
    func emparejado(_ respuesta: PairingClaimResponse, servidores: [URL]) async {
        if !servidores.isEmpty {
            let config = ServerConfig(servidores: servidores)
            if !config.vacia && entorno.configuracion.leer().vacia {
                entorno.configuracion.guardar(config)
                await entorno.servidores.actualizar(config)
            }
        }
        dispositivo = respuesta.deviceId
        capacidades.olvidar()
        alOlvidarServidor?()
        enlaceParaEmparejar = nil
        fase = .app
        await arrancar()
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

    /// El cuerpo de `POST pairing` (a9 §3.4): la dirección que se usa ahora y la otra, si la hay.
    func cuerpoParaCodigo() async -> PairingCreateBody {
        let config = await entorno.servidores.configuracion()
        let activa = await entorno.servidores.conocido()?.url ?? config.candidatas.first?.url
        let otras = config.candidatas.map(\.url).filter { $0 != activa }
        return PairingCreateBody(
            baseUrl: activa?.absoluteString, alternateBaseUrls: otras.isEmpty ? nil : otras.map(\.absoluteString))
    }

    // MARK: Acceso perdido y olvidar

    /// Borra el token y conserva las direcciones (a9 §3.3). Una sola vez: los siguientes no cambian el motivo.
    func accesoPerdido(_ motivo: MotivoEmparejar) async {
        guard fase == .app, !olvidando else { return }
        var definitivo = motivo
        if motivo == .noAutorizado {
            let codigo = tiempoReal?.codigoAccesoPerdido ?? entorno.api.ultimoCodigoAccesoPerdido
            definitivo = Self.motivo(codigo: codigo)
        }
        salir(motivo: definitivo)
    }

    /// Un 401 de una petición (el `APIClient` ya ha borrado el token).
    private func accesoPerdidoEnPeticion() async {
        await accesoPerdido(Self.motivo(codigo: entorno.api.ultimoCodigoAccesoPerdido))
    }

    /// Motivo según el código del 401 (a2 §23.3).
    static func motivo(codigo: String?) -> MotivoEmparejar {
        guard let codigo else { return .noAutorizado }
        if codigo == "device_revoked" { return .dispositivoRetirado }
        if codigo == APIClient.codigoLlaveroIlegible { return .llaveroIlegible }
        return .noAutorizado
    }

    /// «Emparejar de nuevo» de la hoja de otro servidor (a2 §22.8; contrato aditivo de M7): para la reproducción
    /// (`alPerderAcceso`), borra token, direcciones y cachés y vuelve a emparejar sin aviso. No revoca nada en el
    /// servidor. A diferencia de `accesoPerdido`, sirve cuantas veces se pida mientras la app esté emparejada.
    func desemparejar() async {
        guard fase == .app, !olvidando else { return }
        entorno.configuracion.borrar()
        await entorno.servidores.actualizar(ServerConfig())
        salir(motivo: .olvidadoAqui)
    }

    /// Revoca el propio, borra token y cachés y vuelve a emparejar (sin aviso, a2 §23.3).
    func olvidarEsteIPhone() async {
        guard fase == .app, !olvidando else { return }
        olvidando = true
        entorno.api.callarAccesoPerdido(true)
        defer {
            olvidando = false
            entorno.api.callarAccesoPerdido(false)
        }
        guard !capacidades.servidorViejo, let propio = dispositivo else {
            salir(motivo: .olvidadoAqui)  // plan B local (a9 §9.1.3)
            return
        }
        do {
            _ = try await entorno.api.enviar(API.revocarDispositivo(id: propio))
            salir(motivo: .olvidadoAqui)
        } catch {
            olvidarFallido(APIError.desde(error))
        }
    }

    /// a9 §3.5.2: 401 y 404 también son salir; 403 es un servidor 0.8.0; lo demás no sale.
    private func olvidarFallido(_ error: APIError) {
        switch error {
        case .necesitaEmparejar:
            salir(motivo: .olvidadoAqui)
        case .servidor("device_not_found", _, _, _):
            salir(motivo: .olvidadoAqui)
        case .servidor("origin_forbidden", _, _, _):
            capacidades.registrar("origin_forbidden", en: .deviceRevoke)
            avisar(AvisoSesion(texto: Self.textoOlvidarViejo, tono: .err))
        default:
            let motivo = APIError.describirFallo(error)
            avisar(AvisoSesion(texto: OpcionesDispositivo.olvidadoMal(motivo: motivo), tono: .err))
        }
    }

    /// El camino de salida (a9 §3.5.2 paso 4, a2 §23.3): tiempo real, token y cachés fuera; direcciones,
    /// nombre y ajustes de este aparato se quedan. El reproductor y la raíz los mueve `alPerderAcceso`.
    private func salir(motivo: MotivoEmparejar) {
        tiempoReal?.parar()
        try? entorno.tokens.borrarToken()
        datos?.vaciar()
        alOlvidarServidor?()
        conexion = .conectando
        versionServidor = nil
        fase = .emparejar(motivo)
        alPerderAcceso?(motivo)
    }

    // MARK: Primer plano y segundo plano

    func volvioAPrimerPlano() {
        let fuera = enSegundoPlanoDesde.map { reloj.ahora.timeIntervalSince($0) } ?? 0
        enSegundoPlanoDesde = nil
        guard fase == .app else { return }
        datos?.volverActiva()
        guard !ModoEjecucion.demo else { return }
        Task { await self.comprobarConexion(avisar: true) }
        if fuera >= Self.revisarVersionTras {
            let vigia = vigiaVersion
            Task { await vigia?.revisar(motivo: "primer plano") }
        }
    }

    /// La hora se apunta al pasar a segundo plano, no a inactiva (el Centro de Control, a7 §5.2).
    func pasoASegundoPlano() {
        enSegundoPlanoDesde = reloj.ahora
    }

    // MARK: Capacidades

    func anotar(_ error: APIError, en ruta: RutaAdministracion) {
        guard case .servidor(let codigo, _, _, _) = error else { return }
        capacidades.registrar(codigo, en: ruta)
    }

    /// Una ruta de administración ha respondido 2xx: el servidor ya es 0.8.1 (a9 §9.1.1).
    func anotarExito(en ruta: RutaAdministracion) {
        guard capacidades.servidorViejo else { return }
        capacidades.abierta(ruta)
    }

    /// Versión nueva del servidor (a7 §5.2): lo apuntado se olvida y las secciones vuelven a probar.
    func versionCambiada(_ version: String) {
        versionServidor = version
        capacidades.olvidar()
    }

    private func avisar(_ aviso: AvisoSesion) { alAvisar?(aviso) }
}
