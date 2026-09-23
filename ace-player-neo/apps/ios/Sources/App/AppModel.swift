import Foundation
import Network
import Observation
import os
import UIKit

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

    /// Gustos de fútbol guardados en el servidor (los mismos que usa la web).
    public private(set) var preferencias: Preferences?
    /// La última agenda cargada (la biblioteca la usa para «Emitiendo» / «A las…»).
    public private(set) var agenda: FootballSchedule?
    /// Sesiones abiertas en el motor: «Dónde se está reproduciendo».
    public private(set) var sesiones: [SessionSummary] = []
    /// Ya se ha preguntado al servidor por las sesiones (para no enseñar «nada» antes de saberlo).
    public private(set) var sesionesCargadas = false
    /// Id de este iPhone en el servidor (del arranque).
    public private(set) var dispositivoId: String?

    /// Los gustos para las reglas de «Para ti».
    public var gustos: GustosFutbol { GustosFutbol(preferencias) }

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
    ///   `pip`: solo en los tests (con un controlador de PiP de mentira).
    public init(
        entorno: Entorno, motor: (any MotorVideo)? = nil, reproductor: Reproductor? = nil, pip: GestorPiP? = nil
    ) {
        self.entorno = entorno
        let tieneToken = ((try? entorno.tokens.leerToken()) ?? nil) != nil
        fase = tieneToken && !entorno.configuracion.leer().vacia ? .lista : .emparejar
        let elegido =
            reproductor
            ?? Reproductor(
                motor: motor ?? Self.motorPorDefecto(), servicio: ServicioReproduccionAPI(api: entorno.api),
                visor: IdentidadVisor.id(), preferencias: .standard)
        self.reproductor = elegido
        let gestor = pip ?? GestorPiP()
        self.pip = gestor
        avisos = Avisos()
        controles = ControlesSistema()
        controles.conectar(elegido)
        // Una sola capa de vídeo para toda la app, con su PiP.
        gestor.conectar(elegido.motor.avPlayer)
        gestor.alRestaurar = { [weak self] in await self?.restaurarDesdePiP() }
        gestor.alEmpezar = { [weak self] in self?.empezoElPiP() }
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
        preferencias = nil
        agenda = nil
        sesiones = []
        sesionesCargadas = false
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
            if preferencias != arranque.preferences { preferencias = arranque.preferences }
            if sesiones != arranque.playback.sessions { sesiones = arranque.playback.sessions }
            if !sesionesCargadas { sesionesCargadas = true }
            dispositivoId = arranque.device?.id
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
            case .playbackSessions(let datos):
                if sesiones != datos.sessions { sesiones = datos.sessions }
                if !sesionesCargadas { sesionesCargadas = true }
            case .streamClosed, .playbackNowPlaying:
                // Servidores sin `playback.sessions`: la lista se pide otra vez.
                Task { await self.refrescarSesiones() }
            case .stateChanged(let datos)
            where datos.scopes.contains(.library) || datos.scopes.contains(.directories)
                || datos.scopes.contains(.preferences):
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

    /// Al volver a primer plano: la capa recupera el vídeo y, si seguía el
    /// PiP, se cierra y el vídeo vuelve al reproductor (nunca dos a la vez);
    /// después se comprueba la señal y se reconecta si hacía falta.
    public func volvioAPrimerPlano() {
        pip.volvioAPrimerPlano()
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
            pip.pasoASegundoPlano()
        }
    }

    /// AVKit va a devolver el vídeo del PiP: se enseña el reproductor grande
    /// (salvo que ya se vea el del partido) y se espera a que esté en su sitio.
    func restaurarDesdePiP() async {
        if reproductor.canal != nil && reproductor.superficiesGrandes == 0 && !reproductor.expandido {
            reproductor.expandir()
        }
        // Que el reproductor grande entre en pantalla y la capa pase a su hueco.
        try? await Task.sleep(for: .milliseconds(450))
        pip.superficie.recolocar()
    }

    /// Al abrirse el PiP con el reproductor grande delante, se minimiza: se
    /// sigue usando la app con el vídeo en la ventanita.
    private func empezoElPiP() {
        guard reproductor.expandido else { return }
        Orientacion.pedir(.portrait)
        reproductor.minimizar()
    }

    // MARK: Dónde se está reproduciendo

    /// Pide la lista de sesiones abiertas (respaldo del evento `playback.sessions`).
    public func refrescarSesiones() async {
        guard fase == .lista else { return }
        do {
            let estado = try await entorno.api.enviar(API.estadoReproduccion)
            if sesiones != estado.sessions { sesiones = estado.sessions }
            if !sesionesCargadas { sesionesCargadas = true }
        } catch {
            // Sin red se queda la última lista: la sección lo dice con su estado de conexión.
        }
    }

    /// Mientras la sección está en pantalla: la lista al entrar y un repaso
    /// cada 20 s por si el servidor no manda el evento.
    public func vigilarSesiones() async {
        while !Task.isCancelled {
            await refrescarSesiones()
            try? await Task.sleep(for: .seconds(20))
        }
    }

    /// Título conocido de un canal por su hash (biblioteca o lo que suena).
    public func tituloConocido(_ hash: String) -> String? {
        let id = hash.lowercased()
        if let canal = reproductor.canal, canal.id.lowercased() == id { return canal.partido?.titulo ?? canal.titulo }
        guard let biblioteca else { return nil }
        let todos = biblioteca.favorites + biblioteca.history + biblioteca.web
        return todos.first { $0.id.lowercased() == id }?.title
    }

    // MARK: Agenda y gustos

    /// La agenda que acaba de cargar la pantalla de la agenda.
    public func agendaCargada(_ nueva: FootballSchedule?) {
        guard let nueva else { return }
        agenda = nueva
    }

    /// Si aún no hay agenda en memoria, la guardada en disco (para la biblioteca).
    public func cargarAgendaGuardada() async {
        guard agenda == nil, let guardada = await entorno.cache.leer(FootballSchedule.self, de: .agenda) else { return }
        agenda = guardada.valor
    }

    /// Guarda los gustos (PUT sustituye lo que se manda) y los aplica ya.
    @discardableResult
    public func guardarGustos(_ gustos: GustosFutbol, completar: Bool = true) async -> Bool {
        let cuerpo = PreferencesInput(
            onboardingComplete: completar ? true : nil, country: preferencias?.country, leagues: gustos.leagues,
            teams: gustos.teams, nationalities: gustos.nationalities)
        do {
            let respuesta = try await entorno.api.enviar(API.guardarPreferencias(cuerpo))
            preferencias = respuesta.preferences
            return true
        } catch {
            let convertido = APIError.desde(error)
            if case .cancelado = convertido { return false }
            avisos.mostrar(convertido.mensaje, tono: .error)
            return false
        }
    }

    /// Si todavía no se sabe nada de los gustos (arranque sin red), se piden.
    public func cargarPreferencias() async {
        guard preferencias == nil else { return }
        if let respuesta = try? await entorno.api.enviar(API.preferencias) {
            preferencias = respuesta.preferences
        }
    }

    // MARK: Partidos

    /// El centro de partido de lo que suena (si suena un partido): el
    /// reproductor grande enseña sus fuentes.
    public var centroSonando: CentroPartidoModelo? {
        guard let id = reproductor.canal?.partido?.id else { return nil }
        return centros[id]
    }

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
