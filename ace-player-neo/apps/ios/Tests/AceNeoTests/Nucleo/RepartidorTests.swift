import XCTest

@testable import AceNeo

/// RepartidorEventos (b-arquitectura §2.5.3; a7 §6.3-6.4): cada fila con su efecto en la caché y en los
/// dueños, los eventos dirigidos filtrados por `viewerIds`, el revocado desde otro, el sondeo de respaldo
/// y lo que se refresca al abrir tras un corte.
final class RepartidorTests: XCTestCase {
    override func setUp() {
        super.setUp()
        MockURLProtocol.limpiar()
    }

    override func tearDown() {
        MockURLProtocol.limpiar()
        super.tearDown()
    }

    @MainActor
    private func contenedor() throws -> ContenedorApp {
        let (contenedor, _, _) = PruebaDatos.contenedor()
        contenedor.datos.sembrar(con: try PruebaDatos.arranque())
        return contenedor
    }

    @MainActor
    func testEngineStatusEscribeElMotor() throws {
        let c = try contenedor()
        guard case .engineStatus(var estado) = try PruebaDatos.evento("engine.status") else { return XCTFail() }
        estado.status = .offline
        estado.online = false
        c.repartidor.aplicar(.engineStatus(estado))
        XCTAssertEqual(c.datos.motor.datos, estado)
    }

    @MainActor
    func testNowPlayingYSesionesEscribenLaReproduccion() throws {
        let c = try contenedor()
        let nowPlaying = try PruebaDatos.evento("playback.nowPlaying")
        let sesiones = try PruebaDatos.evento("playback.sessions")
        c.repartidor.aplicar(nowPlaying)
        c.repartidor.aplicar(sesiones)
        guard case .playbackNowPlaying(let np) = nowPlaying, case .playbackSessions(let s) = sesiones else {
            return XCTFail()
        }
        XCTAssertEqual(c.datos.reproduccion.datos?.nowPlaying, np.nowPlaying)
        XCTAssertEqual(c.datos.reproduccion.datos?.learningCount, np.learningCount)
        XCTAssertEqual(c.datos.reproduccion.datos?.sessions, s.sessions)
    }

    /// `old ? {...} : old`: sin datos de reproducción, un evento no inventa ninguno.
    @MainActor
    func testSinDatosNoSeInventaNada() throws {
        let (c, _, _) = PruebaDatos.contenedor()
        c.repartidor.aplicar(try PruebaDatos.evento("playback.sessions"))
        XCTAssertNil(c.datos.reproduccion.datos)
    }

    /// `state.changed` → `SCOPE_ROUTES`: lo que se mira vuelve a pedirse.
    @MainActor
    func testStateChangedInvalida() async throws {
        try PruebaDatos.servir(["GET /native/api/v1/library": try PruebaDatos.fixture("libraryGet")])
        let c = try contenedor()
        c.datos.biblioteca.empezarAMirar()
        c.repartidor.aplicar(try PruebaDatos.evento("state.changed"))  // library + nowPlaying
        let pidio = await llegaA { PruebaDatos.peticiones("GET", "library") == 1 }
        XCTAssertTrue(pidio)
        XCTAssertNil(c.datos.arranque.actualizadaEn, "bootstrap caducado (library → libraryGet + bootstrap)")
        XCTAssertNil(c.datos.reproduccion.actualizadaEn, "playbackStatus caducado (nowPlaying)")
    }

    @MainActor
    func testResyncInvalidaTodo() throws {
        let c = try contenedor()
        c.repartidor.aplicar(try PruebaDatos.evento("resync"))
        XCTAssertNil(c.datos.arranque.actualizadaEn)
        XCTAssertNil(c.datos.biblioteca.actualizadaEn)
        XCTAssertNil(c.datos.motor.actualizadaEn)
        XCTAssertNotNil(c.datos.biblioteca.datos, "Caduca pero no se borra")
    }

    /// `scan.progress` con `matchId` va al almacén de señal (20 min); `cancelled` lo borra.
    @MainActor
    func testScanProgressAnotaLaSenal() throws {
        let c = try contenedor()
        let evento = try PruebaDatos.evento("scan.progress")
        guard case .scanProgress(var progreso) = evento else { return XCTFail() }
        let trabajo = c.datos.trabajo(progreso.jobId)
        trabajo.escribir(try JSONDecoder().decode(ScanJob.self, from: Fixtures.datos("v1/footballScan.json")))
        c.repartidor.aplicar(evento)
        XCTAssertEqual(c.senales.senal(partido: "fltv-2026-09-23-3"), progreso)
        XCTAssertNil(trabajo.actualizadaEn, "invalida ese footballScan")
        progreso.status = .cancelled
        c.repartidor.aplicar(.scanProgress(progreso))
        XCTAssertNil(c.senales.senal(partido: "fltv-2026-09-23-3"))
    }

    /// Los dirigidos a otro visor no llegan a nadie; los de este visor, sí.
    @MainActor
    func testEventosDirigidosPorVisor() throws {
        let c = try contenedor()
        var oidos: [String] = []
        let id = c.repartidor.escuchar { oidos.append($0.type) }
        guard case .streamStats(var stats) = try PruebaDatos.evento("stream.stats") else { return XCTFail() }
        c.repartidor.aplicar(.streamStats(stats))  // viewerIds: ["viewer_tab01"]
        XCTAssertEqual(oidos, [])
        stats.viewerIds = [c.reproductor.visor]
        c.repartidor.aplicar(.streamStats(stats))
        XCTAssertEqual(oidos, ["stream.stats"])
        c.repartidor.dejarDeEscuchar(id)
        c.repartidor.aplicar(.streamStats(stats))
        XCTAssertEqual(oidos, ["stream.stats"])
    }

    /// `devices.changed revoked` con el id propio y sin haberlo pedido = revocado desde otro (a2 §23.4).
    @MainActor
    func testRevocadoDesdeOtro() async throws {
        let c = try contenedor()
        var motivos: [MotivoEmparejar] = []
        c.sesion.alPerderAcceso = { motivos.append($0) }
        c.repartidor.aplicar(.devicesChanged(DevicesChangedData(reason: .revoked, deviceId: "dev_otro")))
        c.repartidor.aplicar(.devicesChanged(DevicesChangedData(reason: .paired, deviceId: "dev_iphone01")))
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(c.sesion.fase, .app)
        c.repartidor.aplicar(.devicesChanged(DevicesChangedData(reason: .revoked, deviceId: "dev_iphone01")))
        let fuera = await llegaA { c.sesion.fase == .emparejar(.revocadoDesdeOtro) }
        XCTAssertTrue(fuera)
        XCTAssertEqual(motivos, [.revocadoDesdeOtro])
        XCTAssertNil(try c.entorno.tokens.leerToken())
    }

    /// Respaldo (10 s sin abrir): la reproducción cada 5 s si alguien la mira; al abrir tras el corte se
    /// refrescan reproducción y motor. `datos.tiempoRealAbierto` sigue al estado.
    @MainActor
    func testRespaldoYAbrirTrasCorte() async throws {
        try PruebaDatos.servir([
            "GET /native/api/v1/playback": try PruebaDatos.fixture("playbackStatus"),
            "GET /native/api/v1/engine/status": try PruebaDatos.fixture("engineStatus"),
        ])
        let c = try contenedor()
        c.repartidor.arrancar()
        c.cicloVida.cambiar(a: .activa)
        c.datos.reproduccion.empezarAMirar()
        c.datos.motor.empezarAMirar()
        c.tiempoReal.recibir(.conectado(ActiveServer(via: .lan, url: Prueba.base)))
        XCTAssertTrue(c.datos.tiempoRealAbierto)

        c.tiempoReal.recibir(.desconectado(nil, reintentoEn: 3))
        XCTAssertFalse(c.datos.tiempoRealAbierto)
        let sondea = await llegaA(2) { PruebaDatos.peticiones("GET", "playback") >= 1 }
        XCTAssertTrue(sondea, "En respaldo se pide la reproducción")
        XCTAssertEqual(c.tiempoReal.estado, .respaldo)

        MockURLProtocol.limpiar()
        try PruebaDatos.servir([
            "GET /native/api/v1/playback": try PruebaDatos.fixture("playbackStatus"),
            "GET /native/api/v1/engine/status": try PruebaDatos.fixture("engineStatus"),
        ])
        c.tiempoReal.recibir(.conectado(ActiveServer(via: .lan, url: Prueba.base)))
        XCTAssertTrue(c.datos.tiempoRealAbierto)
        let refresco = await llegaA {
            PruebaDatos.peticiones("GET", "playback") >= 1 && PruebaDatos.peticiones("GET", "engine/status") >= 1
        }
        XCTAssertTrue(refresco, "Al abrir tras el corte se refrescan reproducción y motor")
        c.repartidor.parar()
    }

    /// Cada `bootstrap` es una lectura de versión: si cambia, capacidades olvidadas y todo invalidado.
    @MainActor
    func testVersionNuevaOlvidaLasCapacidades() throws {
        let c = try contenedor()
        c.repartidor.vigiaVersion.activa = false  // sin toast ni ping en la prueba
        c.sesion.anotar(
            .servidor(codigo: "origin_forbidden", estado: 403, mensaje: nil, requestId: nil), en: .health)
        XCTAssertTrue(c.sesion.capacidades.servidorViejo)
        var arranque = try PruebaDatos.arranque()
        arranque.version = "0.8.1"
        c.datos.arranque.escribir(arranque)
        XCTAssertFalse(c.sesion.capacidades.servidorViejo)
        XCTAssertEqual(c.sesion.versionServidor, "0.8.1")
        XCTAssertNil(c.datos.biblioteca.actualizadaEn)
    }
}
