// GENERADO por scripts/generar-rutas.mjs desde packages/shared/src/routes.ts. No editar.

import Foundation

/// Las 40 rutas de /api/v1 (V1_ROUTES), con los datos que la app necesita de cada una.
/// Todas existen también bajo /native (la entrada de la app).
enum RutaID: String, CaseIterable, Sendable {
    case ping
    case bootstrap
    case health
    case healthLive
    case events
    case engineStatus
    case engineRestart
    case channelStream
    case sessionHeartbeat
    case sessionRelease
    case playbackStatus
    case video
    case settingsGet
    case settingsUpdate
    case pairingCreate
    case pairingClaim
    case devicesList
    case deviceRevoke
    case diagnosticsList
    case diagnosticsReport
    case libraryGet
    case libraryMutate
    case preferencesGet
    case preferencesUpdate
    case directoriesGet
    case directoriesSync
    case directoriesActivate
    case directoriesDelete
    case footballSchedule
    case footballResolve
    case footballScan
    case footballPreheat
    case footballBind
    case scores
    case footballTeamCrest
    case footballCompetitionLogo
    case sourcesReport
    case sourcesOutcome
    case sourcesFeedback
    case search

    enum Metodo: String, Sendable { case get = "GET", post = "POST", put = "PUT", delete = "DELETE" }
    /// `access`: web (solo la web), nativa (solo la app) o cualquiera.
    enum Acceso: String, Sendable { case web, nativa = "native", cualquiera = "any" }
    /// `credential` desde /native.
    enum Credencial: String, Sendable { case ninguna = "none", bearer, videoToken = "video-token" }
    enum Contenido: String, Sendable { case json, sse, binario = "binary" }

    var metodo: Metodo {
        switch self {
        case .ping: .get
        case .bootstrap: .get
        case .health: .get
        case .healthLive: .get
        case .events: .get
        case .engineStatus: .get
        case .engineRestart: .post
        case .channelStream: .get
        case .sessionHeartbeat: .post
        case .sessionRelease: .post
        case .playbackStatus: .get
        case .video: .get
        case .settingsGet: .get
        case .settingsUpdate: .put
        case .pairingCreate: .post
        case .pairingClaim: .post
        case .devicesList: .get
        case .deviceRevoke: .delete
        case .diagnosticsList: .get
        case .diagnosticsReport: .post
        case .libraryGet: .get
        case .libraryMutate: .post
        case .preferencesGet: .get
        case .preferencesUpdate: .put
        case .directoriesGet: .get
        case .directoriesSync: .post
        case .directoriesActivate: .post
        case .directoriesDelete: .delete
        case .footballSchedule: .get
        case .footballResolve: .get
        case .footballScan: .get
        case .footballPreheat: .get
        case .footballBind: .post
        case .scores: .get
        case .footballTeamCrest: .get
        case .footballCompetitionLogo: .get
        case .sourcesReport: .post
        case .sourcesOutcome: .post
        case .sourcesFeedback: .post
        case .search: .get
        }
    }

    /// Ruta completa con `:param`, bajo /api/v1.
    var ruta: String {
        switch self {
        case .ping: "/api/v1/ping"
        case .bootstrap: "/api/v1/bootstrap"
        case .health: "/api/v1/health"
        case .healthLive: "/api/v1/health/live"
        case .events: "/api/v1/events"
        case .engineStatus: "/api/v1/engine/status"
        case .engineRestart: "/api/v1/engine/restart"
        case .channelStream: "/api/v1/channels/:id/stream"
        case .sessionHeartbeat: "/api/v1/sessions/:sid/heartbeat"
        case .sessionRelease: "/api/v1/sessions/:sid/release"
        case .playbackStatus: "/api/v1/playback"
        case .video: "/api/v1/video/:sid/:file"
        case .settingsGet: "/api/v1/settings"
        case .settingsUpdate: "/api/v1/settings"
        case .pairingCreate: "/api/v1/pairing"
        case .pairingClaim: "/api/v1/pairing/claim"
        case .devicesList: "/api/v1/devices"
        case .deviceRevoke: "/api/v1/devices/:id"
        case .diagnosticsList: "/api/v1/diagnostics"
        case .diagnosticsReport: "/api/v1/diagnostics"
        case .libraryGet: "/api/v1/library"
        case .libraryMutate: "/api/v1/library"
        case .preferencesGet: "/api/v1/preferences"
        case .preferencesUpdate: "/api/v1/preferences"
        case .directoriesGet: "/api/v1/directories"
        case .directoriesSync: "/api/v1/directories/sync"
        case .directoriesActivate: "/api/v1/directories/:id/activate"
        case .directoriesDelete: "/api/v1/directories/:id"
        case .footballSchedule: "/api/v1/football"
        case .footballResolve: "/api/v1/football/resolve"
        case .footballScan: "/api/v1/football/scans/:id"
        case .footballPreheat: "/api/v1/football/preheat/:matchId"
        case .footballBind: "/api/v1/football/bindings"
        case .scores: "/api/v1/scores"
        case .footballTeamCrest: "/api/v1/football/teams/:teamId/crest"
        case .footballCompetitionLogo: "/api/v1/football/competitions/:competitionId/logo"
        case .sourcesReport: "/api/v1/sources/report"
        case .sourcesOutcome: "/api/v1/sources/outcome"
        case .sourcesFeedback: "/api/v1/sources/feedback"
        case .search: "/api/v1/search"
        }
    }

    var acceso: Acceso {
        switch self {
        case .ping: .cualquiera
        case .bootstrap: .cualquiera
        case .health: .cualquiera
        case .healthLive: .web
        case .events: .cualquiera
        case .engineStatus: .cualquiera
        case .engineRestart: .cualquiera
        case .channelStream: .cualquiera
        case .sessionHeartbeat: .cualquiera
        case .sessionRelease: .cualquiera
        case .playbackStatus: .cualquiera
        case .video: .nativa
        case .settingsGet: .cualquiera
        case .settingsUpdate: .cualquiera
        case .pairingCreate: .cualquiera
        case .pairingClaim: .cualquiera
        case .devicesList: .cualquiera
        case .deviceRevoke: .cualquiera
        case .diagnosticsList: .cualquiera
        case .diagnosticsReport: .cualquiera
        case .libraryGet: .cualquiera
        case .libraryMutate: .cualquiera
        case .preferencesGet: .cualquiera
        case .preferencesUpdate: .cualquiera
        case .directoriesGet: .cualquiera
        case .directoriesSync: .cualquiera
        case .directoriesActivate: .cualquiera
        case .directoriesDelete: .cualquiera
        case .footballSchedule: .cualquiera
        case .footballResolve: .cualquiera
        case .footballScan: .cualquiera
        case .footballPreheat: .cualquiera
        case .footballBind: .cualquiera
        case .scores: .cualquiera
        case .footballTeamCrest: .cualquiera
        case .footballCompetitionLogo: .cualquiera
        case .sourcesReport: .cualquiera
        case .sourcesOutcome: .cualquiera
        case .sourcesFeedback: .cualquiera
        case .search: .cualquiera
        }
    }

    var credencial: Credencial {
        switch self {
        case .ping: .ninguna
        case .bootstrap: .bearer
        case .health: .bearer
        case .healthLive: .bearer
        case .events: .bearer
        case .engineStatus: .bearer
        case .engineRestart: .bearer
        case .channelStream: .bearer
        case .sessionHeartbeat: .bearer
        case .sessionRelease: .bearer
        case .playbackStatus: .bearer
        case .video: .videoToken
        case .settingsGet: .bearer
        case .settingsUpdate: .bearer
        case .pairingCreate: .bearer
        case .pairingClaim: .ninguna
        case .devicesList: .bearer
        case .deviceRevoke: .bearer
        case .diagnosticsList: .bearer
        case .diagnosticsReport: .bearer
        case .libraryGet: .bearer
        case .libraryMutate: .bearer
        case .preferencesGet: .bearer
        case .preferencesUpdate: .bearer
        case .directoriesGet: .bearer
        case .directoriesSync: .bearer
        case .directoriesActivate: .bearer
        case .directoriesDelete: .bearer
        case .footballSchedule: .bearer
        case .footballResolve: .bearer
        case .footballScan: .bearer
        case .footballPreheat: .bearer
        case .footballBind: .bearer
        case .scores: .bearer
        case .footballTeamCrest: .bearer
        case .footballCompetitionLogo: .bearer
        case .sourcesReport: .bearer
        case .sourcesOutcome: .bearer
        case .sourcesFeedback: .bearer
        case .search: .bearer
        }
    }

    var contenido: Contenido {
        switch self {
        case .ping: .json
        case .bootstrap: .json
        case .health: .json
        case .healthLive: .json
        case .events: .sse
        case .engineStatus: .json
        case .engineRestart: .json
        case .channelStream: .json
        case .sessionHeartbeat: .json
        case .sessionRelease: .json
        case .playbackStatus: .json
        case .video: .binario
        case .settingsGet: .json
        case .settingsUpdate: .json
        case .pairingCreate: .json
        case .pairingClaim: .json
        case .devicesList: .json
        case .deviceRevoke: .json
        case .diagnosticsList: .json
        case .diagnosticsReport: .json
        case .libraryGet: .json
        case .libraryMutate: .json
        case .preferencesGet: .json
        case .preferencesUpdate: .json
        case .directoriesGet: .json
        case .directoriesSync: .json
        case .directoriesActivate: .json
        case .directoriesDelete: .json
        case .footballSchedule: .json
        case .footballResolve: .json
        case .footballScan: .json
        case .footballPreheat: .json
        case .footballBind: .json
        case .scores: .json
        case .footballTeamCrest: .binario
        case .footballCompetitionLogo: .binario
        case .sourcesReport: .json
        case .sourcesOutcome: .json
        case .sourcesFeedback: .json
        case .search: .json
        }
    }
}
