import Foundation
import Testing

#if SWIFT_PACKAGE
    @testable import NucleoPuro
#else
    @testable import AceNeo
#endif

/* EfectosEvento (a7 §6.3-6.4): cada evento de packages/shared/fixtures/events con su efecto, SCOPE_ROUTES
   ámbito a ámbito y el filtro de los eventos dirigidos (`TARGETED` + `isForThisViewer`). */

private func evento(_ nombre: String) throws -> SSEEvent {
    try JSONDecoder().decode(SSEEvent.self, from: Fixtures.datos("events/\(nombre).json"))
}

/// Lo que se espera de cada fila de a7 §6.3, sin los datos (se comprueban aparte).
enum ClaseEfecto: Hashable {
    case invalidar(Set<RutaConsulta>), invalidarTodo, motor, sonando, sesiones, trabajo(String), senal, veredicto
    case dispositivos, reproductor, version
}

private func clase(_ efecto: EfectoEvento) -> ClaseEfecto {
    switch efecto {
    case .invalidar(let rutas): .invalidar(rutas)
    case .invalidarTodo: .invalidarTodo
    case .escribirMotor: .motor
    case .escribirSonando: .sonando
    case .escribirSesiones: .sesiones
    case .trabajo(let id): .trabajo(id)
    case .senalPartido: .senal
    case .veredicto: .veredicto
    case .dispositivos: .dispositivos
    case .alReproductor: .reproductor
    case .versionPosible: .version
    }
}

struct EfectosEventoTests {
    static let tabla: [(String, [ClaseEfecto])] = [
        ("playback.nowPlaying", [.sonando, .reproductor]),
        ("playback.handoff", [.reproductor]),
        ("playback.sessions", [.sesiones]),
        ("stream.ready", [.reproductor]),
        ("stream.reopened", [.reproductor]),
        ("stream.modeChanged", [.reproductor]),
        ("stream.closed", [.reproductor]),
        ("stream.stats", [.reproductor]),
        ("engine.status", [.motor, .reproductor]),
        ("scan.progress", [.trabajo("0123456789abcdef01234567"), .senal]),
        ("scan.verdict", [.trabajo("0123456789abcdef01234567"), .veredicto]),
        ("state.changed", [.invalidar([.libraryGet, .bootstrap, .playbackStatus])]),
        ("diagnostics.new", [.invalidar([.diagnosticsList, .health])]),
        ("devices.changed", [.invalidar([.devicesList]), .dispositivos]),
        ("resync", [.invalidarTodo, .version]),
    ]

    @Test(arguments: tabla.map(\.0))
    func cadaEventoConSuEfecto(_ nombre: String) throws {
        let esperado = try #require(Self.tabla.first { $0.0 == nombre }?.1)
        let efectos = EfectosEvento.de(try evento(nombre)).map(clase)
        #expect(efectos == esperado, "\(nombre)")
    }

    /// Los quince tipos de `SSE_EVENT_TYPES` tienen su fila.
    @Test func todosLosTiposTienenFila() {
        #expect(Set(Self.tabla.map(\.0)) == Set(SSEEvent.tiposConocidos))
    }

    @Test func losDatosPasanTalCual() throws {
        guard case .playbackNowPlaying(let datos) = try evento("playback.nowPlaying") else {
            Issue.record("playback.nowPlaying")
            return
        }
        #expect(EfectosEvento.de(.playbackNowPlaying(datos)).first
            == .escribirSonando(datos.nowPlaying, aprendidos: datos.learningCount))
        guard case .playbackSessions(let sesiones) = try evento("playback.sessions") else {
            Issue.record("playback.sessions")
            return
        }
        #expect(EfectosEvento.de(.playbackSessions(sesiones)) == [.escribirSesiones(sesiones.sessions)])
    }

    @Test func unVeredictoSinTrabajoSoloVaALaSesion() {
        let veredicto = ScanVerdictData(
            jobId: nil, hash: String(repeating: "a", count: 40), state: .failed, reason: "x", by: .player,
            checkedAt: "2026-09-24T17:00:00.000Z", playableOn: nil)
        #expect(EfectosEvento.de(.scanVerdict(veredicto)) == [.veredicto(veredicto)])
    }

    @Test func unEventoDesconocidoNoHaceNada() {
        #expect(EfectosEvento.de(.desconocido(type: "otro.tipo")).isEmpty)
    }

    @Test func unStateChangedSinAmbitosConocidosNoInvalidaNada() {
        let datos = StateChangedData(scopes: [.desconocido], at: "2026-09-24T17:00:00.000Z")
        #expect(EfectosEvento.de(.stateChanged(datos)).isEmpty)
    }
}

struct AmbitosTests {
    /// `SCOPE_ROUTES` de apps/web/src/api/sse.ts, ámbito a ámbito.
    static let tabla: [(StateScope, Set<RutaConsulta>)] = [
        (.library, [.libraryGet, .bootstrap]),
        (.preferences, [.preferencesGet, .bootstrap]),
        (.directories, [.directoriesGet, .libraryGet, .bootstrap]),
        (.bindings, [.footballResolve]),
        (.reports, [.footballResolve, .health]),
        (.learning, [.playbackStatus, .health]),
        (.stats, [.health]),
        (.nowPlaying, [.playbackStatus]),
        (.settings, [.settingsGet, .bootstrap]),
    ]

    @Test(arguments: tabla.map(\.0.rawValue))
    func rutasDeCadaAmbito(_ nombre: String) throws {
        let fila = try #require(Self.tabla.first { $0.0.rawValue == nombre })
        #expect(EfectosEvento.rutas(de: fila.0) == fila.1)
    }

    @Test func variosAmbitosSeJuntan() {
        let datos = StateChangedData(scopes: [.directories, .settings], at: "2026-09-24T17:00:00.000Z")
        #expect(EfectosEvento.de(.stateChanged(datos))
            == [.invalidar([.directoriesGet, .libraryGet, .bootstrap, .settingsGet])])
    }
}

struct EventosDirigidosTests {
    @Test func unEventoDeOtroVisorNoLlega() throws {
        let stats = try evento("stream.stats")  // viewerIds: ["viewer_tab01"]
        #expect(EfectosEvento.de(stats, visor: "v_otro").isEmpty)
        #expect(!EfectosEvento.de(stats, visor: "viewer_tab01").isEmpty)
        #expect(!EfectosEvento.esParaEsteVisor(try evento("playback.handoff"), visor: "v_otro"))
    }

    @Test func sinVisoresEsParaTodos() throws {
        guard case .streamClosed(var datos) = try evento("stream.closed") else {
            Issue.record("stream.closed")
            return
        }
        datos.viewerIds = []
        #expect(EfectosEvento.esParaEsteVisor(.streamClosed(datos), visor: "v_cualquiera"))
    }

    @Test func losNoDirigidosLleganSiempre() throws {
        for nombre in ["engine.status", "playback.nowPlaying", "state.changed", "resync", "devices.changed"] {
            #expect(EfectosEvento.esParaEsteVisor(try evento(nombre), visor: "v_otro"), "\(nombre)")
        }
    }
}
