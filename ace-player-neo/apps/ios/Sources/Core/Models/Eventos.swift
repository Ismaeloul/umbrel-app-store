import Foundation

/* Eventos del tiempo real por SSE (events.ts). En el cable llegan como
   `id: <n>`, `event: <type>` y `data: <JSON>`; los ejemplos de fixtures/
   vienen como `{ "type": …, "data": … }`. `SSEEvent` sabe leer las dos formas. */

/// Destino de los eventos dirigidos a visores concretos.
public protocol EventoDeVisores {
    var sessionId: String { get }
    var viewerIds: [String] { get }
}

public struct PlaybackNowPlayingData: Codable, Sendable, Hashable {
    public var nowPlaying: NowPlaying?
    public var learningCount: Int
}

public enum HandoffReason: String, EnumTolerante {
    case otherChannel = "other_channel"
    case sameChannel = "same_channel"
    case desconocido
}

/// Otro dispositivo se ha quedado el mando: el visor tiene que pararse.
public struct PlaybackHandoffData: Codable, Sendable, Hashable {
    public var sessionId: String?
    public var viewerIds: [String]
    public var byDeviceId: String?
    public var byClient: ClientKind
    public var hash: String
    public var title: String
    public var reason: HandoffReason
}

/// La sesión está lista para reproducir.
public struct StreamReadyData: Codable, Sendable, Hashable, EventoDeVisores {
    public var sessionId: String
    public var viewerIds: [String]
    public var url: String
    public var `protocol`: StreamProtocol
}

public enum StreamReopenedReason: String, EnumTolerante {
    case engineRestart = "engine_restart"
    case engineRecovered = "engine_recovered"
    case remuxRestart = "remux_restart"
    case desconocido
}

/// Tras un reinicio del motor: la URL nueva, para cambiar el `AVPlayerItem` sin intervención.
public struct StreamReopenedData: Codable, Sendable, Hashable, EventoDeVisores {
    public var sessionId: String
    public var viewerIds: [String]
    public var url: String
    public var `protocol`: StreamProtocol
    public var reason: StreamReopenedReason
}

public enum StreamModeChangedReason: String, EnumTolerante {
    case shared, alone
    case desconocido
}

/// La sesión cambia de protocolo (D5).
public struct StreamModeChangedData: Codable, Sendable, Hashable, EventoDeVisores {
    public var sessionId: String
    public var viewerIds: [String]
    public var from: StreamProtocol
    public var to: StreamProtocol
    public var url: String
    public var reason: StreamModeChangedReason
}

public enum StreamClosedReason: String, EnumTolerante {
    case released, expired, handoff
    case engineFailed = "engine_failed"
    case remuxFailed = "remux_failed"
    case revoked, shutdown
    case desconocido
}

public struct StreamClosedData: Codable, Sendable, Hashable, EventoDeVisores {
    public var sessionId: String
    public var viewerIds: [String]
    public var reason: StreamClosedReason
    /// Código del catálogo de errores si se cerró por un fallo.
    public var code: String?
}

/// Cada 2 s mientras haya visores (velocidades en KB/s).
public struct StreamStatsData: Codable, Sendable, Hashable, EventoDeVisores {
    public var sessionId: String
    public var viewerIds: [String]
    public var status: String
    public var peers: Int
    public var speedDown: Double
    public var speedUp: Double
    public var downloaded: Double?
    public var at: String
}

public struct ScanProgressData: Codable, Sendable, Hashable {
    public var jobId: String
    public var kind: ScanJobKind
    public var status: ScanJobStatus
    public var total: Int
    public var checked: Int
    public var playable: Int
    public var failed: Int
    public var waiting: Int
    public var retryAt: String?
    public var matchId: String?
}

public enum VerdictBy: String, EnumTolerante {
    case scanner, player
    case desconocido
}

public struct ScanVerdictData: Codable, Sendable, Hashable {
    public var jobId: String?
    public var hash: String
    public var state: VerdictState
    public var reason: String
    public var by: VerdictBy
    public var checkedAt: String
    public var playableOn: PlayableOn?
}

/// `STATE_SCOPES`: qué parte de lo guardado ha cambiado.
public enum StateScope: String, EnumTolerante {
    case library, preferences, directories, bindings, reports, learning, stats, nowPlaying, settings
    case desconocido
}

public struct StateChangedData: Codable, Sendable, Hashable {
    public var scopes: [StateScope]
    public var at: String
}

public enum DevicesChangedReason: String, EnumTolerante {
    case paired, revoked, renamed
    case desconocido
}

/// Solo va al origen web, pero se decodifica igual.
public struct DevicesChangedData: Codable, Sendable, Hashable {
    public var reason: DevicesChangedReason
    public var deviceId: String
}

public enum ResyncReason: String, EnumTolerante {
    case bufferMiss = "buffer_miss"
    case unknownEventId = "unknown_event_id"
    case serverRestart = "server_restart"
    case desconocido
}

/// Lo que falta ya no está en el búfer del servidor: hay que recargar todo.
public struct ResyncData: Codable, Sendable, Hashable {
    public var reason: ResyncReason
}

/// Evento tipado del tiempo real.
public enum SSEEvent: Sendable, Hashable {
    case playbackNowPlaying(PlaybackNowPlayingData)
    case playbackHandoff(PlaybackHandoffData)
    case streamReady(StreamReadyData)
    case streamReopened(StreamReopenedData)
    case streamModeChanged(StreamModeChangedData)
    case streamClosed(StreamClosedData)
    case streamStats(StreamStatsData)
    case engineStatus(EngineStatus)
    case scanProgress(ScanProgressData)
    case scanVerdict(ScanVerdictData)
    case stateChanged(StateChangedData)
    case diagnosticsNew(DiagnosticEntry)
    case devicesChanged(DevicesChangedData)
    case resync(ResyncData)
    /// Un tipo que esta versión de la app aún no conoce: se ignora sin romper la conexión.
    case desconocido(type: String)

    /// Todos los tipos que conoce la app (los de `SSE_EVENT_TYPES`).
    public static let tiposConocidos: [String] = [
        "playback.nowPlaying", "playback.handoff", "stream.ready", "stream.reopened",
        "stream.modeChanged", "stream.closed", "stream.stats", "engine.status", "scan.progress",
        "scan.verdict", "state.changed", "diagnostics.new", "devices.changed", "resync",
    ]

    /// Tipo en el cable.
    public var type: String {
        switch self {
        case .playbackNowPlaying: "playback.nowPlaying"
        case .playbackHandoff: "playback.handoff"
        case .streamReady: "stream.ready"
        case .streamReopened: "stream.reopened"
        case .streamModeChanged: "stream.modeChanged"
        case .streamClosed: "stream.closed"
        case .streamStats: "stream.stats"
        case .engineStatus: "engine.status"
        case .scanProgress: "scan.progress"
        case .scanVerdict: "scan.verdict"
        case .stateChanged: "state.changed"
        case .diagnosticsNew: "diagnostics.new"
        case .devicesChanged: "devices.changed"
        case .resync: "resync"
        case .desconocido(let type): type
        }
    }

    /// Decodifica el `data` de una trama SSE según su `event`.
    public static func decode(type: String, data: Data) throws -> SSEEvent {
        let d = JSONDecoder()
        switch type {
        case "playback.nowPlaying": return .playbackNowPlaying(try d.decode(PlaybackNowPlayingData.self, from: data))
        case "playback.handoff": return .playbackHandoff(try d.decode(PlaybackHandoffData.self, from: data))
        case "stream.ready": return .streamReady(try d.decode(StreamReadyData.self, from: data))
        case "stream.reopened": return .streamReopened(try d.decode(StreamReopenedData.self, from: data))
        case "stream.modeChanged": return .streamModeChanged(try d.decode(StreamModeChangedData.self, from: data))
        case "stream.closed": return .streamClosed(try d.decode(StreamClosedData.self, from: data))
        case "stream.stats": return .streamStats(try d.decode(StreamStatsData.self, from: data))
        case "engine.status": return .engineStatus(try d.decode(EngineStatus.self, from: data))
        case "scan.progress": return .scanProgress(try d.decode(ScanProgressData.self, from: data))
        case "scan.verdict": return .scanVerdict(try d.decode(ScanVerdictData.self, from: data))
        case "state.changed": return .stateChanged(try d.decode(StateChangedData.self, from: data))
        case "diagnostics.new": return .diagnosticsNew(try d.decode(DiagnosticEntry.self, from: data))
        case "devices.changed": return .devicesChanged(try d.decode(DevicesChangedData.self, from: data))
        case "resync": return .resync(try d.decode(ResyncData.self, from: data))
        default: return .desconocido(type: type)
        }
    }
}

extension SSEEvent: Codable {
    private enum Claves: String, CodingKey {
        case type, data
    }

    /// Forma `{ "type": …, "data": … }` de los ejemplos de fixtures/.
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: Claves.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "playback.nowPlaying": self = .playbackNowPlaying(try c.decode(PlaybackNowPlayingData.self, forKey: .data))
        case "playback.handoff": self = .playbackHandoff(try c.decode(PlaybackHandoffData.self, forKey: .data))
        case "stream.ready": self = .streamReady(try c.decode(StreamReadyData.self, forKey: .data))
        case "stream.reopened": self = .streamReopened(try c.decode(StreamReopenedData.self, forKey: .data))
        case "stream.modeChanged": self = .streamModeChanged(try c.decode(StreamModeChangedData.self, forKey: .data))
        case "stream.closed": self = .streamClosed(try c.decode(StreamClosedData.self, forKey: .data))
        case "stream.stats": self = .streamStats(try c.decode(StreamStatsData.self, forKey: .data))
        case "engine.status": self = .engineStatus(try c.decode(EngineStatus.self, forKey: .data))
        case "scan.progress": self = .scanProgress(try c.decode(ScanProgressData.self, forKey: .data))
        case "scan.verdict": self = .scanVerdict(try c.decode(ScanVerdictData.self, forKey: .data))
        case "state.changed": self = .stateChanged(try c.decode(StateChangedData.self, forKey: .data))
        case "diagnostics.new": self = .diagnosticsNew(try c.decode(DiagnosticEntry.self, forKey: .data))
        case "devices.changed": self = .devicesChanged(try c.decode(DevicesChangedData.self, forKey: .data))
        case "resync": self = .resync(try c.decode(ResyncData.self, forKey: .data))
        default: self = .desconocido(type: type)
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: Claves.self)
        try c.encode(type, forKey: .type)
        switch self {
        case .playbackNowPlaying(let v): try c.encode(v, forKey: .data)
        case .playbackHandoff(let v): try c.encode(v, forKey: .data)
        case .streamReady(let v): try c.encode(v, forKey: .data)
        case .streamReopened(let v): try c.encode(v, forKey: .data)
        case .streamModeChanged(let v): try c.encode(v, forKey: .data)
        case .streamClosed(let v): try c.encode(v, forKey: .data)
        case .streamStats(let v): try c.encode(v, forKey: .data)
        case .engineStatus(let v): try c.encode(v, forKey: .data)
        case .scanProgress(let v): try c.encode(v, forKey: .data)
        case .scanVerdict(let v): try c.encode(v, forKey: .data)
        case .stateChanged(let v): try c.encode(v, forKey: .data)
        case .diagnosticsNew(let v): try c.encode(v, forKey: .data)
        case .devicesChanged(let v): try c.encode(v, forKey: .data)
        case .resync(let v): try c.encode(v, forKey: .data)
        case .desconocido: break
        }
    }
}

/// Evento con el id creciente que lleva en el cable (para `Last-Event-ID`).
public struct SSEEnvelope: Sendable, Hashable {
    public var id: String?
    public var event: SSEEvent
}

/// `ApiErrorSchema`: `{ error: { code, message, requestId } }`.
public struct ApiErrorEnvelope: Codable, Sendable, Hashable {
    public struct Body: Codable, Sendable, Hashable {
        public var code: String
        public var message: String
        /// Opcional aquí para no perder el código si algo intermedio (nginx) responde sin él.
        public var requestId: String?
    }

    public var error: Body
}
