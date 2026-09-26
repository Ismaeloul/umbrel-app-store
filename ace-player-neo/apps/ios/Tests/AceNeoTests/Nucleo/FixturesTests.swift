import XCTest

@testable import AceNeo

/// Los tipos Codable tienen que decodificar TODOS los ejemplos de
/// packages/shared/fixtures y, al volver a codificarlos, dar el mismo JSON
/// (sin contar los `null`). Así, si el backend añade o cambia un campo y los
/// modelos de Swift no, la CI de iOS falla.
final class FixturesTests: XCTestCase {
    /// Qué tipo decodifica cada ejemplo de v1/ (el nombre es el id de la ruta).
    private let tiposV1: [String: (Data) throws -> String?] = [
        "bootstrap": { try ComparadorJSON.idaYVuelta(BootstrapResponse.self, $0) },
        "channelStream": { try ComparadorJSON.idaYVuelta(StreamGrant.self, $0) },
        "deviceRevoke": { try ComparadorJSON.idaYVuelta(DeviceRevokeResponse.self, $0) },
        "devicesList": { try ComparadorJSON.idaYVuelta(DevicesListResponse.self, $0) },
        "diagnosticsList": { try ComparadorJSON.idaYVuelta(DiagnosticsListResponse.self, $0) },
        "diagnosticsReport": { try ComparadorJSON.idaYVuelta(DiagnosticReportResponse.self, $0) },
        "directoriesActivate": { try ComparadorJSON.idaYVuelta(DirectoryView.self, $0) },
        "directoriesDelete": { try ComparadorJSON.idaYVuelta(DirectoryView.self, $0) },
        "directoriesGet": { try ComparadorJSON.idaYVuelta(DirectoryView.self, $0) },
        "directoriesSync": { try ComparadorJSON.idaYVuelta(DirectoryView.self, $0) },
        "engineRestart": { try ComparadorJSON.idaYVuelta(EngineRestartResponse.self, $0) },
        "engineStatus": { try ComparadorJSON.idaYVuelta(EngineStatus.self, $0) },
        "footballBind": { try ComparadorJSON.idaYVuelta(BindResponse.self, $0) },
        "footballPreheat": { try ComparadorJSON.idaYVuelta(PreheatResponse.self, $0) },
        "footballResolve": { try ComparadorJSON.idaYVuelta(Resolution.self, $0) },
        "footballScan": { try ComparadorJSON.idaYVuelta(ScanJob.self, $0) },
        "footballSchedule": { try ComparadorJSON.idaYVuelta(FootballSchedule.self, $0) },
        "health": { try ComparadorJSON.idaYVuelta(HealthResponse.self, $0) },
        "healthLive": { try ComparadorJSON.idaYVuelta(HealthLiveResponse.self, $0) },
        "libraryGet": { try ComparadorJSON.idaYVuelta(LibraryView.self, $0) },
        "libraryMutate": { try ComparadorJSON.idaYVuelta(LibraryView.self, $0) },
        "pairingClaim": { try ComparadorJSON.idaYVuelta(PairingClaimResponse.self, $0) },
        "pairingCreate": { try ComparadorJSON.idaYVuelta(PairingCreateResponse.self, $0) },
        "ping": { try ComparadorJSON.idaYVuelta(PingResponse.self, $0) },
        "playbackStatus": { try ComparadorJSON.idaYVuelta(PlaybackStatus.self, $0) },
        "preferencesGet": { try ComparadorJSON.idaYVuelta(PreferencesResponse.self, $0) },
        "preferencesUpdate": { try ComparadorJSON.idaYVuelta(PreferencesResponse.self, $0) },
        "scores": { try ComparadorJSON.idaYVuelta(ScoresResponse.self, $0) },
        "search": { try ComparadorJSON.idaYVuelta(SearchResponse.self, $0) },
        "sessionHeartbeat": { try ComparadorJSON.idaYVuelta(HeartbeatResponse.self, $0) },
        "sessionRelease": { try ComparadorJSON.idaYVuelta(ReleaseResponse.self, $0) },
        "settingsGet": { try ComparadorJSON.idaYVuelta(SettingsResponse.self, $0) },
        "settingsUpdate": { try ComparadorJSON.idaYVuelta(SettingsResponse.self, $0) },
        "sourcesFeedback": { try ComparadorJSON.idaYVuelta(FeedbackResponse.self, $0) },
        "sourcesOutcome": { try ComparadorJSON.idaYVuelta(OutcomeResponse.self, $0) },
        "sourcesReport": { try ComparadorJSON.idaYVuelta(ReportResponse.self, $0) },
    ]

    func testHayEjemplosEnElBundle() throws {
        XCTAssertGreaterThanOrEqual(try Fixtures.nombres("v1").count, 36)
        XCTAssertEqual(try Fixtures.nombres("events").count, SSEEvent.tiposConocidos.count)
        XCTAssertEqual(try Fixtures.nombres("errors"), ["api-error"])
    }

    func testCadaRespuestaV1SeDecodificaYVuelveIgual() throws {
        for nombre in try Fixtures.nombres("v1") {
            guard let comprobar = tiposV1[nombre] else {
                XCTFail("El ejemplo v1/\(nombre).json no tiene tipo en Swift: añádelo a Core/Models y a esta tabla")
                continue
            }
            do {
                let diferencia = try comprobar(try Fixtures.datos("v1/\(nombre).json"))
                XCTAssertNil(diferencia, "v1/\(nombre).json cambia al pasar por Swift: \(diferencia ?? "")")
            } catch {
                XCTFail("v1/\(nombre).json no se decodifica: \(error)")
            }
        }
    }

    func testCadaEventoSeDecodificaConSuTipo() throws {
        for nombre in try Fixtures.nombres("events") {
            let datos = try Fixtures.datos("events/\(nombre).json")
            do {
                let evento = try JSONDecoder().decode(SSEEvent.self, from: datos)
                XCTAssertEqual(evento.type, nombre, "events/\(nombre).json")
                if case .desconocido = evento { XCTFail("events/\(nombre).json: tipo desconocido") }
                let diferencia = try ComparadorJSON.idaYVuelta(SSEEvent.self, datos)
                XCTAssertNil(diferencia, "events/\(nombre).json cambia al pasar por Swift: \(diferencia ?? "")")
            } catch {
                XCTFail("events/\(nombre).json no se decodifica: \(error)")
            }
        }
    }

    /// La misma decodificación que hace el cliente SSE con `event:` y `data:`.
    func testCadaEventoSeDecodificaComoTramaSSE() throws {
        for nombre in try Fixtures.nombres("events") {
            let objeto = try XCTUnwrap(
                try JSONSerialization.jsonObject(with: Fixtures.datos("events/\(nombre).json")) as? [String: Any])
            let data = try JSONSerialization.data(withJSONObject: try XCTUnwrap(objeto["data"]))
            let tipo = try XCTUnwrap(objeto["type"] as? String)
            var parser = SSEParser()
            let trama = "id: 42\nevent: \(tipo)\ndata: \(String(decoding: data, as: UTF8.self))\n\n"
            let mensajes = parser.feed(trama)
            XCTAssertEqual(mensajes.count, 1, nombre)
            let mensaje = try XCTUnwrap(mensajes.first)
            XCTAssertEqual(mensaje.id, "42")
            let evento = try SSEEvent.decode(type: mensaje.event, data: Data(mensaje.data.utf8))
            XCTAssertEqual(evento.type, tipo)
            if case .desconocido = evento { XCTFail("\(nombre): tipo desconocido") }
        }
    }

    func testTodosLosTiposDeEventoTienenEjemplo() throws {
        XCTAssertEqual(Set(try Fixtures.nombres("events")), Set(SSEEvent.tiposConocidos))
    }

    /// El ejemplo de `playback.sessions` y el estado de la reproducción traen
    /// lo que pinta «Dónde se está reproduciendo».
    func testEjemplosDeDondeSeEstaReproduciendo() throws {
        let evento = try JSONDecoder().decode(SSEEvent.self, from: Fixtures.datos("events/playback.sessions.json"))
        guard case .playbackSessions(let datos) = evento else { return XCTFail("No es playback.sessions") }
        let sesion = try XCTUnwrap(datos.sessions.first)
        XCTAssertEqual(sesion.title, "DAZN 1")
        XCTAssertEqual(sesion.viewers.map(\.deviceName), ["Chrome · Windows", "iPhone de Isma"])
        XCTAssertTrue(DondeSuena.esEste(try XCTUnwrap(sesion.viewers.last), dispositivo: "dev_iphone01", visorLocal: nil))
        let estado = try JSONDecoder().decode(PlaybackStatus.self, from: Fixtures.datos("v1/playbackStatus.json"))
        XCTAssertEqual(estado.sessions.first?.viewers.first?.platform, .web)
    }

    /// `playback.sessions` y el estado de la reproducción con los campos de
    /// «Dónde se está reproduciendo», y sin ellos (servidor anterior).
    func testSesionesConYSinLosCamposNuevos() throws {
        let nuevo = #"""
            {"sessions":[{"id":"s_1","hash":"a1b2c3d4e5f60718293a4b5c6d7e8f9012345678","mode":"hls","openedAt":"2026-09-23T18:30:00.000Z","title":"DAZN 1","protocol":"hls-fmp4","viewers":[{"client":"ios","deviceId":"dev_iphone01","lastBeatAt":"2026-09-23T18:30:00.000Z","viewerId":"ios_abc","deviceName":"iPhone de Isma","platform":"ios","playing":true},{"client":"web","deviceId":"web_salon01","lastBeatAt":"2026-09-23T18:30:00.000Z","viewerId":"web_1","deviceName":"Chrome · Windows","platform":"web","playing":null}]}]}
            """#
        let evento = try SSEEvent.decode(type: "playback.sessions", data: Data(nuevo.utf8))
        guard case .playbackSessions(let datos) = evento else { return XCTFail("No es playback.sessions: \(evento)") }
        let sesion = try XCTUnwrap(datos.sessions.first)
        XCTAssertEqual(sesion.title, "DAZN 1")
        XCTAssertEqual(sesion.protocol, .hlsFmp4)
        XCTAssertEqual(sesion.viewers.first?.deviceName, "iPhone de Isma")
        XCTAssertEqual(sesion.viewers.first?.platform, .ios)
        XCTAssertEqual(sesion.viewers.first?.playing, true)
        XCTAssertNil(sesion.viewers.last?.playing)

        let antiguo = #"""
            {"nowPlaying":null,"learningCount":0,"serverTime":1790188200000,"sessions":[{"id":"s_1","hash":"a1b2c3d4e5f60718293a4b5c6d7e8f9012345678","mode":"progressive","openedAt":"2026-09-23T18:30:00.000Z","viewers":[{"client":"web","deviceId":null,"lastBeatAt":"2026-09-23T18:30:00.000Z"}]}]}
            """#
        let estado = try JSONDecoder().decode(PlaybackStatus.self, from: Data(antiguo.utf8))
        XCTAssertNil(estado.sessions.first?.title)
        XCTAssertNil(estado.sessions.first?.viewers.first?.deviceName)
        // Un valor nuevo de plataforma o protocolo no rompe nada.
        let raro = nuevo.replacingOccurrences(of: #""platform":"web""#, with: #""platform":"tv""#)
            .replacingOccurrences(of: #""protocol":"hls-fmp4""#, with: #""protocol":"webrtc""#)
        guard case .playbackSessions(let otros) = try SSEEvent.decode(type: "playback.sessions", data: Data(raro.utf8)) else {
            return XCTFail("No decodifica con valores nuevos")
        }
        XCTAssertEqual(otros.sessions.first?.protocol, .desconocido)
        XCTAssertEqual(otros.sessions.first?.viewers.last?.platform, .desconocido)
    }

    func testErrorDelApiYSuMensajeEnEspanol() throws {
        let datos = try Fixtures.datos("errors/api-error.json")
        let sobre = try JSONDecoder().decode(ApiErrorEnvelope.self, from: datos)
        XCTAssertEqual(sobre.error.code, "engine_unavailable")
        XCTAssertEqual(sobre.error.requestId, "req-7f3a9c")
        XCTAssertNil(try ComparadorJSON.idaYVuelta(ApiErrorEnvelope.self, datos))
        // El código está en el catálogo generado y es público. Como la web (errors.ts), la app enseña
        // el `message` que manda el servidor; sin él, el del catálogo.
        let definicion = try XCTUnwrap(ErrorCatalog.describir(sobre.error.code))
        XCTAssertTrue(definicion.isPublic)
        XCTAssertFalse(sobre.error.message.isEmpty)
        let error = APIError.servidor(
            codigo: sobre.error.code, estado: definicion.status, mensaje: sobre.error.message,
            requestId: sobre.error.requestId)
        XCTAssertEqual(error.mensaje, sobre.error.message)
        let sinMensaje = APIError.servidor(
            codigo: sobre.error.code, estado: definicion.status, mensaje: nil, requestId: sobre.error.requestId)
        XCTAssertEqual(sinMensaje.mensaje, definicion.message)
    }

    func testDetallesQueLaAppUsa() throws {
        let arranque = try JSONDecoder().decode(BootstrapResponse.self, from: Fixtures.datos("v1/bootstrap.json"))
        XCTAssertEqual(arranque.origin, .native)
        XCTAssertEqual(arranque.device?.platform, .ios)
        XCTAssertEqual(arranque.engine.status, .online)
        XCTAssertEqual(arranque.library.favorites.first?.type, .fav)

        let stream = try JSONDecoder().decode(StreamGrant.self, from: Fixtures.datos("v1/channelStream.json"))
        XCTAssertEqual(stream.protocol, .hlsFmp4)
        XCTAssertEqual(stream.latency.mode, .balanced)
        XCTAssertEqual(stream.latency.ios, PlaybackMode.balanced.perfilIOS)
        XCTAssertTrue(stream.url.hasPrefix(Endpoint<SinContenido>.prefijo + "/video/"))

        let agenda = try JSONDecoder().decode(FootballSchedule.self, from: Fixtures.datos("v1/footballSchedule.json"))
        let partido = try XCTUnwrap(agenda.days.first?.matches.first)
        XCTAssertEqual(partido.inicio, Date(timeIntervalSince1970: 1_790_188_200))

        let creado = try JSONDecoder().decode(PairingCreateResponse.self, from: Fixtures.datos("v1/pairingCreate.json"))
        let enlace = try XCTUnwrap(PairingLink(texto: creado.pairUri))
        XCTAssertEqual(enlace.codigo, creado.code)
        XCTAssertEqual(enlace.servidor.absoluteString, "http://umbrel.local:7792")
    }

    func testUnValorDeEnumNuevoNoRompeLaDecodificacion() throws {
        let json = #"{"status":"hibernando","online":false,"since":null,"checkedAt":null,"engineVersion":null,"autoRestarts":{"lastHour":0,"max":3,"nextAllowedAt":null,"exhausted":false}}"#
        let estado = try JSONDecoder().decode(EngineStatus.self, from: Data(json.utf8))
        XCTAssertEqual(estado.status, .desconocido)
        let evento = try SSEEvent.decode(type: "algo.nuevo", data: Data("{}".utf8))
        XCTAssertEqual(evento, .desconocido(type: "algo.nuevo"))
    }

    func testFechasISOConYSinMilisegundos() {
        XCTAssertEqual(FechaISO.parse("2026-09-23T18:30:00.000Z"), Date(timeIntervalSince1970: 1_790_188_200))
        XCTAssertEqual(FechaISO.parse("2026-09-23T18:30:00Z"), Date(timeIntervalSince1970: 1_790_188_200))
        XCTAssertNil(FechaISO.parse("ayer"))
    }
}
