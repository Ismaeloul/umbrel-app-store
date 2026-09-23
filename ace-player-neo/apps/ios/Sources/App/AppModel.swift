import Foundation
import Network
import Observation
import os

/// Estado global de la app: si está emparejada, con qué servidor habla, el
/// estado del motor y la conexión de tiempo real.
@MainActor
@Observable
public final class AppModel {
    public enum Fase: Equatable {
        /// Sin token o sin servidor: pantalla de emparejamiento.
        case emparejar
        /// Emparejada: la app de verdad.
        case lista
    }

    public enum EstadoConexion: Equatable {
        case conectando
        case conectado(ActiveServer)
        case sinConexion(String)
    }

    public private(set) var fase: Fase
    public private(set) var conexion: EstadoConexion = .conectando
    public private(set) var motor: EngineStatus?
    public private(set) var biblioteca: LibraryView?
    public private(set) var versionServidor: String?
    /// Aviso para enseñar una vez (p. ej. «se ha retirado el acceso»).
    public var aviso: String?
    /// Sube con cada `resync` o cambio relevante: las pantallas lo observan para recargar.
    public private(set) var recargas = 0

    /// Marcadores en vivo (ESPN) por id de partido.
    public private(set) var marcadores: [String: LiveScore] = [:]

    public let entorno: Entorno
    /// El reproductor de toda la app (sigue sonando al salir del partido).
    public let reproductor: Reproductor
    public let pip: GestorPiP
    public let avisos: Avisos
    private let controles: ControlesSistema
    @ObservationIgnored private var centros: [String: CentroPartidoModelo] = [:]
    @ObservationIgnored private var tareaTiempoReal: Task<Void, Never>?
    @ObservationIgnored private var tareaAccesoPerdido: Task<Void, Never>?
    @ObservationIgnored private var monitorRed: NWPathMonitor?
    @ObservationIgnored private var estuvoEnSegundoPlano = false

    /// - Parameter reproductor: solo en los tests (uno sin vigilante ni esperas
    ///   reales); si falta, se crea el de verdad con `motor` o con AVPlayer.
    public init(entorno: Entorno, motor: (any MotorVideo)? = nil, reproductor: Reproductor? = nil) {
        self.entorno = entorno
        let tieneToken = ((try? entorno.tokens.leerToken()) ?? nil) != nil
        fase = tieneToken && !entorno.configuracion.leer().vacia ? .lista : .emparejar
        let elegido =
            reproductor
            ?? Reproductor(
                motor: motor ?? Self.motorPorDefecto(), servicio: ServicioReproduccionAPI(api: entorno.api),
                visor: IdentidadVisor.id(), preferencias: .standard)
        self.reproductor = elegido
        pip = GestorPiP()
        avisos = Avisos()
        controles = ControlesSistema()
        controles.conectar(elegido)
        pip.alRestaurar = { [weak self] in self?.restaurarDesdePiP() }
        tareaAccesoPerdido = Task { [weak self] in
            for await _ in entorno.accesoPerdido {
                self?.accesoRetirado()
            }
        }
    }

    // MARK: Emparejamiento

    /// Llamado por la pantalla de emparejamiento cuando el servidor ha dado el token.
    public func emparejado() {
        aviso = nil
        fase = .lista
    }

    /// «Olvidar este servidor»: borra token, direcciones y caché.
    public func desemparejar() async {
        reproductor.detener()
        centros = [:]
        pararTiempoReal()
        try? entorno.tokens.borrarToken()
        entorno.configuracion.borrar()
        await entorno.servidores.actualizar(ServerConfig())
        await entorno.cache.borrarTodo()
        motor = nil
        biblioteca = nil
        fase = .emparejar
    }

    private func accesoRetirado() {
        guard fase == .lista else { return }
        reproductor.detener()
        pararTiempoReal()
        aviso = ErrorCatalog.mensaje(para: "device_revoked")
        fase = .emparejar
    }

    // MARK: Arranque y tiempo real

    /// Pinta primero lo guardado y luego pide el arranque al servidor.
    public func arrancar() async {
        if biblioteca == nil, let guardada = await entorno.cache.leer(LibraryView.self, de: .biblioteca) {
            biblioteca = guardada.valor
        }
        vigilarRed()
        arrancarTiempoReal()
        await refrescarArranque()
    }

    public func refrescarArranque() async {
        do {
            let arranque = try await entorno.api.enviar(API.bootstrap)
            motor = arranque.engine
            biblioteca = arranque.library
            versionServidor = arranque.version
            reproductor.dispositivoId = arranque.device?.id
            if let activo = await entorno.servidores.conocido() { conexion = .conectado(activo) }
            try? await entorno.cache.guardar(arranque.library, en: .biblioteca)
        } catch let error as APIError {
            if case .necesitaEmparejar = error { return }
            conexion = .sinConexion(error.mensaje)
        } catch {
            conexion = .sinConexion(APIError.desde(error).mensaje)
        }
    }

    public func arrancarTiempoReal() {
        guard fase == .lista, tareaTiempoReal == nil else { return }
        let flujo = entorno.tiempoReal.conectar()
        tareaTiempoReal = Task { [weak self] in
            for await cambio in flujo {
                guard let self else { return }
                self.procesar(cambio)
            }
        }
    }

    public func pararTiempoReal() {
        tareaTiempoReal?.cancel()
        tareaTiempoReal = nil
    }

    private func procesar(_ cambio: SSEUpdate) {
        switch cambio {
        case .conectado(let servidor):
            conexion = .conectado(servidor)
        case .desconectado(let error, _):
            if let error { conexion = .sinConexion(error.mensaje) }
        case .necesitaEmparejar:
            accesoRetirado()
        case .evento(let sobre):
            reproductor.procesar(sobre.event)
            for centro in centros.values { centro.procesar(sobre.event) }
            switch sobre.event {
            case .engineStatus(let estado):
                motor = estado
            case .stateChanged(let datos) where datos.scopes.contains(.library) || datos.scopes.contains(.directories):
                Task { await self.refrescarArranque() }
            case .resync:
                recargas += 1
                Task { await self.refrescarArranque() }
            default:
                break
            }
        }
    }

    /// Si cambia la red del teléfono (casa ↔ datos), se vuelve a elegir dirección.
    private func vigilarRed() {
        guard monitorRed == nil else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = Self.alCambiarLaRed(entorno.servidores)
        monitor.start(queue: DispatchQueue(label: "es.ismaeloul.aceplayerneo.red"))
        monitorRed = monitor
    }

    /// Se crea fuera del actor principal: Network llama al manejador en su cola.
    /// La primera llamada es el estado inicial y no cuenta como cambio.
    private nonisolated static func alCambiarLaRed(_ servidores: ServerResolver) -> @Sendable (NWPath) -> Void {
        let primera = OSAllocatedUnfairLock(initialState: true)
        return { _ in
            let esLaPrimera = primera.withLock { valor in
                defer { valor = false }
                return valor
            }
            guard !esLaPrimera else { return }
            Task { await servidores.invalidar() }
        }
    }

    /// Al volver a primer plano: comprobar la señal y reconectar si hacía falta.
    public func volvioAPrimerPlano() {
        pip.soltarCapas(false, player: reproductor.motor.avPlayer)
        guard fase == .lista, estuvoEnSegundoPlano else { return }
        estuvoEnSegundoPlano = false
        arrancarTiempoReal()
        reproductor.volvioAPrimerPlano()
        Task { await refrescarArranque() }
    }

    /// En segundo plano no se mantiene el SSE (iOS lo cortaría igual). Si
    /// suena algo sin PiP, la capa se suelta para que siga el audio.
    public func pasoASegundoPlano() {
        estuvoEnSegundoPlano = true
        pararTiempoReal()
        if reproductor.canal != nil && reproductor.quiereReproducir {
            pip.soltarCapas(true, player: reproductor.motor.avPlayer)
        }
    }

    /// Al volver del PiP: si no se está viendo el partido, el reproductor a pantalla completa.
    private func restaurarDesdePiP() {
        if reproductor.superficiesGrandes == 0 { reproductor.pantallaCompleta = true }
    }

    // MARK: Partidos

    /// El modelo de fuentes de un partido (el mismo mientras suene o esté abierto).
    public func centro(para partido: FootballMatch) -> CentroPartidoModelo {
        if let existente = centros[partido.id] { return existente }
        // Solo se guardan el que suena y el abierto: el resto se descarta.
        let sonando = reproductor.canal?.partido?.id
        centros = centros.filter { $0.key == sonando || $0.value.vistaAbierta }
        let nuevo = CentroPartidoModelo(partido: partido, app: self)
        centros[partido.id] = nuevo
        return nuevo
    }

    /// Reproduce un canal suelto (biblioteca, búsqueda): sin política de fuentes de partido.
    public func reproducirCanal(_ canal: CanalReproducible, lista: [CanalReproducible] = []) {
        reproductor.alFallarFuente = nil
        reproductor.reproducir(canal, origen: .usuario, lista: lista)
    }

    // MARK: Marcadores

    public func refrescarMarcadores() async {
        guard fase == .lista else { return }
        if let respuesta = try? await entorno.api.enviar(API.marcadores), respuesta.available {
            marcadores = respuesta.scores
        }
    }

    /// Refresca los marcadores cada minuto mientras la vista que lo pide siga viva.
    public func vigilarMarcadores() async {
        while !Task.isCancelled {
            await refrescarMarcadores()
            try? await Task.sleep(for: .seconds(60))
        }
    }

    // MARK: Biblioteca

    public func esFavorito(_ id: String) -> Bool {
        biblioteca?.favorites.contains { $0.id.lowercased() == id.lowercased() } ?? false
    }

    /// Añade o quita de favoritos.
    public func alternarFavorito(id: String, titulo: String, ih: Bool?) async {
        let quitar = esFavorito(id)
        let cambio: LibraryMutation =
            quitar
            ? .delete(collection: .favorites, id: id)
            : .favoriteUpsert(ItemInput(id: id, title: String(titulo.prefix(500)), ih: ih))
        await mutar(cambio, aviso: quitar ? "Quitado de favoritos" : "Añadido a favoritos")
    }

    /// Aplica un cambio a la biblioteca y guarda lo que devuelve el servidor.
    @discardableResult
    public func mutar(_ cambio: LibraryMutation, aviso: String? = nil) async -> Bool {
        do {
            let nueva = try await entorno.api.enviar(API.cambiarBiblioteca(cambio))
            aplicarBiblioteca(nueva)
            if let aviso { avisos.mostrar(aviso, tono: .ok) }
            return true
        } catch {
            let convertido = APIError.desde(error)
            if case .cancelado = convertido { return false }
            avisos.mostrar(convertido.mensaje, tono: .error)
            return false
        }
    }

    /// Cambio local inmediato (p. ej. al borrar, antes de que conteste el servidor).
    public func aplicarBiblioteca(_ nueva: LibraryView) {
        biblioteca = nueva
        let cache = entorno.cache
        Task { try? await cache.guardar(nueva, en: .biblioteca) }
    }

    /// Cambia la lista (directorio) activa.
    public func activarLista(_ id: String) async {
        do {
            let directorio = try await entorno.api.enviar(API.activarDirectorio(id: id))
            if var actual = biblioteca {
                actual.web = directorio.web
                actual.webSources = directorio.webSources
                actual.activeWebSourceId = directorio.activeWebSourceId
                actual.webSyncedAt = directorio.webSyncedAt
                aplicarBiblioteca(actual)
            }
        } catch {
            avisos.mostrar(APIError.desde(error).mensaje, tono: .error)
        }
    }

    // MARK: Motor

    public func reiniciarMotor() async {
        do {
            let respuesta = try await entorno.api.enviar(API.reiniciarMotor)
            avisos.mostrar(
                respuesta.restarted ? "Reiniciando el motor…" : "El motor no se ha podido reiniciar ahora",
                tono: respuesta.restarted ? .ok : .error)
            if let estado = try? await entorno.api.enviar(API.estadoMotor) { motor = estado }
        } catch {
            avisos.mostrar(APIError.desde(error).mensaje, tono: .error)
        }
    }

    /// El motor de vídeo: AVPlayer, o el simulado en las pruebas de interfaz.
    private static func motorPorDefecto() -> any MotorVideo {
        #if DEBUG
            if ModoEjecucion.servidorSimulado { return MotorSimulado() }
        #endif
        return MotorAVPlayer()
    }
}
