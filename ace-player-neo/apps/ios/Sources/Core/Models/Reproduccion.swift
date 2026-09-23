import Foundation

/* Reproducción en /api/v1 (api/v1/playback.ts y constants/playback.ts): el
   backend es el dueño de las sesiones del motor (D5). La app pide la URL,
   manda un latido cada 15 s y la suelta al terminar. */

/// `PLAYBACK_MODES`: Estable / Equilibrado / Baja latencia.
public enum PlaybackMode: String, Codable, Sendable, Hashable, CaseIterable {
    case stable, balanced, low

    /// Por defecto, Equilibrado.
    public static let porDefecto: PlaybackMode = .balanced

    /// Texto que ve el usuario en Ajustes (el mismo que la web).
    public var etiqueta: String {
        switch self {
        case .stable: "Estable"
        case .balanced: "Equilibrado"
        case .low: "Baja latencia"
        }
    }

    /// `IOS_PLAYBACK_PROFILES`: traducción del modo a AVPlayer. Cambiar de
    /// modo solo toca estos dos valores; no reconecta.
    public var perfilIOS: IosPlaybackProfile {
        switch self {
        case .stable: IosPlaybackProfile(preferredForwardBufferDuration: 12, liveEdgeOffsetS: 12)
        case .balanced: IosPlaybackProfile(preferredForwardBufferDuration: 8, liveEdgeOffsetS: 8)
        case .low: IosPlaybackProfile(preferredForwardBufferDuration: 4, liveEdgeOffsetS: 4)
        }
    }
}

/// Perfil de AVPlayer de un modo: colchón por delante y distancia al directo.
public struct IosPlaybackProfile: Codable, Sendable, Hashable {
    /// `preferredForwardBufferDuration` del `AVPlayerItem`, en segundos.
    public var preferredForwardBufferDuration: Double
    /// Distancia al borde del directo (`configuredTimeOffsetFromLive`), en segundos.
    public var liveEdgeOffsetS: Double
}

/// `RECONNECT_POLICY`: 3 reconexiones con espera exponencial 1 s, 2 s, 4 s… (tope 8 s).
public enum PoliticaReconexion {
    public static let maxIntentos = 3
    public static let maxIntentosArranqueAutomatico = 1

    /// Espera antes de la reconexión número `intento` (1, 2, 3…), en segundos.
    public static func espera(intento: Int) -> TimeInterval {
        let n = max(1, intento)
        let ms = min(8000.0, 1000.0 * pow(2.0, Double(n - 1)))
        return ms / 1000
    }
}

/// `StreamProtocolSchema`.
public enum StreamProtocol: String, EnumTolerante {
    /// Progresivo del motor (web con mpegts.js).
    case mpegts
    /// HLS del motor (web con hls.js).
    case hls
    /// Remux del backend para AVPlayer.
    case hlsFmp4 = "hls-fmp4"
    case desconocido
}

/// `EngineSessionModeSchema`.
public enum EngineSessionMode: String, EnumTolerante {
    case progressive, hls
    case desconocido
}

/// `StreamSessionInfoSchema`.
public struct StreamSessionInfo: Codable, Sendable, Hashable {
    public var id: String
    /// Cada cuánto hay que mandar el latido (15 s).
    public var heartbeatMs: Int
    /// Sin latido en este tiempo, el visor se da por ido (45 s).
    public var expiresAfterMs: Int
}

/// De dónde sale el códec de `StreamCodecSchema`.
public enum CodecSource: String, EnumTolerante {
    case scanner, player, ffprobe, unknown
    case desconocido
}

/// `StreamCodecSchema`.
public struct StreamCodec: Codable, Sendable, Hashable {
    public var video: String
    public var audio: String
    public var source: CodecSource
}

/// `StreamLatencySchema`.
public struct StreamLatency: Codable, Sendable, Hashable {
    public struct LiveSync: Codable, Sendable, Hashable {
        public var targetS: Double
        public var maxS: Double
        public var rate: Double
    }

    public var mode: PlaybackMode
    public var initialBufferS: Double
    public var rebuildS: Double
    public var liveSync: LiveSync?
    /// Solo con `hls-fmp4`.
    public var ios: IosPlaybackProfile?
}

/// `StreamGrantSchema`: respuesta de GET /api/v1/channels/:id/stream.
public struct StreamGrant: Codable, Sendable, Hashable {
    public struct Stats: Codable, Sendable, Hashable {
        public var via: String
    }

    public var session: StreamSessionInfo
    /// Relativa; en iOS, `/native/api/v1/video/<sid>/index.m3u8?t=…`.
    public var url: String
    public var `protocol`: StreamProtocol
    public var remux: Bool
    public var codec: StreamCodec
    public var latency: StreamLatency
    public var stats: Stats
    public var handoff: Bool
}

/// `kind` de la petición de stream.
public enum StreamKind: String, Codable, Sendable {
    case id, infohash, auto
}

/// `HeartbeatBodySchema`.
public struct HeartbeatBody: Codable, Sendable, Hashable {
    public var viewer: String
    public var playing: Bool?

    public init(viewer: String, playing: Bool? = nil) {
        self.viewer = viewer
        self.playing = playing
    }
}

/// `HeartbeatResponseSchema`: lleva la URL y el protocolo actuales.
public struct HeartbeatResponse: Codable, Sendable, Hashable {
    public var session: StreamSessionInfo
    public var url: String
    public var `protocol`: StreamProtocol
    public var viewers: Int
}

/// `ReleaseReasonSchema`.
public enum ReleaseReason: String, Codable, Sendable {
    case user
    case channelChange = "channel_change"
    case pagehide, error, handoff
}

/// `ReleaseBodySchema`.
public struct ReleaseBody: Codable, Sendable, Hashable {
    public var viewer: String
    public var reason: ReleaseReason

    public init(viewer: String, reason: ReleaseReason = .user) {
        self.viewer = viewer
        self.reason = reason
    }
}

/// `ReleaseResponseSchema`.
public struct ReleaseResponse: Codable, Sendable, Hashable {
    public var released: Bool
    public var sessionClosed: Bool
}

/// `NowPlayingSchema`: el mando de siempre.
public struct NowPlaying: Codable, Sendable, Hashable {
    public var id: String
    public var title: String
    public var dev: String
    public var token: String
    /// Milisegundos epoch.
    public var at: Double
}

/// `SessionSummarySchema`: sesión abierta en el motor.
public struct SessionSummary: Codable, Sendable, Hashable, Identifiable {
    public struct Viewer: Codable, Sendable, Hashable {
        public var client: ClientKind
        public var deviceId: String?
        public var lastBeatAt: String
    }

    public var id: String
    public var hash: String
    public var mode: EngineSessionMode
    public var openedAt: String
    public var viewers: [Viewer]
}

/// `PlaybackStatusSchema`: GET /api/v1/playback.
public struct PlaybackStatus: Codable, Sendable, Hashable {
    public var nowPlaying: NowPlaying?
    public var learningCount: Int
    public var serverTime: Int64
    public var sessions: [SessionSummary]
}
