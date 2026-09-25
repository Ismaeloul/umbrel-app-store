import Foundation
import Network
import Observation
import os
import UIKit

/// Lo que enseña el escenario (la única superficie de reproducción, a pantalla completa).
public enum ObjetivoEscenario: Hashable, Sendable {
    case partido(FootballMatch)
    case canal(CanalReproducible)

    public var id: String {
        switch self {
        case .partido(let partido): "partido:\(partido.id)"
        case .canal(let canal): "canal:\(canal.id)"
        }
    }
}

/// Qué pestaña se ve.
public enum Pestana: Hashable, Sendable {
    case agenda, canales, buscar, ajustes
}

/// Estado global de la app: si está emparejada, con qué servidor habla, el
/// estado del motor, la conexión de tiempo real y qué enseña el escenario.
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
    /// Lo que enseña el escenario (nil: cerrado).
    public private(set) var escenario: ObjetivoEscenario?
    /// Marcadores destapados a mano (anti-spoiler); se vacía al cambiar de canal.
    public private(set) var marcadoresDestapados: Set<String> = []
    /// Goles deducidos de dos lecturas del marcador (lado y minuto), por partido.
    public private(set) var goles: [String: [Gol]] = [:]
    /// Sube cada vez que se crea un centro de partido: las tarjetas releen su cápsula de señal.
    public private(set) var centrosVersion = 0

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
        escenario = nil
        centros = [:]
        centrosVersion += 1
        marcadoresDestapados = []
        goles = [:]
        pararTiempoReal()
        try? entorno.tokens.borrarToken()
        entorno.configuracion.borrar()
        await entorno.servidores.actualizar(ServerConfig())
        await entorno.cache.borrarTodo()
        await entorno.imagenes.borrarTodo()
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
        if preferencias == nil, let guardadas = await entorno.cache.leer(Preferences.self, de: .preferencias) {
            preferencias = guardadas.valor
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
            try? await entorno.cache.guardar(arranque.preferences, en: .preferencias)
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
        // Con el PiP abierto, el vídeo vuelve al reproductor grande (salvo que
        // se vea el del partido). Se abre YA: AVKit no siempre pide restaurar
        // la interfaz cuando el PiP se cierra desde la app.
        if pip.activo, reproductor.canal != nil, reproductor.superficiesGrandes == 0, !reproductor.expandido {
            reproductor.expandir()
        }
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

    /// Al abrirse el PiP con el escenario delante, se minimiza: se sigue
    /// usando la app con el vídeo en la ventanita.
    private func empezoElPiP() {
        guard reproductor.expandido || escenario != nil else { return }
        Orientacion.pedir(.portrait)
        cerrarEscenario()
    }

    // MARK: Escenario

    /// Lo que se ve en el escenario: lo abierto a propósito o, si el
    /// reproductor está expandido (vuelta del PiP, giro), lo que suena.
    public var escenarioVisible: ObjetivoEscenario? {
        if let escenario { return escenario }
        guard reproductor.vista == .grande else { return nil }
        return objetivoDeLoQueSuena
    }

    /// El partido (si se conoce) o el canal que suena ahora.
    public var objetivoDeLoQueSuena: ObjetivoEscenario? {
        guard let canal = reproductor.canal else { return nil }
        if let id = canal.partido?.id, let centro = centros[id] { return .partido(centro.partido) }
        return .canal(canal)
    }

    /// Abre el escenario con un partido (sin reproducir nada: eso lo decide la persona o el arranque automático).
    public func abrirPartido(_ partido: FootballMatch) {
        _ = centro(para: partido)
        escenario = .partido(partido)
        reproductor.expandir()
    }

    /// «Ver ahora»: abre el escenario y arranca la mejor fuente que haya.
    public func verPartido(_ partido: FootballMatch) {
        abrirPartido(partido)
        centro(para: partido).verAhora()
    }

    /// Reproduce un canal suelto y abre su escenario.
    public func abrirCanal(_ canal: CanalReproducible, lista: [CanalReproducible] = []) {
        reproducirCanal(canal, lista: lista)
        escenario = .canal(canal)
        reproductor.expandir()
    }

    /// Un Content ID pegado o un resultado del motor: se reproduce como canal
    /// suelto con un título legible, sin guardarlo en recientes.
    public func reproducirEnlace(_ hash: String, titulo: String = "Enlace pegado") {
        abrirCanal(CanalReproducible(id: hash, titulo: titulo, ih: nil, origen: "manual"))
    }

    /// Abre el escenario con lo que suena (giro a horizontal, vuelta del PiP).
    public func abrirLoQueSuena() {
        guard let objetivo = objetivoDeLoQueSuena else { return }
        escenario = objetivo
        reproductor.expandir()
    }

    /// Minimiza: vuelve a las pestañas (con el mini si algo suena).
    public func cerrarEscenario() {
        escenario = nil
        reproductor.minimizar()
    }

    /// Mientras el escenario está abierto sigue a lo que suena (zapping,
    /// «Ver aquí», siguiente canal desde la pantalla de bloqueo).
    public func seguirLoQueSuena() {
        guard escenario != nil, let objetivo = objetivoDeLoQueSuena else { return }
        if case .partido(let abierto) = escenario, case .partido(let sonando) = objetivo, abierto.id == sonando.id {
            return
        }
        if case .canal(let abierto) = escenario, case .canal(let sonando) = objetivo, abierto.id == sonando.id {
            return
        }
        escenario = objetivo
        reproductor.expandir()
    }

    // MARK: Marcador tapado y goles

    /// ¿Va tapado el marcador de este partido? Solo mientras se ve ESE partido y está en juego.
    public func marcadorTapado(_ partido: FootballMatch) -> Bool {
        AntiSpoiler.tapado(
            partido: partido.id, marcador: marcadores[partido.id], viendo: reproductor.canal?.partido?.id,
            destapados: marcadoresDestapados)
    }

    public func destaparMarcador(_ id: String, _ destapar: Bool = true) {
        if destapar {
            marcadoresDestapados.insert(id)
        } else {
            marcadoresDestapados.remove(id)
        }
    }

    /// Al cambiar de canal se vuelve a tapar todo.
    public func taparMarcadores() {
        if !marcadoresDestapados.isEmpty { marcadoresDestapados = [] }
    }

    // MARK: Imágenes

    /// La dirección con la que se está hablando (o la guardada, mientras no responde ninguna).
    public var baseServidor: URL? {
        if case .conectado(let servidor) = conexion { return servidor.url }
        return entorno.configuracion.leer().candidatas.first?.url
    }

    /// URL absoluta de una imagen del servidor (`/api/v1/football/teams/…/crest?v=…`):
    /// la base que responde y el prefijo `/native`, como la URL del vídeo.
    public func urlImagen(_ relativa: String?) -> URL? {
        guard let relativa, relativa.hasPrefix("/"), let base = baseServidor else { return nil }
        return URL(string: "/native" + relativa, relativeTo: base)?.absoluteURL
    }

    /// Pide por adelantado los escudos y logos de unos partidos (los del día).
    public func precalentarEscudos(_ partidos: [FootballMatch]) {
        var urls: [URL] = []
        for partido in partidos {
            for ruta in [partido.homeTeam?.crest, partido.awayTeam?.crest, partido.competitionBadge?.logo] {
                if let url = urlImagen(ruta) { urls.append(url) }
            }
        }
        guard !urls.isEmpty else { return }
        let imagenes = entorno.imagenes
        Task { await imagenes.precalentar(urls) }
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
            try? await entorno.cache.guardar(respuesta.preferences, en: .preferencias)
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

    /// El modelo de fuentes de un partido (el mismo mientras suene, esté abierto o esté precalentado).
    public func centro(para partido: FootballMatch) -> CentroPartidoModelo {
        if let existente = centros[partido.id] { return existente }
        // Se guardan el que suena, el abierto y los precalentados por la agenda: el resto se descarta.
        let sonando = reproductor.canal?.partido?.id
        centros = centros.filter { $0.key == sonando || $0.value.vistaAbierta || $0.value.precalentado }
        let nuevo = CentroPartidoModelo(partido: partido, app: self)
        centros[partido.id] = nuevo
        centrosVersion += 1
        return nuevo
    }

    /// El centro de un partido SOLO si ya existe (las tarjetas de la agenda no crean ninguno).
    public func centroCargado(_ id: String) -> CentroPartidoModelo? {
        centros[id]
    }

    /// Pide las fuentes de los partidos que van en directo o empiezan en menos
    /// de 45 min, para que la cápsula de la tarjeta diga «Señal», «Floja»…
    public func precalentar(_ partidos: [FootballMatch]) {
        for partido in partidos.prefix(6) where centros[partido.id]?.precalentado != true {
            let modelo = centro(para: partido)
            Task { await modelo.precalentar() }
        }
    }

    /// Detener desde el mini o el escenario, con «Deshacer» durante 6 s.
    public func detenerConDeshacer() {
        guard reproductor.canal != nil else { return }
        let titulo = reproductor.canal?.partido?.titulo ?? reproductor.canal?.titulo ?? ""
        reproductor.detener()
        let aviso = Aviso(titulo.isEmpty ? "Reproducción detenida" : "«\(titulo)» detenido", accion: "Deshacer", duracion: 6)
        avisos.mostrar(aviso) { [weak self] in
            _ = self?.reproductor.deshacerDetencion()
        }
    }

    /// Qué pestaña quiere abrir alguien desde fuera de las pestañas (el menú «Más» del escenario).
    public var pestanaSolicitada: Pestana?

    public func pedirPestana(_ pestana: Pestana) {
        cerrarEscenario()
        pestanaSolicitada = pestana
    }

    /// Reproduce un canal suelto (biblioteca, búsqueda): sin política de fuentes de partido.
    public func reproducirCanal(_ canal: CanalReproducible, lista: [CanalReproducible] = []) {
        reproductor.alFallarFuente = nil
        reproductor.reproducir(canal, origen: .usuario, lista: lista)
    }

    /// Canales de la biblioteca cuyo nombre casa con el canal anunciado por la agenda («Dónde se emite»).
    public func canalesDeBiblioteca(para nombre: String) -> [Item] {
        guard let biblioteca else { return [] }
        let clave = Canales.clave(nombre)
        var vistos = Set<String>()
        return (biblioteca.favorites + biblioteca.web + biblioteca.history).filter { item in
            guard vistos.insert(item.id.lowercased()).inserted else { return false }
            return Canales.puntuacionDeClaves(Canales.clave(item.title), clave) >= Canales.puntuacionExacta
                || (item.alias.map { Canales.puntuacionDeClaves(Canales.clave($0), clave) >= Canales.puntuacionExacta } ?? false)
        }
    }

    /// Un elemento de la biblioteca como canal reproducible.
    public func canalReproducible(_ item: Item) -> CanalReproducible {
        CanalReproducible(
            id: item.id, titulo: item.title, ih: item.ih,
            listaId: item.type == .web ? biblioteca?.activeWebSourceId : nil,
            origen: item.type == .web ? "m3u" : (item.type == .fav ? "favorites" : "history"))
    }

    // MARK: Marcadores

    public func refrescarMarcadores() async {
        guard fase == .lista else { return }
        if let respuesta = try? await entorno.api.enviar(API.marcadores), respuesta.available {
            goles = RegistroGoles.anotar(anteriores: marcadores, nuevos: respuesta.scores, goles: goles)
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
            aplicarDirectorio(try await entorno.api.enviar(API.activarDirectorio(id: id)))
        } catch {
            avisos.mostrar(APIError.desde(error).mensaje, tono: .error)
        }
    }

    /// Guarda (o vuelve a descargar, con `id`) una lista remota M3U o HTML.
    @discardableResult
    public func sincronizarLista(url: String, nombre: String? = nil, tipo: WebSourceType = .m3u, id: String? = nil)
        async -> Bool
    {
        do {
            let cuerpo = DirectorySyncBody(url: url, type: tipo, sourceId: id, name: nombre)
            aplicarDirectorio(try await entorno.api.enviar(API.sincronizarDirectorio(cuerpo)))
            avisos.mostrar(id == nil ? "Lista guardada" : "Lista actualizada", tono: .ok)
            return true
        } catch {
            let convertido = APIError.desde(error)
            if case .cancelado = convertido { return false }
            avisos.mostrar(convertido.mensaje, tono: .error)
            return false
        }
    }

    /// Borra una lista guardada (el servidor no deja borrar la última).
    public func borrarLista(_ id: String) async {
        do {
            aplicarDirectorio(try await entorno.api.enviar(API.borrarDirectorio(id: id)))
            avisos.mostrar("Lista borrada", tono: .ok)
        } catch {
            avisos.mostrar(APIError.desde(error).mensaje, tono: .error)
        }
    }

    private func aplicarDirectorio(_ directorio: DirectoryView) {
        guard var actual = biblioteca else { return }
        actual.web = directorio.web
        actual.webSources = directorio.webSources
        actual.activeWebSourceId = directorio.activeWebSourceId
        actual.webSyncedAt = directorio.webSyncedAt
        aplicarBiblioteca(actual)
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
