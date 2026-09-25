import Foundation
import Observation

/* Los datos de la app (b-arquitectura §2.5.2, I0→M1): una `Consulta<T>` por ruta de lectura y las
   mutaciones con escritura directa (a7 §4.3). Vida de proceso (en `ContenedorApp`).
   ESQUELETO de I0 (fase 0.3b): cada consulta ya sabe pedir su ruta y las mutaciones que tienen ruta en
   `API` escriben la respuesta; lo demás (sembrar, pintar en frío, invalidar por ruta, las rutas 0.8.1
   de salud, dispositivos, ajustes y códigos) lo escribe M1. */

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
    private(set) var precalentados: [String: Consulta<PreheatResponse>] = [:]
    private(set) var trabajos: [String: Consulta<ScanJob>] = [:]
    private(set) var busquedas: [String: Consulta<SearchResponse>] = [:]
    var tiempoRealAbierto = false

    private let api: APIClient
    private let cache: DiskCache

    init(api: APIClient, cache: DiskCache) {
        self.api = api
        self.cache = cache
        arranque = Consulta(.alMontar) { try await api.enviar(API.bootstrap) }
        agenda = Consulta(.agenda) { try await api.enviar(API.agenda) }
        biblioteca = Consulta { try await api.enviar(API.biblioteca) }
        preferencias = Consulta { try await api.enviar(API.preferencias) }
        ajustes = Consulta { try await api.enviar(API.ajustes) }
        directorios = Consulta { try await api.enviar(API.directorios) }
        motor = Consulta { try await api.enviar(API.estadoMotor) }
        reproduccion = Consulta { try await api.enviar(API.estadoReproduccion) }
        marcadores = Consulta(.marcadores) { try await api.enviar(API.marcadores) }
        dispositivos = Consulta { throw DatosApp.pendiente }  // M1: ruta devicesList (0.8.1)
        salud = Consulta { throw DatosApp.pendiente }  // M1: ruta health (0.8.1)
        diagnosticos = Consulta { try await api.enviar(API.diagnosticos()) }
    }

    /// Lo que aún no tiene ruta en `API` (M1 añade las de la 0.8.1).
    nonisolated static let pendiente = APIError.formato("Pendiente (M1)")

    func sembrar(con arranque: BootstrapResponse) {}  // biblioteca, preferencias y ajustes salen del arranque
    func pintarEnFrio() async {}  // DiskCache: agenda, biblioteca, arranque, preferencias

    func invalidar(_ rutas: Set<RutaConsulta>) {}

    func invalidarTodo() {
        arranque.invalidar()
        agenda.invalidar()
        biblioteca.invalidar()
        preferencias.invalidar()
        ajustes.invalidar()
        directorios.invalidar()
        motor.invalidar()
        reproduccion.invalidar()
        marcadores.invalidar()
        dispositivos.invalidar()
        salud.invalidar()
        diagnosticos.invalidar()
    }

    func vaciar() {  // olvidar este iPhone
        precalentados = [:]
        trabajos = [:]
        busquedas = [:]
    }

    func precalentado(partido id: String) -> Consulta<PreheatResponse> {
        if let hecha = precalentados[id] { return hecha }
        let api = self.api
        let nueva = Consulta<PreheatResponse> { try await api.enviar(API.precalentado(partido: id)) }
        precalentados[id] = nueva
        return nueva
    }

    func trabajo(_ id: String) -> Consulta<ScanJob> {
        if let hecha = trabajos[id] { return hecha }
        let api = self.api
        let nueva = Consulta<ScanJob> { try await api.enviar(API.comprobacion(id: id)) }
        trabajos[id] = nueva
        return nueva
    }

    func busqueda(_ q: String) -> Consulta<SearchResponse> {
        if let hecha = busquedas[q] { return hecha }
        let api = self.api
        let nueva = Consulta<SearchResponse>(.busqueda) { try await api.enviar(API.buscar(q)) }
        busquedas[q] = nueva
        return nueva
    }

    // MARK: Mutaciones (a7 §4.3): escritura directa con la respuesta + invalidación de lo que dependa.

    func mutarBiblioteca(_ cambio: LibraryMutation) async throws {
        biblioteca.escribir(try await api.enviar(API.cambiarBiblioteca(cambio)))
    }

    func guardarPreferencias(_ cuerpo: PreferencesInput) async throws {
        preferencias.escribir(try await api.enviar(API.guardarPreferencias(cuerpo)))
    }

    func guardarAjustes(_ cuerpo: SettingsUpdateBody) async throws { throw Self.pendiente }  // M1: settingsUpdate

    func sincronizarLista(_ cuerpo: DirectorySyncBody) async throws {
        directorios.escribir(try await api.enviar(API.sincronizarDirectorio(cuerpo)))
    }

    func activarLista(id: String) async throws {
        directorios.escribir(try await api.enviar(API.activarDirectorio(id: id)))
    }

    func borrarLista(id: String) async throws {
        directorios.escribir(try await api.enviar(API.borrarDirectorio(id: id)))
    }

    func reiniciarMotor() async throws -> EngineRestartResponse { try await api.enviar(API.reiniciarMotor) }

    func revocar(dispositivo id: String) async throws { throw Self.pendiente }  // M1: deviceRevoke

    func crearCodigo(_ cuerpo: PairingCreateBody) async throws -> PairingCreateResponse {  // M1: pairingCreate
        throw Self.pendiente
    }
}
