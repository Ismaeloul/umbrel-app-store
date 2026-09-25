import Foundation

/* Sistema, motor, ajustes, dispositivos y diagnóstico
   (api/v1/system.ts, engine.ts, settings.ts, auth.ts y diagnostics.ts). */

// MARK: - Ping y arranque

/// `PingResponseSchema`: vivo y versión, sin token.
public struct PingResponse: Codable, Sendable, Hashable {
    public var ok: Bool
    public var app: String
    public var version: String
    public var apiVersion: Int
    public var serverTime: Int64

    /// Lo que la app espera encontrar al otro lado.
    public static let appEsperada = "ace-player-neo"
    public static let apiVersionEsperada = 1
}

/// `BootstrapResponseSchema`: todo lo necesario para pintar la primera pantalla.
public struct BootstrapResponse: Codable, Sendable, Hashable {
    public struct Features: Codable, Sendable, Hashable {
        /// Hay segundo motor para comprobar fuentes.
        public var scanner: Bool
        /// Hay Ollama configurado.
        public var ai: Bool
        /// La agenda es la de muestra.
        public var demoSchedule: Bool
    }

    public var version: String
    public var serverTime: Int64
    public var origin: Origin
    public var device: Device?
    public var preferences: Preferences
    public var library: LibraryView
    public var playback: PlaybackStatus
    public var engine: EngineStatus
    public var settings: Settings
    public var features: Features
}

/// `HealthLiveResponseSchema` (solo web, pero se decodifica igual).
public struct HealthLiveResponse: Codable, Sendable, Hashable {
    public var ok: Bool
}

/// Estado de un componente del panel de salud.
public enum ComponentStatus: String, EnumTolerante {
    case ready, degraded, offline, disabled, warming
    case desconocido
}

/// `HealthResponseSchema`: panel de salud (solo web; la app lo decodifica para el futuro panel).
public struct HealthResponse: Codable, Sendable, Hashable {
    public struct Components: Codable, Sendable, Hashable {
        public struct Backend: Codable, Sendable, Hashable {
            public var status: String
        }

        public struct Scanner: Codable, Sendable, Hashable {
            public var status: ComponentStatus
            public var busy: Bool
            public var queue: Int
            public var activeJobs: Int
            public var cachedSources: Int
            public var leakedSessionsLastHour: Int
        }

        public struct AI: Codable, Sendable, Hashable {
            public var status: String
            public var model: String
        }

        public struct Agenda: Codable, Sendable, Hashable {
            public var status: String
            public var generatedAt: String?
            public var matches: Int
            public var preheated: Int
        }

        public struct Directories: Codable, Sendable, Hashable {
            public var status: String
            public var total: Int
            public var channels: Int
        }

        public struct State: Codable, Sendable, Hashable {
            public var status: String
            public var recoveredFrom: String?
        }

        public struct Playback: Codable, Sendable, Hashable {
            public var sessions: Int
            public var viewers: Int
            public var remuxSessions: Int
        }

        public struct Events: Codable, Sendable, Hashable {
            public var connections: Int
        }

        public var backend: Backend
        public var engine: EngineStatus
        public var scanner: Scanner
        public var ai: AI
        public var agenda: Agenda
        public var directories: Directories
        public var state: State
        public var playback: Playback
        public var events: Events
    }

    public struct Reports: Codable, Sendable, Hashable {
        public var total: Int
        public var quarantined: Int
        public var learningCount: Int
    }

    public struct Diagnostics: Codable, Sendable, Hashable {
        public var counts24h: DiagnosticCounts
    }

    public struct Warning: Codable, Sendable, Hashable {
        public var code: String
        public var message: String
    }

    public var version: String
    public var checkedAt: String
    public var uptimeSeconds: Int
    public var components: Components
    public var reports: Reports
    public var diagnostics: Diagnostics
    public var warnings: [Warning]
}

// MARK: - Motor

/// `EngineStateSchema`: estado con histéresis del vigilante del backend.
public enum EngineState: String, EnumTolerante {
    case online, offline, restarting, unknown
    case desconocido
}

/// `EngineStatusSchema`.
public struct EngineStatus: Codable, Sendable, Hashable {
    public struct AutoRestarts: Codable, Sendable, Hashable {
        public var lastHour: Int
        public var max: Int
        public var nextAllowedAt: String?
        public var exhausted: Bool
    }

    public var status: EngineState
    public var online: Bool
    public var since: String?
    public var checkedAt: String?
    public var engineVersion: String?
    public var autoRestarts: AutoRestarts
}

/// `EngineRestartResponseSchema`.
public struct EngineRestartResponse: Codable, Sendable, Hashable {
    public var restarted: Bool
}

// MARK: - Ajustes

/// `SameChannelPolicySchema`: qué pasa si dos dispositivos ven el mismo canal.
public enum SameChannelPolicy: String, EnumTolerante {
    case share, handoff
    case desconocido
}

/// `SettingsSchema`.
public struct Settings: Codable, Sendable, Hashable {
    public var sameChannelPolicy: SameChannelPolicy
}

/// De dónde sale el valor de los ajustes.
public enum SettingsSource: String, EnumTolerante {
    case saved, environment
    case desconocido
}

/// `SettingsResponseSchema`.
public struct SettingsResponse: Codable, Sendable, Hashable {
    public var settings: Settings
    public var source: SettingsSource
}

/// `SettingsUpdateBodySchema`: PUT settings (0.8.1: también desde la app emparejada). Firma de I0
/// (b-arquitectura §2.5.2) para que `DatosApp` compile; M1 lo completa si hace falta.
struct SettingsUpdateBody: Codable, Sendable, Hashable {
    var sameChannelPolicy: SameChannelPolicy?

    init(sameChannelPolicy: SameChannelPolicy? = nil) { self.sameChannelPolicy = sameChannelPolicy }
}

// MARK: - Dispositivos y emparejamiento

/// `DevicePlatformSchema`.
public enum DevicePlatform: String, EnumTolerante {
    case ios, ipados, macos, other
    case desconocido
}

/// `DeviceSchema`: vista pública de un dispositivo emparejado.
public struct Device: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var platform: DevicePlatform
    public var createdAt: String
    public var lastSeenAt: String?
    public var revokedAt: String?
}

/// `PairingCreateBodySchema`: POST pairing (0.8.1: también desde la app emparejada). `baseUrl` va la
/// primera en el QR; `alternateBaseUrls` (como mucho 2), detrás. Firma de I0 (b-arquitectura §2.5.2).
struct PairingCreateBody: Codable, Sendable, Hashable {
    var baseUrl: String?
    var alternateBaseUrls: [String]?

    init(baseUrl: String? = nil, alternateBaseUrls: [String]? = nil) {
        self.baseUrl = baseUrl
        self.alternateBaseUrls = alternateBaseUrls
    }
}

/// `PairingCreateResponseSchema` (lo crea la web; la app solo lo decodifica en los tests).
public struct PairingCreateResponse: Codable, Sendable, Hashable {
    public var code: String
    public var expiresAt: String
    public var ttlMs: Int
    public var pairUri: String
    public var qrSvg: String
}

/// `PairingClaimBodySchema`: POST /native/api/v1/pairing/claim.
public struct PairingClaimBody: Codable, Sendable, Hashable {
    public var code: String
    public var name: String
    public var platform: DevicePlatform

    public init(code: String, name: String, platform: DevicePlatform = .ios) {
        self.code = code
        self.name = name
        self.platform = platform
    }
}

/// `PairingClaimResponseSchema`: el token en claro SOLO sale aquí.
public struct PairingClaimResponse: Codable, Sendable, Hashable {
    public var deviceId: String
    /// `<deviceId>.<secreto de 256 bits en base64url>`.
    public var token: String
    public var device: Device
}

/// `DevicesListResponseSchema` (solo web).
public struct DevicesListResponse: Codable, Sendable, Hashable {
    public var devices: [Device]
}

/// `DeviceRevokeResponseSchema` (solo web).
public struct DeviceRevokeResponse: Codable, Sendable, Hashable {
    public var device: Device
}

// MARK: - Diagnóstico

/// `DiagnosticCauseSchema`: causa de un fallo.
public enum DiagnosticCause: String, EnumTolerante {
    case engine, source, network, codec, client, state
    case desconocido
}

/// `PlayerMetricsSchema`: métricas del reproductor.
public struct PlayerMetrics: Codable, Sendable, Hashable {
    public var timeToFirstFrameMs: Double?
    public var remuxStartMs: Double?
    public var rebuffers: Int?
    public var rebufferMs: Double?
    public var reconnects: Int?
    public var liveLatencyS: Double?

    public init(
        timeToFirstFrameMs: Double? = nil, remuxStartMs: Double? = nil, rebuffers: Int? = nil,
        rebufferMs: Double? = nil, reconnects: Int? = nil, liveLatencyS: Double? = nil
    ) {
        self.timeToFirstFrameMs = timeToFirstFrameMs
        self.remuxStartMs = remuxStartMs
        self.rebuffers = rebuffers
        self.rebufferMs = rebufferMs
        self.reconnects = reconnects
        self.liveLatencyS = liveLatencyS
    }
}

/// `DiagnosticEntrySchema`.
public struct DiagnosticEntry: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var at: String
    public var cause: DiagnosticCause
    public var code: String
    public var message: String
    public var hash: String?
    public var channel: String?
    public var deviceId: String?
    public var sessionId: String?
    public var requestId: String?
    public var metrics: PlayerMetrics?
}

/// `DiagnosticCountsSchema`: recuento por causa de las últimas 24 h.
public struct DiagnosticCounts: Codable, Sendable, Hashable {
    public var engine: Int
    public var source: Int
    public var network: Int
    public var codec: Int
    public var client: Int
    public var state: Int
}

/// `DiagnosticsListResponseSchema`.
public struct DiagnosticsListResponse: Codable, Sendable, Hashable {
    public var entries: [DiagnosticEntry]
    public var counts24h: DiagnosticCounts
    public var total: Int
}

/// `DiagnosticReportBodySchema`: lo que manda la app al registro de fallos.
public struct DiagnosticReportBody: Codable, Sendable, Hashable {
    public var cause: DiagnosticCause
    public var code: String
    public var message: String
    public var hash: String?
    public var channel: String?
    public var sessionId: String?
    public var metrics: PlayerMetrics?

    public init(
        cause: DiagnosticCause = .client, code: String, message: String = "", hash: String? = nil,
        channel: String? = nil, sessionId: String? = nil, metrics: PlayerMetrics? = nil
    ) {
        self.cause = cause
        self.code = code
        self.message = message
        self.hash = hash
        self.channel = channel
        self.sessionId = sessionId
        self.metrics = metrics
    }
}

/// `DiagnosticReportResponseSchema`.
public struct DiagnosticReportResponse: Codable, Sendable, Hashable {
    public var accepted: Bool
    public var id: String
}
