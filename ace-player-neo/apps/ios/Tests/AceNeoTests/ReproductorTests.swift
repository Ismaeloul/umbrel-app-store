import AVFoundation
import XCTest
import os

@testable import AceNeo

// MARK: - Dobles de prueba

/// AVPlayer simulado: se maneja a mano desde el test.
@MainActor
final class MotorFalso: MotorVideo {
    var alEvento: ((EventoMotor) -> Void)?
    var estadoTiempo: EstadoTiempo = .pausado
    var probableSinCortes = true
    var tiempoActual: Double = 0
    var ventana: VentanaDirecto?
    var colchonPorDelante: Double = 0
    var avPlayer: AVPlayer? { nil }

    private(set) var cargadas: [URL] = []
    private(set) var perfiles: [IosPlaybackProfile] = []
    private(set) var reproducciones = 0
    private(set) var pausas = 0
    private(set) var saltos: [Double] = []
    private(set) var vaciados = 0

    func cargar(url: URL, perfil: IosPlaybackProfile) {
        cargadas.append(url)
        perfiles.append(perfil)
    }

    func aplicar(perfil: IosPlaybackProfile) { perfiles.append(perfil) }
    func reproducir() { reproducciones += 1 }
    func pausar() { pausas += 1 }

    func saltar(a segundos: Double) async -> Bool {
        saltos.append(segundos)
        tiempoActual = segundos
        return true
    }

    func vaciar() { vaciados += 1 }

    /// Emite un evento como lo haría AVPlayer (y actualiza su estado).
    func emitir(_ evento: EventoMotor) {
        if case .estado(let estado) = evento { estadoTiempo = estado }
        alEvento?(evento)
    }
}

/// Backend simulado para el reproductor: apunta lo que se le pide.
final class ServicioFalso: ServicioReproduccion {
    struct Estado: Sendable {
        var streams: [String] = []
        var latidos = 0
        var soltadas: [ReleaseReason] = []
        var resultados: [OutcomeResult] = []
        var informes: [String] = []
        var recientes: [String] = []
        var falloStream: APIError?
        var falloLatido: APIError?
        var nowPlaying: NowPlaying?
    }

    let estado = OSAllocatedUnfairLock(initialState: Estado())
    let grant: StreamGrant
    static let base = "http://umbrel.local:7792"

    init() throws {
        grant = try JSONDecoder().decode(StreamGrant.self, from: Fixtures.datos("v1/channelStream.json"))
    }

    var foto: Estado { estado.withLock { $0 } }

    func pedirStream(canal: CanalReproducible, modo: PlaybackMode, visor: String) async throws -> Concesion {
        let fallo = estado.withLock { e -> APIError? in
            e.streams.append(canal.id)
            return e.falloStream
        }
        if let fallo { throw fallo }
        return Concesion(grant: grant, url: URL(string: Self.base + grant.url)!)
    }

    func latido(sesion: String, visor: String, reproduciendo: Bool) async throws -> LatidoRecibido {
        let fallo = estado.withLock { e -> APIError? in
            e.latidos += 1
            return e.falloLatido
        }
        if let fallo { throw fallo }
        // La URL firmada cambia en cada latido: solo cuenta la ruta.
        let url = URL(string: Self.base + grant.url.replacingOccurrences(of: "firma", with: "otra-firma"))!
        let respuesta = HeartbeatResponse(session: grant.session, url: grant.url, protocol: .hlsFmp4, viewers: 1)
        return LatidoRecibido(respuesta: respuesta, url: url)
    }

    func soltar(sesion: String, visor: String, motivo: ReleaseReason) async {
        estado.withLock { $0.soltadas.append(motivo) }
    }

    func resultado(_ cuerpo: OutcomeBody) async {
        estado.withLock { $0.resultados.append(cuerpo.resultado) }
    }

    func informar(_ cuerpo: DiagnosticReportBody) async {
        estado.withLock { $0.informes.append(cuerpo.code) }
    }

    func estadoReproduccion() async throws -> PlaybackStatus {
        let ahora = estado.withLock { $0.nowPlaying }
        return PlaybackStatus(nowPlaying: ahora, learningCount: 0, serverTime: 0, sessions: [])
    }

    func guardarReciente(_ canal: CanalReproducible) async {
        estado.withLock { $0.recientes.append(canal.id) }
    }

    func olvidarServidor() async {}
}

/// Espera (sin bloquear el actor principal) a que se cumpla una condición.
@MainActor
func esperarHasta(
    _ descripcion: String, plazo: TimeInterval = 3, file: StaticString = #filePath, line: UInt = #line,
    _ condicion: () -> Bool
) async {
    let limite = Date().addingTimeInterval(plazo)
    while !condicion() && Date() < limite {
        try? await Task.sleep(for: .milliseconds(5))
    }
    XCTAssertTrue(condicion(), descripcion, file: file, line: line)
}

// MARK: - Tests

/// La máquina de estados del reproductor con un AVPlayer simulado: arranque,
/// reconexión con espera, salto al directo, cambio de fuente, traspaso,
/// latido, eventos del backend y vuelta a primer plano.
final class ReproductorTests: XCTestCase {
    private let visor = "ios_prueba"
    private let canalA = CanalReproducible(
        id: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", titulo: "DAZN 1", ih: false,
        partido: ContextoPartido(id: "p1", titulo: "Local – Visitante", competicion: "LaLiga", canal: "DAZN 1"),
        origen: "m3u")
    private let canalB = CanalReproducible(
        id: "b2c3d4e5f60718293a4b5c6d7e8f901234567890", titulo: "M+ LaLiga", ih: false, origen: "m3u")

    @MainActor
    private func preparar(modo: PlaybackMode = .balanced) throws -> (Reproductor, MotorFalso, ServicioFalso) {
        let motor = MotorFalso()
        let servicio = try ServicioFalso()
        let reproductor = Reproductor(
            motor: motor, servicio: servicio, visor: visor, modo: modo, automatico: false, esperar: { _ in })
        return (reproductor, motor, servicio)
    }

    /// Lleva la reproducción hasta la primera imagen.
    @MainActor
    private func arrancar(
        _ reproductor: Reproductor, _ motor: MotorFalso, canal: CanalReproducible? = nil,
        origen: OrigenReproduccion = .usuario
    ) async {
        reproductor.reproducir(canal ?? canalA, origen: origen)
        XCTAssertEqual(reproductor.conexion, .pidiendo)
        await esperarHasta("La URL se concede") { reproductor.conexion == .conectando }
        motor.emitir(.listo)
        XCTAssertEqual(reproductor.conexion, .arrancando)
        motor.emitir(.estado(.reproduciendo))
        motor.emitir(.primerFotograma)
        XCTAssertEqual(reproductor.conexion, .activa)
    }

    @MainActor
    func testArrancaConElPerfilDelModoYAvisaArrancoUnaSolaVez() async throws {
        let (reproductor, motor, servicio) = try preparar()
        await arrancar(reproductor, motor)

        XCTAssertEqual(reproductor.fase, .reproduciendo)
        XCTAssertTrue(reproductor.arranco)
        XCTAssertEqual(motor.cargadas.first?.path(), "/native/api/v1/video/s_Q2FuYWxEZVBydWViYQ/index.m3u8")
        // El colchón inicial sale del modo (Equilibrado: 8 s por delante y 8 s del directo).
        XCTAssertEqual(motor.perfiles.first?.preferredForwardBufferDuration, 8)
        XCTAssertEqual(motor.perfiles.first?.liveEdgeOffsetS, 8)
        XCTAssertGreaterThanOrEqual(motor.reproducciones, 1)
        await esperarHasta("Se manda «arranco»") { servicio.foto.resultados == [.arranco] }
        let id = canalA.id
        await esperarHasta("Se guarda en recientes") { servicio.foto.recientes == [id] }

        // Otro primer fotograma (tras un reenganche) no repite el «arranco».
        motor.emitir(.primerFotograma)
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(servicio.foto.resultados, [.arranco])
    }

    @MainActor
    func testCambiarDeModoNoReconecta() async throws {
        let (reproductor, motor, servicio) = try preparar()
        await arrancar(reproductor, motor)
        reproductor.cambiarModo(.low)
        XCTAssertEqual(motor.perfiles.last, PlaybackMode.low.perfilIOS)
        XCTAssertEqual(servicio.foto.streams.count, 1)
        XCTAssertEqual(reproductor.conexion, .activa)
    }

    @MainActor
    func testReconectaConEsperaYTrasTresReconexionesPasaALaSiguienteFuente() async throws {
        let (reproductor, motor, servicio) = try preparar()
        var avisos: [FalloFuente] = []
        let siguiente = canalB
        reproductor.alFallarFuente = { fallo in
            avisos.append(fallo)
            reproductor.reproducir(siguiente, origen: .automatico)
            return true
        }
        await arrancar(reproductor, motor)

        for n in 1...3 {
            motor.emitir(.fallo("corte de red"))
            XCTAssertEqual(reproductor.intento, IntentoReconexion(n: n, max: 3))
            await esperarHasta("Reconexión \(n)") {
                reproductor.conexion == .conectando && servicio.foto.streams.count == n + 1
            }
        }
        // La cuarta caída ya no reconecta: la fuente se da por perdida.
        motor.emitir(.fallo("corte de red"))

        XCTAssertEqual(avisos.count, 1)
        XCTAssertEqual(avisos.first?.canal.id, canalA.id)
        XCTAssertEqual(avisos.first?.resultado, .cayo, "Llegó a verse: es una caída, no un fallo")
        XCTAssertEqual(reproductor.canal?.id, canalB.id, "Suena la siguiente verificada")
        XCTAssertEqual(reproductor.errores, 1)
        await esperarHasta("Se suelta la sesión con motivo error") { servicio.foto.soltadas.contains(.error) }
        await esperarHasta("Se anota «cayo»") { servicio.foto.resultados.contains(.cayo) }
        await esperarHasta("Queda en el registro de fallos") {
            servicio.foto.informes.contains("player_source_failed")
        }
    }

    @MainActor
    func testEnElArranqueAutomaticoSoloHayUnaReconexionAntesDeLaImagen() async throws {
        let (reproductor, motor, servicio) = try preparar()
        var resultado: OutcomeResult?
        reproductor.alFallarFuente = { fallo in
            resultado = fallo.resultado
            return false
        }
        reproductor.reproducir(canalA, origen: .automatico)
        await esperarHasta("Concedida") { reproductor.conexion == .conectando }
        motor.emitir(.fallo("no arranca"))
        XCTAssertEqual(reproductor.intento, IntentoReconexion(n: 1, max: 1))
        await esperarHasta("Reconecta una vez") { servicio.foto.streams.count == 2 && reproductor.conexion == .conectando }
        motor.emitir(.fallo("no arranca"))

        XCTAssertEqual(reproductor.conexion, .error)
        XCTAssertEqual(reproductor.motivoParada, .fallo)
        XCTAssertEqual(resultado, .fallo, "Nunca dio imagen")
        XCTAssertNotNil(reproductor.mensaje)
    }

    @MainActor
    func testImagenCongeladaConVideoPorDelanteSaltaAlDirectoEnVezDeReiniciar() async throws {
        let (reproductor, motor, servicio) = try preparar()
        await arrancar(reproductor, motor)
        motor.ventana = VentanaDirecto(inicio: 0, fin: 100)
        motor.tiempoActual = 50

        // 4 tics de gracia tras arrancar y 4 con la imagen parada.
        for _ in 0..<8 { reproductor.tic() }
        await esperarHasta("Salta al borde útil (100 − 8 s de colchón)") { motor.saltos == [92] }
        XCTAssertEqual(reproductor.saltosAlDirecto, 1)
        XCTAssertEqual(reproductor.conexion, .activa, "No reinicia la conexión")
        XCTAssertEqual(servicio.foto.streams.count, 1)

        // Si después del salto sigue parada 16 tics (24 s), entonces sí reconecta.
        reproductor.tic()
        for _ in 0..<16 { reproductor.tic() }
        XCTAssertEqual(reproductor.conexion, .reconectando)
        XCTAssertEqual(motor.saltos, [92], "Sin vídeo por delante no vuelve a saltar")
    }

    @MainActor
    func testUnaPausaQueNoHemosPedidoSeRespetaYUnPlayDeFueraLaRestaura() async throws {
        let (reproductor, motor, _) = try preparar()
        await arrancar(reproductor, motor)

        // El botón de pausa del PiP (o unos auriculares) pausa AVPlayer directamente.
        motor.emitir(.estado(.pausado))
        await esperarHasta("Se toma como decisión de quien mira") { !reproductor.quiereReproducir }
        XCTAssertEqual(reproductor.fase, .pausado)
        // Con la pausa confirmada, el vigilante no lo cuenta como imagen congelada.
        for _ in 0..<30 { reproductor.tic() }
        XCTAssertEqual(reproductor.conexion, .activa)

        // P1: el play desde la pantalla de bloqueo restaura la intención.
        motor.emitir(.estado(.reproduciendo))
        XCTAssertTrue(reproductor.quiereReproducir)
        XCTAssertEqual(reproductor.fase, .reproduciendo)
    }

    @MainActor
    func testTraspasoPorSSEParaSinSoltarLaSesion() async throws {
        let (reproductor, motor, servicio) = try preparar()
        await arrancar(reproductor, motor)
        let datos = PlaybackHandoffData(
            sessionId: servicio.grant.session.id, viewerIds: [visor], byDeviceId: "web_salon", byClient: .web,
            hash: canalB.id, title: "Otro", reason: .otherChannel)
        reproductor.procesar(.playbackHandoff(datos))

        XCTAssertEqual(reproductor.conexion, .idle)
        XCTAssertEqual(reproductor.motivoParada, .traspaso)
        XCTAssertEqual(reproductor.canal?.id, canalA.id, "Se queda el canal para poder retomarlo aquí")
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertTrue(servicio.foto.soltadas.isEmpty, "El backend ya la soltó")
    }

    @MainActor
    func testLatidoCon410YOtroDispositivoEnElMandoEsTraspaso() async throws {
        let (reproductor, motor, servicio) = try preparar()
        reproductor.dispositivoId = "dev_iphone01"
        await arrancar(reproductor, motor)
        let id = canalA.id
        servicio.estado.withLock {
            $0.falloLatido = .servidor(codigo: "session_expired", estado: 410, mensaje: nil, requestId: nil)
            $0.nowPlaying = NowPlaying(id: id, title: "DAZN 1", dev: "web_salon01", token: "t", at: 0)
        }
        await reproductor.latir()
        XCTAssertEqual(reproductor.motivoParada, .traspaso)
        XCTAssertEqual(reproductor.conexion, .idle)
    }

    @MainActor
    func testLatidoCon410SinOtroDispositivoReconecta() async throws {
        let (reproductor, motor, servicio) = try preparar()
        reproductor.dispositivoId = "dev_iphone01"
        await arrancar(reproductor, motor)
        servicio.estado.withLock {
            $0.falloLatido = .servidor(codigo: "session_not_found", estado: 404, mensaje: nil, requestId: nil)
            $0.nowPlaying = nil
        }
        await reproductor.latir()
        XCTAssertEqual(reproductor.conexion, .reconectando)
        XCTAssertEqual(reproductor.intento?.n, 1)
    }

    @MainActor
    func testUnLatidoConOtraFirmaNoReengancha() async throws {
        let (reproductor, motor, servicio) = try preparar()
        await arrancar(reproductor, motor)
        await reproductor.latir()
        XCTAssertEqual(servicio.foto.latidos, 1)
        XCTAssertEqual(reproductor.conexion, .activa)
        XCTAssertEqual(servicio.foto.streams.count, 1)
    }

    @MainActor
    func testStreamReopenedReenganchaSinIntervencion() async throws {
        let (reproductor, motor, servicio) = try preparar()
        await arrancar(reproductor, motor)
        let datos = StreamReopenedData(
            sessionId: servicio.grant.session.id, viewerIds: [visor], url: servicio.grant.url, protocol: .hlsFmp4,
            reason: .remuxRestart)
        reproductor.procesar(.streamReopened(datos))
        XCTAssertEqual(reproductor.conexion, .conectando)
        XCTAssertTrue(reproductor.mensaje?.contains("reiniciado") ?? false)
        await esperarHasta("Pide la URL otra vez") { servicio.foto.streams.count == 2 }
        motor.emitir(.listo)
        motor.emitir(.primerFotograma)
        XCTAssertEqual(reproductor.conexion, .activa)
        XCTAssertNil(reproductor.mensaje)
        XCTAssertNil(reproductor.intento, "Un reenganche no gasta reconexiones")
    }

    @MainActor
    func testUnEventoDeOtraSesionNoNosToca() async throws {
        let (reproductor, motor, servicio) = try preparar()
        await arrancar(reproductor, motor)
        let datos = StreamReopenedData(
            sessionId: "s_otra", viewerIds: ["ios_otro"], url: "/x", protocol: .hlsFmp4, reason: .engineRestart)
        reproductor.procesar(.streamReopened(datos))
        XCTAssertEqual(reproductor.conexion, .activa)
        XCTAssertEqual(servicio.foto.streams.count, 1)
    }

    @MainActor
    func testAlVolverAPrimerPlanoRecuperaLaSenalYVuelveAlDirecto() async throws {
        let (reproductor, motor, servicio) = try preparar()
        await arrancar(reproductor, motor)
        // En segundo plano la señal siguió y el reproductor se quedó parado atrás.
        motor.estadoTiempo = .pausado
        motor.ventana = VentanaDirecto(inicio: 0, fin: 100)
        motor.tiempoActual = 50
        let antes = motor.reproducciones

        reproductor.volvioAPrimerPlano()

        XCTAssertGreaterThan(motor.reproducciones, antes)
        await esperarHasta("Salta al directo") { motor.saltos == [92] }
        await esperarHasta("Comprueba la sesión con un latido") { servicio.foto.latidos >= 1 }
    }

    @MainActor
    func testDetenerSueltaLaSesionYOcultaElMini() async throws {
        let (reproductor, motor, servicio) = try preparar()
        await arrancar(reproductor, motor)
        XCTAssertTrue(reproductor.visibleEnMini)
        reproductor.superficieGrande(visible: true)
        XCTAssertFalse(reproductor.visibleEnMini, "Con el partido en pantalla no hace falta el mini")
        reproductor.superficieGrande(visible: false)

        reproductor.detener()

        XCTAssertEqual(reproductor.conexion, .idle)
        XCTAssertNil(reproductor.canal)
        XCTAssertFalse(reproductor.visibleEnMini)
        XCTAssertGreaterThan(motor.vaciados, 0)
        await esperarHasta("Suelta con motivo «user»") { servicio.foto.soltadas == [.user] }
        await esperarHasta("Deja el resumen de la sesión") { servicio.foto.informes.contains("player_session") }
    }

    @MainActor
    func testCambiarDeCanalSueltaLaSesionAnteriorComoCambioDeCanal() async throws {
        let (reproductor, motor, servicio) = try preparar()
        reproductor.lista = [canalA, canalB]
        await arrancar(reproductor, motor)
        reproductor.cambiarCanal(1)
        XCTAssertEqual(reproductor.canal?.id, canalB.id)
        await esperarHasta("Suelta la anterior") { servicio.foto.soltadas == [.channelChange] }
        reproductor.cambiarCanal(1)
        XCTAssertEqual(reproductor.canal?.id, canalA.id, "La lista da la vuelta")
    }

    @MainActor
    func testUnErrorQueNoSeArreglaReintentandoNoReconecta() async throws {
        let (reproductor, _, servicio) = try preparar()
        servicio.estado.withLock {
            $0.falloStream = .servidor(codigo: "invalid_hash", estado: 400, mensaje: "Hash no válido", requestId: nil)
        }
        reproductor.reproducir(canalA)
        await esperarHasta("Falla sin reintentar") { reproductor.conexion == .error }
        XCTAssertEqual(servicio.foto.streams.count, 1)
    }

    @MainActor
    func testElDirectoSeMideContraElBordeUtil() async throws {
        let (reproductor, motor, _) = try preparar()
        await arrancar(reproductor, motor)
        motor.ventana = VentanaDirecto(inicio: 0, fin: 100)
        motor.tiempoActual = 91
        // Los 4 tics de gracia también miden.
        reproductor.tic()
        XCTAssertTrue(reproductor.directo.enDirecto)
        XCTAssertEqual(reproductor.directo.textoBoton, "Directo")
        motor.tiempoActual = 60
        reproductor.tic()
        XCTAssertFalse(reproductor.directo.enDirecto)
        XCTAssertEqual(reproductor.directo.textoBoton, "−32 s")

        await reproductor.retroceder()
        XCTAssertEqual(motor.saltos.last, 30)
        await reproductor.irAlDirecto()
        XCTAssertEqual(motor.saltos.last, 92)
    }
}
