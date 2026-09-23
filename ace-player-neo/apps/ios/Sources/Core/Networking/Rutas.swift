import Foundation

/// Las rutas de /api/v1 que la app puede usar desde /native (acceso `any` o
/// `native` en packages/shared/src/routes.ts). Las de solo web (salud,
/// dispositivos, crear código, cambiar ajustes) no están: desde /native dan
/// 403 `origin_forbidden`.
///
/// Los plazos salen de `TIMEOUTS` del backend, con unos segundos de margen.
public enum API {
    // MARK: Sistema

    /// Sin token: sirve para saber si una dirección es un Ace Player Neo.
    public static func ping(plazo: TimeInterval = 4) -> Endpoint<PingResponse> {
        Endpoint(.get, "ping", conToken: false, plazo: plazo)
    }

    public static var bootstrap: Endpoint<BootstrapResponse> { Endpoint(.get, "bootstrap") }

    /// Ruta del SSE (la abre `SSEClient`). El plazo es de inactividad: el
    /// servidor manda un latido cada 15 s, así que 45 s sin nada es una conexión muerta.
    public static func eventos(plazoInactividad: TimeInterval = 45) -> Endpoint<SinContenido> {
        Endpoint(.get, "events", plazo: plazoInactividad)
    }

    // MARK: Motor

    public static var estadoMotor: Endpoint<EngineStatus> { Endpoint(.get, "engine/status") }

    public static var reiniciarMotor: Endpoint<EngineRestartResponse> {
        Endpoint(.post, "engine/restart", plazo: 30)
    }

    // MARK: Reproducción

    /// Abre (o se une a) la sesión del motor del canal y espera a que la URL
    /// sea reproducible (en iOS, el remux listo: hasta 55 s).
    public static func stream(
        id: String, visor: String, modo: PlaybackMode = .porDefecto, tipo: StreamKind = .auto,
        titulo: String? = nil
    ) -> Endpoint<StreamGrant> {
        var query = [
            QueryParam("client", "ios"), QueryParam("kind", tipo.rawValue),
            QueryParam("mode", modo.rawValue), QueryParam("viewer", visor),
        ]
        if let titulo, !titulo.isEmpty { query.append(QueryParam("title", String(titulo.prefix(200)))) }
        return Endpoint(
            .get, "channels/\(Codificacion.segmento(id))/stream", query: query, plazo: 60,
            idempotente: false)
    }

    public static func latido(sesion: String, cuerpo: HeartbeatBody) -> Endpoint<HeartbeatResponse> {
        Endpoint(.post, "sessions/\(Codificacion.segmento(sesion))/heartbeat", json: cuerpo, plazo: 10)
    }

    public static func soltar(sesion: String, cuerpo: ReleaseBody) -> Endpoint<ReleaseResponse> {
        Endpoint(.post, "sessions/\(Codificacion.segmento(sesion))/release", json: cuerpo, plazo: 10)
    }

    public static var estadoReproduccion: Endpoint<PlaybackStatus> { Endpoint(.get, "playback") }

    // MARK: Ajustes y emparejamiento

    public static var ajustes: Endpoint<SettingsResponse> { Endpoint(.get, "settings") }

    /// Sin token. 5 intentos por código y 10 por minuto en total.
    public static func reclamarCodigo(_ cuerpo: PairingClaimBody) -> Endpoint<PairingClaimResponse> {
        Endpoint(.post, "pairing/claim", json: cuerpo, conToken: false)
    }

    // MARK: Diagnóstico

    public static func diagnosticos(causa: DiagnosticCause? = nil, desde: String? = nil, limite: Int? = nil)
        -> Endpoint<DiagnosticsListResponse>
    {
        var query: [QueryParam] = []
        if let causa { query.append(QueryParam("cause", causa.rawValue)) }
        if let desde { query.append(QueryParam("since", desde)) }
        if let limite { query.append(QueryParam("limit", String(limite))) }
        return Endpoint(.get, "diagnostics", query: query)
    }

    public static func informarFallo(_ cuerpo: DiagnosticReportBody) -> Endpoint<DiagnosticReportResponse> {
        Endpoint(.post, "diagnostics", json: cuerpo)
    }

    // MARK: Biblioteca, preferencias y directorios

    public static var biblioteca: Endpoint<LibraryView> { Endpoint(.get, "library") }

    public static func cambiarBiblioteca(_ cambio: LibraryMutation) -> Endpoint<LibraryView> {
        Endpoint(.post, "library", json: cambio)
    }

    public static var preferencias: Endpoint<PreferencesResponse> { Endpoint(.get, "preferences") }

    public static func guardarPreferencias(_ cuerpo: PreferencesInput) -> Endpoint<PreferencesResponse> {
        Endpoint(.put, "preferences", json: cuerpo, idempotente: true)
    }

    public static var directorios: Endpoint<DirectoryView> { Endpoint(.get, "directories") }

    public static func sincronizarDirectorio(_ cuerpo: DirectorySyncBody) -> Endpoint<DirectoryView> {
        Endpoint(.post, "directories/sync", json: cuerpo, plazo: 50)
    }

    public static func activarDirectorio(id: String) -> Endpoint<DirectoryView> {
        Endpoint(.post, "directories/\(Codificacion.segmento(id))/activate")
    }

    public static func borrarDirectorio(id: String) -> Endpoint<DirectoryView> {
        Endpoint(.delete, "directories/\(Codificacion.segmento(id))")
    }

    // MARK: Fútbol

    /// La agenda (puede tardar hasta 60 s si el servidor la está rehaciendo).
    public static var agenda: Endpoint<FootballSchedule> { Endpoint(.get, "football", plazo: 65) }

    public static func resolver(
        partido: String? = nil, canales: [String] = [], rebuscar: Bool = false, actual: String? = nil,
        actualEsInfohash: Bool = false, cliente: String? = nil
    ) -> Endpoint<Resolution> {
        var query: [QueryParam] = []
        if let partido { query.append(QueryParam("match", partido)) }
        query += canales.map { QueryParam("channel", $0) }
        if rebuscar { query.append(QueryParam("research", "1")) }
        if let actual {
            query.append(QueryParam("current", actual))
            if actualEsInfohash { query.append(QueryParam("currentIh", "1")) }
        }
        if let cliente { query.append(QueryParam("client", cliente)) }
        return Endpoint(.get, "football/resolve", query: query, plazo: 30, idempotente: false)
    }

    public static func comprobacion(id: String) -> Endpoint<ScanJob> {
        Endpoint(.get, "football/scans/\(Codificacion.segmento(id))")
    }

    public static func precalentado(partido: String) -> Endpoint<PreheatResponse> {
        Endpoint(.get, "football/preheat/\(Codificacion.segmento(partido))")
    }

    public static func vincular(_ cuerpo: BindBody) -> Endpoint<BindResponse> {
        Endpoint(.post, "football/bindings", json: cuerpo)
    }

    public static var marcadores: Endpoint<ScoresResponse> { Endpoint(.get, "scores") }

    // MARK: Fuentes

    public static func reportarFuente(_ cuerpo: ReportBody) -> Endpoint<ReportResponse> {
        Endpoint(.post, "sources/report", json: cuerpo)
    }

    public static func resultadoFuente(_ cuerpo: OutcomeBody) -> Endpoint<OutcomeResponse> {
        Endpoint(.post, "sources/outcome", json: cuerpo)
    }

    public static func correccionFuente(_ cuerpo: FeedbackBody) -> Endpoint<FeedbackResponse> {
        Endpoint(.post, "sources/feedback", json: cuerpo)
    }

    // MARK: Búsqueda

    public static func buscar(_ texto: String) -> Endpoint<SearchResponse> {
        Endpoint(.get, "search", query: [QueryParam("q", texto)], plazo: 20)
    }
}
