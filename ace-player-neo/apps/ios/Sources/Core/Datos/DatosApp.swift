import Foundation
import Observation

/* Los datos de la app (b-arquitectura §2.5.2, I0→M1): una `Consulta<T>` por ruta de lectura y las
   mutaciones con escritura directa en la caché (a7 §4.3). Vida de proceso (en `ContenedorApp`).
   - Arranque (a7 §5): `sembrar(con:)` rellena con UNA petición biblioteca, gustos, reproducción y motor
     (`seedFromBootstrap` de api/boot.ts); en demo no se siembra nada (cada consulta pide la suya).
   - `pintarEnFrio()` enseña lo último guardado en disco (agenda, biblioteca, arranque, gustos) mientras
     llega la red (a2 §23.1); lo que llega de la red se vuelve a guardar.
   - Las rutas de administración de la 0.8.1 (salud, dispositivos, ajustes, códigos) avisan de su 403
     `origin_forbidden` o de su 2xx para las capacidades (a9 §9.1). */

@MainActor @Observable final class DatosApp {
    let arranque: Consulta<BootstrapResponse>
    let agenda: Consulta<FootballSchedule>
    let biblioteca: Consulta<LibraryView>
    let preferencias: Consulta<PreferencesResponse>
    let ajustes: Consulta<SettingsResponse>
    let directorios: Consulta<DirectoryView>
    let motor: Consulta<EngineStatus>
    let reproduccion: Consulta<PlaybackStatus>
    let marcadores: Consulta<ScoresResponse>
    let dispositivos: Consulta<DevicesListResponse>
    let salud: Consulta<HealthResponse>
    let diagnosticos: Consulta<DiagnosticsListResponse>
    // Sin observar: cada vista mira su consulta, no la tabla (crear una no repinta las demás).
    @ObservationIgnored private(set) var precalentados: [String: Consulta<PreheatResponse>] = [:]
    @ObservationIgnored private(set) var trabajos: [String: Consulta<ScanJob>] = [:]
    @ObservationIgnored private(set) var busquedas: [String: Consulta<SearchResponse>] = [:]
    var tiempoRealAbierto = false

    /// 403 `origin_forbidden` (u otro fallo) de una ruta de administración: lo apunta `SesionApp`.
    @ObservationIgnored var alFallarAdministracion: ((APIError, RutaAdministracion) -> Void)?
    /// 2xx de una ruta de administración: el servidor ya es 0.8.1.
    @ObservationIgnored var alAbrirAdministracion: ((RutaAdministracion) -> Void)?
    /// Cada `bootstrap` nuevo (VigiaVersion lo usa como lectura de versión, a7 §5.2).
    @ObservationIgnored var alLlegarArranque: ((BootstrapResponse) -> Void)?
    /// El reloj de la frescura de todas las consultas (el de la app; -AceNeoReloj en Debug).
    @ObservationIgnored var reloj: any Reloj = RelojSistema() {
        didSet { for consulta in fijas { consulta.reloj = reloj } }
    }

    /// Límite de `diagnosticsList` en Salud (a7 §4.2: `{limit: 200}`).
    static let limiteDiagnosticos = 200
    /// Tras «Reiniciar el motor» se vuelve a mirar a los 2,5 s (a7 §4.3).
    static let esperaTrasReiniciar: Duration = .milliseconds(2500)
    /// Una consulta con parámetro que nadie mira desde hace 5 min se tira al crear otra (`gcTime` de
    /// api/query.ts): así `busquedas` no crece con cada `q` tecleada.
    static let recogerTras: TimeInterval = 5 * 60

    private let api: APIClient
    private let cache: DiskCache
    private let esDemo: Bool

    init(api: APIClient, cache: DiskCache) {
        self.api = api
        self.cache = cache
        esDemo = ModoEjecucion.demo
        arranque = Consulta(.porDefecto) { try await api.enviar(API.bootstrap) }
        agenda = Consulta(.agenda) { try await api.enviar(API.agenda) }
        biblioteca = Consulta { try await api.enviar(API.biblioteca) }
        preferencias = Consulta { try await api.enviar(API.preferencias) }
        ajustes = Consulta { try await api.enviar(API.ajustes) }
        directorios = Consulta { try await api.enviar(API.directorios) }
        motor = Consulta { try await api.enviar(API.estadoMotor) }
        reproduccion = Consulta { try await api.enviar(API.estadoReproduccion) }
        marcadores = Consulta(.marcadores) { try await api.enviar(API.marcadores) }
        dispositivos = Consulta(.alMontar) { try await api.enviar(API.dispositivos) }
        salud = Consulta(.alMontar) { try await api.enviar(API.salud) }
        let limite = Self.limiteDiagnosticos
        diagnosticos = Consulta(.alMontar) { try await api.enviar(API.diagnosticos(limite: limite)) }
        engancharAdministracion()
        engancharDisco()
    }

    /// Las consultas fijas (sin las de por partido, trabajo o búsqueda).
    private var fijas: [any ConsultaVaciable] {
        [
            arranque, agenda, biblioteca, preferencias, ajustes, directorios, motor, reproduccion, marcadores,
            dispositivos, salud, diagnosticos,
        ]
    }

    private func engancharAdministracion() {
        dispositivos.alFallar = { [weak self] error in self?.alFallarAdministracion?(error, .devicesList) }
        dispositivos.alEscribir = { [weak self] _ in self?.alAbrirAdministracion?(.devicesList) }
        salud.alFallar = { [weak self] error in self?.alFallarAdministracion?(error, .health) }
        salud.alEscribir = { [weak self] _ in self?.alAbrirAdministracion?(.health) }
    }

    /// Lo que llega de la red se guarda para pintar en frío la próxima vez (a2 §23.1).
    private func engancharDisco() {
        let cache = self.cache
        arranque.alEscribir = { [weak self] valor in
            Task { try? await cache.guardar(valor, en: .arranque) }
            self?.alLlegarArranque?(valor)
        }
        agenda.alEscribir = { valor in Task { try? await cache.guardar(valor, en: .agenda) } }
        biblioteca.alEscribir = { valor in Task { try? await cache.guardar(valor, en: .biblioteca) } }
        preferencias.alEscribir = { valor in Task { try? await cache.guardar(valor, en: .preferencias) } }
    }

    // MARK: Arranque

    /// `seedFromBootstrap` (api/boot.ts): arranque, biblioteca, gustos, reproducción y motor con UNA
    /// petición. En demo no se siembra (a7 §5 punto 2).
    func sembrar(con arranque: BootstrapResponse) {
        self.arranque.escribir(arranque)
        guard !esDemo else { return }
        biblioteca.escribir(arranque.library)
        preferencias.escribir(PreferencesResponse(preferences: arranque.preferences))
        reproduccion.escribir(arranque.playback)
        motor.escribir(arranque.engine)
    }

    /// DiskCache: agenda, biblioteca, arranque y gustos, caducados (se vuelven a pedir).
    func pintarEnFrio() async {
        if let entrada = await cache.leer(FootballSchedule.self, de: .agenda) { agenda.pintarEnFrio(entrada.valor) }
        if let entrada = await cache.leer(LibraryView.self, de: .biblioteca) { biblioteca.pintarEnFrio(entrada.valor) }
        if let entrada = await cache.leer(BootstrapResponse.self, de: .arranque) { arranque.pintarEnFrio(entrada.valor) }
        if let entrada = await cache.leer(PreferencesResponse.self, de: .preferencias) {
            preferencias.pintarEnFrio(entrada.valor)
        }
    }

    // MARK: Invalidar

    func invalidar(_ rutas: Set<RutaConsulta>) {
        for ruta in rutas { invalidar(ruta) }
    }

    private func invalidar(_ ruta: RutaConsulta) {
        switch ruta {
        case .bootstrap: arranque.invalidar()
        case .libraryGet: biblioteca.invalidar()
        case .preferencesGet: preferencias.invalidar()
        case .directoriesGet: directorios.invalidar()
        case .settingsGet: ajustes.invalidar()
        case .playbackStatus: reproduccion.invalidar()
        case .engineStatus: motor.invalidar()
        case .footballSchedule: agenda.invalidar()
        case .scores: marcadores.invalidar()
        case .footballPreheat: for consulta in precalentados.values { consulta.invalidar() }
        case .footballScan: for consulta in trabajos.values { consulta.invalidar() }
        case .health: salud.invalidar()
        case .diagnosticsList: diagnosticos.invalidar()
        case .devicesList: dispositivos.invalidar()
        case .search: for consulta in busquedas.values { consulta.invalidar() }
        case .footballResolve: break  // la sesión de fuentes la llama con api(): no es una consulta (a7 §6.4)
        }
    }

    /// `resync` o versión nueva del servidor: todo `['v1']`.
    func invalidarTodo() {
        invalidar(Set(RutaConsulta.allCases))
    }

    /// Olvidar este iPhone o acceso perdido: nada del servidor se queda, ni en memoria ni en disco (a9 §3.5.2).
    func vaciar() {
        for consulta in fijas { consulta.vaciar() }
        for consulta in precalentados.values { consulta.vaciar() }
        for consulta in trabajos.values { consulta.vaciar() }
        for consulta in busquedas.values { consulta.vaciar() }
        precalentados = [:]
        trabajos = [:]
        busquedas = [:]
        let cache = self.cache
        Task { await cache.borrarTodo() }
    }

    /// La app vuelve a primer plano (`refetchOnWindowFocus`, a7 §4.1).
    func volverActiva() {
        let abierto = tiempoRealAbierto
        for consulta in fijas { consulta.volverActiva(tiempoRealAbierto: abierto) }
        for consulta in precalentados.values { consulta.volverActiva(tiempoRealAbierto: abierto) }
    }

    /// Vuelve la conexión (`refetchOnReconnect`): las que alguien mira y fallaron.
    func reintentarFallidas() {
        for consulta in fijas { consulta.reintentarSiFallo() }
        for consulta in precalentados.values { consulta.reintentarSiFallo() }
        for consulta in trabajos.values { consulta.reintentarSiFallo() }
    }

    // MARK: Consultas con parámetro

    func precalentado(partido id: String) -> Consulta<PreheatResponse> {
        if let hecha = precalentados[id] { return hecha }
        precalentados = recoger(precalentados)
        let api = self.api
        let nueva = Consulta<PreheatResponse> { try await api.enviar(API.precalentado(partido: id)) }
        preparar(nueva)
        precalentados[id] = nueva
        return nueva
    }

    func trabajo(_ id: String) -> Consulta<ScanJob> {
        if let hecha = trabajos[id] { return hecha }
        trabajos = recoger(trabajos)
        let api = self.api
        let nueva = Consulta<ScanJob> { try await api.enviar(API.comprobacion(id: id)) }
        preparar(nueva)
        trabajos[id] = nueva
        return nueva
    }

    func busqueda(_ q: String) -> Consulta<SearchResponse> {
        if let hecha = busquedas[q] { return hecha }
        busquedas = recoger(busquedas)
        let api = self.api
        let nueva = Consulta<SearchResponse>(.busqueda) { try await api.enviar(API.buscar(q)) }
        preparar(nueva)
        busquedas[q] = nueva
        return nueva
    }

    /// Reloj de la app y hora de creación (cuenta como inactiva hasta que alguien la mire).
    private func preparar<V: Sendable>(_ consulta: Consulta<V>) {
        consulta.reloj = reloj
        consulta.inactivaDesde = reloj.ahora
    }

    /// La tabla sin las consultas que nadie mira desde hace `recogerTras`.
    private func recoger<V: Sendable>(_ tabla: [String: Consulta<V>]) -> [String: Consulta<V>] {
        let ahora = reloj.ahora
        var quedan: [String: Consulta<V>] = [:]
        for (clave, consulta) in tabla where !consulta.recogible(ahora: ahora, tras: Self.recogerTras) {
            quedan[clave] = consulta
        }
        return quedan
    }

    // MARK: Mutaciones (a7 §4.3): escritura directa con la respuesta + lo que dependa. Sin reintentos.

    /// `setLibraryData` (library/data.ts): biblioteca y, con sus canales y listas, directorios.
    func mutarBiblioteca(_ cambio: LibraryMutation) async throws {
        let vista = try await api.enviar(API.cambiarBiblioteca(cambio))
        biblioteca.escribir(vista)
        directorios.escribir(Self.directorios(de: vista))
    }

    /// Gustos y el `bootstrap.preferences` de la caché.
    func guardarPreferencias(_ cuerpo: PreferencesInput) async throws {
        let respuesta = try await api.enviar(API.guardarPreferencias(cuerpo))
        preferencias.escribir(respuesta)
        arranque.modificar { $0.preferences = respuesta.preferences }
    }

    /// «Un solo dispositivo a la vez» (0.8.1: `any`).
    func guardarAjustes(_ cuerpo: SettingsUpdateBody) async throws {
        let respuesta = try await administrar(.settingsUpdate) { [api] in
            try await api.enviar(API.guardarAjustes(cuerpo))
        }
        ajustes.escribir(respuesta)
    }

    /// `applyDirectoryView`: directorios y, encima de la biblioteca, sus canales y listas.
    func sincronizarLista(_ cuerpo: DirectorySyncBody) async throws {
        aplicar(try await api.enviar(API.sincronizarDirectorio(cuerpo)))
    }

    func activarLista(id: String) async throws {
        aplicar(try await api.enviar(API.activarDirectorio(id: id)))
    }

    func borrarLista(id: String) async throws {
        aplicar(try await api.enviar(API.borrarDirectorio(id: id)))
    }

    /// Al pulsar, el motor pasa a «reiniciando»; a los 2,5 s, salga bien o mal, se vuelve a mirar el motor y,
    /// desde Salud, también la salud (a7 §4.3): Ajustes solo invalida `engineStatus` (SettingsView.tsx) y
    /// Salud, `engineStatus` y `health` (features/health/engine.ts).
    func reiniciarMotor(desdeSalud: Bool = false) async throws -> EngineRestartResponse {
        motor.modificar { estado in
            estado.status = .restarting
            estado.online = false
        }
        defer {
            let motor = self.motor
            let salud: Consulta<HealthResponse>? = desdeSalud ? self.salud : nil
            Task {
                try? await Task.sleep(for: Self.esperaTrasReiniciar)
                motor.invalidar()
                salud?.invalidar()
            }
        }
        return try await api.enviar(API.reiniciarMotor)
    }

    /// Revocar otro aparato (o el propio: eso lo hace `SesionApp.olvidarEsteIPhone`). La lista se vuelve a
    /// pedir salga bien o mal (el `finally` de DevicesSection.tsx): un 404 `device_not_found` porque otro
    /// ya lo revocó también quita la fila.
    func revocar(dispositivo id: String) async throws {
        defer { dispositivos.invalidar() }
        _ = try await administrar(.deviceRevoke) { [api] in
            try await api.enviar(API.revocarDispositivo(id: id))
        }
    }

    /// Código y QR para emparejar otro aparato (0.8.1). El cuerpo lo arma `SesionApp.cuerpoParaCodigo()`.
    func crearCodigo(_ cuerpo: PairingCreateBody) async throws -> PairingCreateResponse {
        try await administrar(.pairingCreate) { [api] in try await api.enviar(API.crearCodigo(cuerpo)) }
    }

    /// Una llamada a una ruta de administración: su resultado va a las capacidades.
    private func administrar<R: Sendable>(
        _ ruta: RutaAdministracion, _ llamada: @Sendable () async throws -> R
    ) async throws -> R {
        do {
            let respuesta = try await llamada()
            alAbrirAdministracion?(ruta)
            return respuesta
        } catch {
            alFallarAdministracion?(APIError.desde(error), ruta)
            throw error
        }
    }

    private func aplicar(_ vista: DirectoryView) {
        directorios.escribir(vista)
        biblioteca.modificar { biblioteca in
            biblioteca.web = vista.web
            biblioteca.webSyncedAt = vista.webSyncedAt
            biblioteca.webSources = vista.webSources
            biblioteca.activeWebSourceId = vista.activeWebSourceId
        }
    }

    static func directorios(de vista: LibraryView) -> DirectoryView {
        DirectoryView(
            web: vista.web, webSyncedAt: vista.webSyncedAt, webSources: vista.webSources,
            activeWebSourceId: vista.activeWebSourceId)
    }
}

/// Lo común de todas las consultas para recorrerlas sin saber su tipo.
@MainActor protocol ConsultaVaciable: AnyObject {
    var reloj: any Reloj { get set }
    func vaciar()
    func volverActiva(tiempoRealAbierto: Bool)
    func reintentarSiFallo()
}

extension Consulta: ConsultaVaciable {}
