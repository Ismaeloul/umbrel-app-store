import Foundation

/* Agenda, marcadores, resolución de un partido, comprobador, precalentado,
   vínculos y fuentes (api/common.ts, api/v1/football.ts y sources.ts). */

// MARK: - Agenda

/// `FootballChannelRefSchema`.
public struct FootballChannelRef: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
}

/// `FootballMatchSchema`: un partido de la agenda.
public struct FootballMatch: Codable, Sendable, Hashable, Identifiable {
    /// Estable en la 0.7.0 (`fltv-<fecha>-<posición>`, `epg-…`…).
    public var id: String
    /// `YYYY-MM-DD`.
    public var date: String
    /// "HH:MM" en hora de Madrid, o "Por confirmar".
    public var time: String
    /// Inicio en milisegundos epoch, si la fuente lo sabe.
    public var start: Int64?
    public var title: String
    public var home: String
    /// "" si no se pudo separar.
    public var away: String
    public var competition: String
    public var country: String
    public var channels: [FootballChannelRef]
    /// Escudos y colores (solo en /api/v1 y solo si se conocen); `home`/`away` siguen siendo texto.
    public var homeTeam: TeamBadge?
    public var awayTeam: TeamBadge?
    /// Logo de la competición, si se conoce; `competition` sigue siendo texto.
    public var competitionBadge: CompetitionBadge?

    public init(
        id: String, date: String, time: String, start: Int64?, title: String, home: String, away: String,
        competition: String, country: String, channels: [FootballChannelRef], homeTeam: TeamBadge? = nil,
        awayTeam: TeamBadge? = nil, competitionBadge: CompetitionBadge? = nil
    ) {
        self.id = id
        self.date = date
        self.time = time
        self.start = start
        self.title = title
        self.home = home
        self.away = away
        self.competition = competition
        self.country = country
        self.channels = channels
        self.homeTeam = homeTeam
        self.awayTeam = awayTeam
        self.competitionBadge = competitionBadge
    }

    /// Hora de inicio como `Date`, si se conoce.
    public var inicio: Date? { start.map { Date(epochMs: $0) } }
}

/// `FootballDaySchema`.
public struct FootballDay: Codable, Sendable, Hashable, Identifiable {
    public var date: String
    public var matches: [FootballMatch]
    public var id: String { date }
}

/// `FootballSourceSchema`.
public enum FootballSource: String, EnumTolerante {
    case futbolenlatv, movistarplus, thesportsdb, demo
    case desconocido
}

/// Colores del club (`#rrggbb` en minúsculas) del `TeamBadgeSchema`.
public struct TeamColors: Codable, Sendable, Hashable {
    public var primary: String
    public var secondary: String?

    public init(primary: String, secondary: String? = nil) {
        self.primary = primary
        self.secondary = secondary
    }
}

/// `TeamBadgeSchema`: escudo y colores de un equipo (módulo `teams` del
/// backend, desde TheSportsDB). Solo llega cuando el índice conoce el equipo;
/// si falta, la app pinta un escudo generado y un color derivado del nombre.
public struct TeamBadge: Codable, Sendable, Hashable, Identifiable {
    /// `idTeam` de TheSportsDB, o `k-<clave>` si solo hay colores fijados a mano.
    public var id: String
    public var name: String
    /// Abreviatura de hasta 4 letras («RMA»), si la hay.
    public var short: String?
    /// Ruta relativa (`/api/v1/football/teams/<id>/crest?v=…`): la app le antepone su base y `/native`.
    public var crest: String?
    public var colors: TeamColors?

    public init(id: String, name: String, short: String? = nil, crest: String? = nil, colors: TeamColors? = nil) {
        self.id = id
        self.name = name
        self.short = short
        self.crest = crest
        self.colors = colors
    }
}

/// `CompetitionBadgeSchema`: logo de la competición, mismo circuito que los escudos.
public struct CompetitionBadge: Codable, Sendable, Hashable, Identifiable {
    /// `idLeague` de TheSportsDB.
    public var id: String
    public var name: String
    /// Ruta relativa (`/api/v1/football/competitions/<id>/logo?v=…`).
    public var logo: String?

    public init(id: String, name: String, logo: String? = nil) {
        self.id = id
        self.name = name
        self.logo = logo
    }
}

/// `FootballScheduleSchema`: la agenda completa.
public struct FootballSchedule: Codable, Sendable, Hashable {
    public var generatedAt: String
    public var timezone: String
    public var country: String
    public var source: FootballSource
    public var attribution: String
    public var demo: Bool
    public var limited: Bool
    public var partial: Bool
    public var days: [FootballDay]
    /// Solo si falló el refresco y se sirve la última agenda buena.
    public var stale: Bool?
}

/// `LiveScoreSchema`: marcador de un partido.
public struct LiveScore: Codable, Sendable, Hashable {
    public var home: Int
    public var away: Int
    /// "pre" | "in" | "post" | "".
    public var state: String
    public var clock: String
    public var detail: String
    public var confidence: Double
}

/// `ScoresResponseSchema`: marcadores en vivo (ESPN), por id de partido.
public struct ScoresResponse: Codable, Sendable, Hashable {
    public var available: Bool
    public var generatedAt: String?
    public var source: String
    public var attribution: String?
    public var leagues: Int
    public var scores: [String: LiveScore]
}

// MARK: - Fuentes: motivos y estados

/// `SourceReportReasonSchema`.
public enum SourceReportReason: String, EnumTolerante {
    case notStarting = "not_starting"
    case stuttering
    case wrongChannel = "wrong_channel"
    case badQuality = "bad_quality"
    case audio
    case desconocido
}

/// `SourceReportStateSchema`.
public enum SourceReportState: String, EnumTolerante {
    case reported, checking, working, weak, failed
    case desconocido
}

/// `PlayableOnSchema` (D6): dónde se puede reproducir una fuente.
public struct PlayableOn: Codable, Sendable, Hashable {
    public var web: Bool
    public var ios: Bool
}

// MARK: - Resolución

/// `CandidateSourceSchema`.
public enum CandidateSource: String, EnumTolerante {
    case saved, m3u, favorites, history, acestream
    case desconocido
}

/// Corrección aprendida de un candidato.
public enum LearnedVerdict: String, EnumTolerante {
    case correct, incorrect
    case desconocido
}

/// `ResolutionCandidateSchema`: una fuente candidata para un partido.
public struct ResolutionCandidate: Codable, Sendable, Hashable, Identifiable {
    public struct Reported: Codable, Sendable, Hashable {
        public var reason: SourceReportReason
        public var state: SourceReportState
        public var quarantineUntil: String?
    }

    public var id: String
    public var title: String
    public var alias: String?
    public var ih: Bool
    public var source: CandidateSource
    public var score: Double
    public var matchedChannel: String
    public var soloFamilia: Bool
    public var familyFallbackAllowed: Bool
    public var listaId: String?
    public var availability: Double?
    public var bitrate: Double?
    public var learned: LearnedVerdict?
    public var reported: Reported?
    public var rejectedByLearning: Bool
    public var quarantined: Bool
    public var semantic: Bool?
    public var semanticSimilarity: Double?
}

/// `AiInfoSchema`.
public struct AiInfo: Codable, Sendable, Hashable {
    public var enabled: Bool
    public var used: Bool
    public var model: String?
    public var catalogSize: Int
    public var error: String?
}

/// `ProgramMatchSchema` (objeto abierto: se ignoran los campos de más).
public struct ProgramMatch: Codable, Sendable, Hashable {
    public var id: String
    public var title: String
    public var home: String
    public var away: String
    public var competition: String
    public var date: String
    public var time: String
    public var start: Double?
    public var channels: [String]
}

/// `ScanRefSchema`: referencia a un trabajo del comprobador.
public struct ScanRef: Codable, Sendable, Hashable {
    public var id: String
    public var statusUrl: String
    public var total: Int
    public var initialCount: Int
}

/// `PreheatStageSchema`.
public enum PreheatStage: String, EnumTolerante {
    case discovery, scan, kickoff, live
    case desconocido
}

/// `PreheatStatusSchema`.
public enum PreheatStatus: String, EnumTolerante {
    case resolving, discovered
    case noSources = "no_sources"
    case scanning
    case scannerOffline = "scanner_offline"
    case ready, failed
    case desconocido
}

/// `PreheatPublicSchema`: precalentado de un partido.
public struct PreheatPublic: Codable, Sendable, Hashable {
    public var matchId: String
    public var stage: PreheatStage
    public var status: PreheatStatus
    public var updatedAt: String?
    public var candidateCount: Int
    public var checked: Int
    public var playable: Int
    public var total: Int
    public var error: String
}

/// `PreheatResponseSchema`.
public struct PreheatResponse: Codable, Sendable, Hashable {
    public var preheat: PreheatPublic?
}

/// `ResolutionStatusSchema`.
public enum ResolutionStatus: String, EnumTolerante {
    case found, choices
    case notFound = "not_found"
    case desconocido
}

/// `ResolutionSchema`: GET /api/v1/football/resolve.
public struct Resolution: Codable, Sendable, Hashable {
    public var status: ResolutionStatus
    public var channels: [String]
    public var checked: [String]
    public var candidate: ResolutionCandidate?
    public var candidates: [ResolutionCandidate]
    public var engineAvailable: Bool
    public var ai: AiInfo
    public var program: ProgramMatch?
    public var research: Bool
    public var preheated: Bool?
    public var preheat: PreheatPublic?
    public var scan: ScanRef?
}

// MARK: - Comprobador

/// `ScanJobKindSchema`.
public enum ScanJobKind: String, EnumTolerante {
    case interactive, research, preheat, report
    case desconocido
}

/// `ScanJobStatusSchema`.
public enum ScanJobStatus: String, EnumTolerante {
    case queued, running, waiting, complete, cancelled
    case desconocido
}

/// `ScanCandidateStateSchema`.
public enum ScanCandidateState: String, EnumTolerante {
    case queued, checking, working, weak, failed
    case desconocido
}

/// `VerdictStateSchema`: floja se puede reproducir con aviso, fallida sale del selector.
public enum VerdictState: String, EnumTolerante {
    case working, weak, failed
    case desconocido
}

/// `ScanCandidateSchema`.
public struct ScanCandidate: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var state: ScanCandidateState
    public var checkedAt: String?
    public var retryAt: String?
    public var durationMs: Double
    public var bytes: Double
    public var peers: Double
    public var speedDown: Double
    public var rateKbps: Double?
    public var intakeKbps: Double?
    public var streamKbps: Double
    public var reason: String
    public var mediaValid: Bool
    public var browserCompatible: Bool
    public var videoCodec: String
    public var audioCodecs: [String]
    public var cached: Bool
    public var attempts: Int
    /// D6: solo cuando ya hay veredicto.
    public var playableOn: PlayableOn?
}

/// `ScanJobSchema`: GET /api/v1/football/scans/:id.
public struct ScanJob: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var kind: ScanJobKind
    public var status: ScanJobStatus
    public var createdAt: String
    public var updatedAt: String
    public var total: Int
    public var checked: Int
    public var playable: Int
    public var failed: Int
    public var waiting: Int
    public var retryAt: String?
    public var initialCount: Int
    public var candidates: [ScanCandidate]
}

// MARK: - Vínculos

/// `ChannelBindingSchema`: vínculo partido-canal hecho a mano.
public struct ChannelBinding: Codable, Sendable, Hashable {
    public var channel: String
    public var channelKey: String
    public var id: String
    public var title: String
    public var ih: Bool
    public var updatedAt: String
}

/// `BindBodySchema`.
public struct BindBody: Codable, Sendable, Hashable {
    public var channel: String
    public var id: String
    public var title: String?
    public var ih: Bool?

    public init(channel: String, id: String, title: String? = nil, ih: Bool? = nil) {
        self.channel = channel
        self.id = id
        self.title = title
        self.ih = ih
    }
}

/// `BindResponseSchema`.
public struct BindResponse: Codable, Sendable, Hashable {
    public var binding: ChannelBinding
    public var channelBindings: [ChannelBinding]
}

// MARK: - Informes, resultados y correcciones de fuentes

/// `PublicSourceReportSchema`.
public struct PublicSourceReport: Codable, Sendable, Hashable {
    public var reportId: String
    public var id: String
    public var channel: String
    public var matchId: String
    public var reason: SourceReportReason
    public var state: SourceReportState
    public var checkReason: String
    public var reportedAt: String
    public var lastCheckedAt: String?
    public var quarantineUntil: String?
}

/// `ReportBodySchema`: reportar una fuente.
public struct ReportBody: Codable, Sendable, Hashable {
    public var id: String
    public var reason: SourceReportReason?
    public var channel: String?
    public var matchId: String?
    public var title: String?
    public var source: String?
    public var ih: Bool?

    public init(
        id: String, reason: SourceReportReason? = nil, channel: String? = nil, matchId: String? = nil,
        title: String? = nil, source: String? = nil, ih: Bool? = nil
    ) {
        self.id = id
        self.reason = reason
        self.channel = channel
        self.matchId = matchId
        self.title = title
        self.source = source
        self.ih = ih
    }
}

/// `ReportResponseSchema`.
public struct ReportResponse: Codable, Sendable, Hashable {
    public var report: PublicSourceReport
    public var scan: ScanRef?
}

/// `OutcomeResultSchema`: resultado real de reproducir una fuente.
public enum OutcomeResult: String, Codable, Sendable {
    case arranco, fallo, cayo, sigue
}

/// `OutcomeBodySchema`.
public struct OutcomeBody: Codable, Sendable, Hashable {
    public var id: String
    public var resultado: OutcomeResult
    public var segundos: Double?
    public var title: String?
    public var listaId: String?
    public var source: String?

    public init(
        id: String, resultado: OutcomeResult, segundos: Double? = nil, title: String? = nil,
        listaId: String? = nil, source: String? = nil
    ) {
        self.id = id
        self.resultado = resultado
        self.segundos = segundos
        self.title = title
        self.listaId = listaId
        self.source = source
    }
}

/// `SourceStatEntrySchema`: los números son decimales (se desgastan con el tiempo).
public struct SourceStatEntry: Codable, Sendable, Hashable {
    public var intentos: Double
    public var exitos: Double
    public var caidas: Double
    public var segundos: Double
    public var ultimo: Double
}

/// `OutcomeResponseSchema`.
public struct OutcomeResponse: Codable, Sendable, Hashable {
    public var hash: SourceStatEntry?
    public var proveedor: SourceStatEntry?
}

/// `FeedbackBodySchema`: «es el canal correcto» / «no es este canal».
public struct FeedbackBody: Codable, Sendable, Hashable {
    public var id: String
    public var verdict: LearnedVerdict
    public var channel: String?
    public var channelKey: String?
    public var title: String?
    public var reason: SourceReportReason?

    public init(
        id: String, verdict: LearnedVerdict, channel: String? = nil, channelKey: String? = nil,
        title: String? = nil, reason: SourceReportReason? = nil
    ) {
        self.id = id
        self.verdict = verdict
        self.channel = channel
        self.channelKey = channelKey
        self.title = title
        self.reason = reason
    }
}

/// `ChannelFeedbackSchema`.
public struct ChannelFeedback: Codable, Sendable, Hashable {
    public var id: String
    public var title: String
    public var channel: String
    public var channelKey: String
    public var verdict: LearnedVerdict
    public var reason: SourceReportReason
    public var corrections: Int
    public var updatedAt: String
}

/// `FeedbackResponseSchema`.
public struct FeedbackResponse: Codable, Sendable, Hashable {
    public var feedback: ChannelFeedback
    public var learningCount: Int
}
