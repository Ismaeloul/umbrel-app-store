import Foundation

/// Las rutas de /api/v1 que la app usa desde /native (acceso `any` o `native` en
/// packages/shared/src/routes.ts). Desde la 0.8.1 también `health`, `settingsUpdate`,
/// `pairingCreate`, `devicesList` y `deviceRevoke` (a9 §2); un servidor 0.8.0 las
/// contesta con 403 `origin_forbidden` y la app lo apunta en `Capacidades`.
/// `healthLive` se queda `web` (b-arquitectura §0.0 punto 2): la app usa `ping`.
///
/// Los plazos son los de la web (`timeoutFor` de apps/web/src/api/client.ts, generados en
/// `PlazosWeb`), totales: los aplica `APIClient` (a8 §3.11.1).
public enum API {
    private static func plazo(_ ruta: RutaID) -> TimeInterval { PlazosWeb.plazo(ruta) }

    // MARK: Sistema

    /// Sin token: sirve para saber si una dirección es un Ace Player Neo. 4 s en la carrera de
    /// direcciones (diferencia consciente, a8 §3.11.1); 12 s al vigilar la versión (a7 §5.2).
    public static func ping(plazo: TimeInterval = 4) -> Endpoint<PingResponse> {
        Endpoint(.get, "ping", conToken: false, plazo: plazo)
    }

    public static var bootstrap: Endpoint<BootstrapResponse> {
        Endpoint(.get, "bootstrap", plazo: plazo(.bootstrap))
    }

    /// Ruta del SSE (la abre `SSEClient`). El plazo es de inactividad: el
    /// servidor manda un latido cada 15 s, así que 45 s sin nada es una conexión muerta.
    public static func eventos(plazoInactividad: TimeInterval = 45) -> Endpoint<SinContenido> {
        Endpoint(.get, "events", plazo: plazoInactividad)
    }

    /// `GET health` (0.8.1: `any`).
    static var salud: Endpoint<HealthResponse> { Endpoint(.get, "health", plazo: plazo(.health)) }

    // MARK: Motor

    public static var estadoMotor: Endpoint<EngineStatus> {
        Endpoint(.get, "engine/status", plazo: plazo(.engineStatus))
    }

    public static var reiniciarMotor: Endpoint<EngineRestartResponse> {
        Endpoint(.post, "engine/restart", plazo: plazo(.engineRestart))
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
            .get, "channels/\(Codificacion.segmento(id))/stream", query: query, plazo: plazo(.channelStream),
            idempotente: false)
    }

    public static func latido(sesion: String, cuerpo: HeartbeatBody) -> Endpoint<HeartbeatResponse> {
        Endpoint(
            .post, "sessions/\(Codificacion.segmento(sesion))/heartbeat", json: cuerpo,
            plazo: plazo(.sessionHeartbeat))
    }

    public static func soltar(sesion: String, cuerpo: ReleaseBody) -> Endpoint<ReleaseResponse> {
        Endpoint(
            .post, "sessions/\(Codificacion.segmento(sesion))/release", json: cuerpo, plazo: plazo(.sessionRelease))
    }

    public static var estadoReproduccion: Endpoint<PlaybackStatus> {
        Endpoint(.get, "playback", plazo: plazo(.playbackStatus))
    }

    // MARK: Ajustes, emparejamiento y dispositivos

    public static var ajustes: Endpoint<SettingsResponse> { Endpoint(.get, "settings", plazo: plazo(.settingsGet)) }

    /// `PUT settings` (0.8.1: `any`). No se repite contra la otra dirección (solo los GET).
    static func guardarAjustes(_ cuerpo: SettingsUpdateBody) -> Endpoint<SettingsResponse> {
        Endpoint(.put, "settings", json: cuerpo, plazo: plazo(.settingsUpdate))
    }

    /// Sin token. 5 intentos por código y 10 por minuto en total.
    public static func reclamarCodigo(_ cuerpo: PairingClaimBody) -> Endpoint<PairingClaimResponse> {
        Endpoint(.post, "pairing/claim", json: cuerpo, conToken: false, plazo: plazo(.pairingClaim))
    }

    /// `POST pairing` (0.8.1: `any`): código y QR para emparejar otro aparato (a9 §3.4).
    static func crearCodigo(_ cuerpo: PairingCreateBody) -> Endpoint<PairingCreateResponse> {
        Endpoint(.post, "pairing", json: cuerpo, plazo: plazo(.pairingCreate))
    }

    /// `GET devices` (0.8.1: `any`).
    static var dispositivos: Endpoint<DevicesListResponse> {
        Endpoint(.get, "devices", plazo: plazo(.devicesList))
    }

    /// `DELETE devices/:id` (0.8.1: `any`, también el propio: «Olvidar este iPhone»).
    static func revocarDispositivo(id: String) -> Endpoint<DeviceRevokeResponse> {
        Endpoint(.delete, "devices/\(Codificacion.segmento(id))", plazo: plazo(.deviceRevoke))
    }

    // MARK: Diagnóstico

    public static func diagnosticos(causa: DiagnosticCause? = nil, desde: String? = nil, limite: Int? = nil)
        -> Endpoint<DiagnosticsListResponse>
    {
        var query: [QueryParam] = []
        if let causa { query.append(QueryParam("cause", causa.rawValue)) }
        if let desde { query.append(QueryParam("since", desde)) }
        if let limite { query.append(QueryParam("limit", String(limite))) }
        return Endpoint(.get, "diagnostics", query: query, plazo: plazo(.diagnosticsList))
    }

    public static func informarFallo(_ cuerpo: DiagnosticReportBody) -> Endpoint<DiagnosticReportResponse> {
        Endpoint(.post, "diagnostics", json: cuerpo, plazo: plazo(.diagnosticsReport))
    }

    // MARK: Biblioteca, preferencias y directorios

    public static var biblioteca: Endpoint<LibraryView> { Endpoint(.get, "library", plazo: plazo(.libraryGet)) }

    public static func cambiarBiblioteca(_ cambio: LibraryMutation) -> Endpoint<LibraryView> {
        Endpoint(.post, "library", json: cambio, plazo: plazo(.libraryMutate))
    }

    public static var preferencias: Endpoint<PreferencesResponse> {
        Endpoint(.get, "preferences", plazo: plazo(.preferencesGet))
    }

    /// Las mutaciones no se reintentan (a7 §4.1), tampoco contra la otra dirección.
    public static func guardarPreferencias(_ cuerpo: PreferencesInput) -> Endpoint<PreferencesResponse> {
        Endpoint(.put, "preferences", json: cuerpo, plazo: plazo(.preferencesUpdate))
    }

    public static var directorios: Endpoint<DirectoryView> {
        Endpoint(.get, "directories", plazo: plazo(.directoriesGet))
    }

    public static func sincronizarDirectorio(_ cuerpo: DirectorySyncBody) -> Endpoint<DirectoryView> {
        Endpoint(.post, "directories/sync", json: cuerpo, plazo: plazo(.directoriesSync))
    }

    public static func activarDirectorio(id: String) -> Endpoint<DirectoryView> {
        Endpoint(.post, "directories/\(Codificacion.segmento(id))/activate", plazo: plazo(.directoriesActivate))
    }

    public static func borrarDirectorio(id: String) -> Endpoint<DirectoryView> {
        Endpoint(.delete, "directories/\(Codificacion.segmento(id))", plazo: plazo(.directoriesDelete))
    }

    // MARK: Fútbol

    /// La agenda (14 s, `TIMEOUTS.footballSchedule`).
    public static var agenda: Endpoint<FootballSchedule> {
        Endpoint(.get, "football", plazo: plazo(.footballSchedule))
    }

    /// 20 s al entrar (`RESOLVE_TIMEOUT_MS`) y 30 s al rebuscar (`RESEARCH_TIMEOUT_MS`), como la sesión de
    /// fuentes de la web (features/sources/session.ts).
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
        let segundos = rebuscar ? PlazosWeb.rebuscar : PlazosWeb.resolver
        return Endpoint(.get, "football/resolve", query: query, plazo: segundos, idempotente: false)
    }

    public static func comprobacion(id: String) -> Endpoint<ScanJob> {
        Endpoint(.get, "football/scans/\(Codificacion.segmento(id))", plazo: plazo(.footballScan))
    }

    public static func precalentado(partido: String) -> Endpoint<PreheatResponse> {
        Endpoint(.get, "football/preheat/\(Codificacion.segmento(partido))", plazo: plazo(.footballPreheat))
    }

    public static func vincular(_ cuerpo: BindBody) -> Endpoint<BindResponse> {
        Endpoint(.post, "football/bindings", json: cuerpo, plazo: plazo(.footballBind))
    }

    public static var marcadores: Endpoint<ScoresResponse> { Endpoint(.get, "scores", plazo: plazo(.scores)) }

    // MARK: Fuentes

    public static func reportarFuente(_ cuerpo: ReportBody) -> Endpoint<ReportResponse> {
        Endpoint(.post, "sources/report", json: cuerpo, plazo: plazo(.sourcesReport))
    }

    public static func resultadoFuente(_ cuerpo: OutcomeBody) -> Endpoint<OutcomeResponse> {
        Endpoint(.post, "sources/outcome", json: cuerpo, plazo: plazo(.sourcesOutcome))
    }

    public static func correccionFuente(_ cuerpo: FeedbackBody) -> Endpoint<FeedbackResponse> {
        Endpoint(.post, "sources/feedback", json: cuerpo, plazo: plazo(.sourcesFeedback))
    }

    // MARK: Búsqueda

    public static func buscar(_ texto: String) -> Endpoint<SearchResponse> {
        Endpoint(.get, "search", query: [QueryParam("q", texto)], plazo: plazo(.search))
    }
}
