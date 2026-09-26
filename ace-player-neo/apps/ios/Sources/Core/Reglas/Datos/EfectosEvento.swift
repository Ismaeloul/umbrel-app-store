import Foundation

/* Lo que provoca cada evento del tiempo real (b-arquitectura §2.1.4, contrato I0→M1; a7 §6.3-6.4).
   `RepartidorEventos` (Core/Datos) aplica los efectos; aquí solo se decide. Es el `applyToCache` +
   `dispatchSse` de apps/web/src/api/sse.ts, con `SCOPE_ROUTES` y el filtro de los eventos dirigidos
   (`TARGETED` + `isForThisViewer` de api/identity.ts). */

/// Lo que un evento SSE provoca (a7 §6.3-6.4).
enum EfectoEvento: Hashable, Sendable {
    case invalidar(Set<RutaConsulta>)
    case invalidarTodo  // resync
    case escribirMotor(EngineStatus)
    case escribirSonando(NowPlaying?, aprendidos: Int)
    case escribirSesiones([SessionSummary])
    case trabajo(jobId: String)  // invalida ese footballScan
    case senalPartido(ScanProgressData)  // almacén por matchId
    case veredicto(ScanVerdictData)  // sesión de fuentes
    case dispositivos(DevicesChangedData)  // emparejar / revocado desde otro
    case alReproductor(SSEEvent)  // dirigidos, filtrados por viewerIds
    case versionPosible  // tras resync: VigiaVersion hace ping
}

enum EfectosEvento {
    /// a7 §6.3, fila a fila (sin filtrar por visor: eso lo hace `de(_:visor:)`).
    static func de(_ evento: SSEEvent) -> [EfectoEvento] {
        switch evento {
        case .playbackNowPlaying(let datos):
            // El reproductor también lo escucha (si es sintético y `dev` no es el propio, late ya).
            return [.escribirSonando(datos.nowPlaying, aprendidos: datos.learningCount), .alReproductor(evento)]
        case .playbackSessions(let datos):
            return [.escribirSesiones(datos.sessions)]
        case .playbackHandoff, .streamReady, .streamReopened, .streamModeChanged, .streamClosed, .streamStats:
            return [.alReproductor(evento)]
        case .engineStatus(let estado):
            // Caché del motor y el reproductor (si esperaba al motor y vuelve `online`, reconecta).
            return [.escribirMotor(estado), .alReproductor(evento)]
        case .scanProgress(let datos):
            return [.trabajo(jobId: datos.jobId), .senalPartido(datos)]
        case .scanVerdict(let datos):
            guard let jobId = datos.jobId else { return [.veredicto(datos)] }
            return [.trabajo(jobId: jobId), .veredicto(datos)]
        case .stateChanged(let datos):
            let rutas = datos.scopes.reduce(into: Set<RutaConsulta>()) { $0.formUnion(Self.rutas(de: $1)) }
            return rutas.isEmpty ? [] : [.invalidar(rutas)]
        case .diagnosticsNew:
            return [.invalidar([.diagnosticsList, .health])]
        case .devicesChanged(let datos):
            return [.invalidar([.devicesList]), .dispositivos(datos)]
        case .resync:
            // Lo que faltaba ya no está en el búfer del servidor: se pide todo otra vez (y la versión, a7 §5.2).
            return [.invalidarTodo, .versionPosible]
        case .desconocido:
            return []
        }
    }

    /// Igual que `de(_:)`, pero un evento dirigido a otros visores no provoca nada (a7 §6.3).
    static func de(_ evento: SSEEvent, visor: String) -> [EfectoEvento] {
        esParaEsteVisor(evento, visor: visor) ? de(evento) : []
    }

    /// `TARGETED` + `isForThisViewer`: sin `viewerIds` o con la lista vacía, es para todos.
    static func esParaEsteVisor(_ evento: SSEEvent, visor: String) -> Bool {
        guard let visores = visoresDestino(evento), !visores.isEmpty else { return true }
        return visores.contains(visor)
    }

    /// Los visores de un evento dirigido (`playback.handoff` y `stream.*`); nil si no es dirigido.
    static func visoresDestino(_ evento: SSEEvent) -> [String]? {
        switch evento {
        case .playbackHandoff(let d): d.viewerIds
        case .streamReady(let d): d.viewerIds
        case .streamReopened(let d): d.viewerIds
        case .streamModeChanged(let d): d.viewerIds
        case .streamClosed(let d): d.viewerIds
        case .streamStats(let d): d.viewerIds
        default: nil
        }
    }

    /// Al abrir tras un corte (venía de respaldo o de reintentos) se pudo perder algo: lo que cambia solo
    /// (`es.onopen` de api/sse.ts con `wasDegraded`). Contrato aditivo de M1 (ronda 2).
    static let trasCorte: Set<RutaConsulta> = [.playbackStatus, .engineStatus]

    /// `SCOPE_ROUTES` (a7 §6.4).
    static func rutas(de ambito: StateScope) -> Set<RutaConsulta> {
        switch ambito {
        case .library: [.libraryGet, .bootstrap]
        case .preferences: [.preferencesGet, .bootstrap]
        case .directories: [.directoriesGet, .libraryGet, .bootstrap]
        case .bindings: [.footballResolve]
        case .reports: [.footballResolve, .health]
        case .learning: [.playbackStatus, .health]
        case .stats: [.health]
        case .nowPlaying: [.playbackStatus]
        case .settings: [.settingsGet, .bootstrap]
        case .desconocido: []
        }
    }
}
