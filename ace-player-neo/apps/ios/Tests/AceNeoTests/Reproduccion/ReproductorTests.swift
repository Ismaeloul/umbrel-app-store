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
    private(set) var silenciado = false
    var saltoLlega = true

    func cargar(url: URL, perfil: IosPlaybackProfile) {
        cargadas.append(url)
        perfiles.append(perfil)
    }

    func aplicar(perfil: IosPlaybackProfile) { perfiles.append(perfil) }
    func reproducir() { reproducciones += 1 }
    func pausar() { pausas += 1 }

    func saltar(a segundos: Double) async -> Bool {
        saltos.append(segundos)
        if saltoLlega { tiempoActual = segundos }
        return saltoLlega
    }

    func vaciar() { vaciados += 1 }
    func silenciar(_ silencio: Bool) { silenciado = silencio }

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
        var fuentesResultado: [String?] = []
        var informes: [String] = []
        var recientes: [String] = []
        var falloStream: APIError?
        var falloLatido: APIError?
        var falloReciente: APIError?
        var nowPlaying: NowPlaying?
    }

    let estado = OSAllocatedUnfairLock(initialState: Estado())
    let grant: StreamGrant
    let biblioteca: LibraryView
    static let base = "http://umbrel.local:7792"

    init() throws {
        grant = try JSONDecoder().decode(StreamGrant.self, from: Fixtures.datos("v1/channelStream.json"))
        biblioteca = try JSONDecoder().decode(LibraryView.self, from: Fixtures.datos("v1/libraryGet.json"))
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
        estado.withLock {
            $0.resultados.append(cuerpo.resultado)
            $0.fuentesResultado.append(cuerpo.source)
        }
    }

    func informar(_ cuerpo: DiagnosticReportBody) async {
        estado.withLock { $0.informes.append(cuerpo.code) }
    }

    func estadoReproduccion() async throws -> PlaybackStatus {
        let ahora = estado.withLock { $0.nowPlaying }
        return PlaybackStatus(nowPlaying: ahora, learningCount: 0, serverTime: 0, sessions: [])
    }

    func guardarReciente(_ canal: CanalReproducible) async throws -> LibraryView {
        let fallo = estado.withLock { e -> APIError? in
            e.recientes.append(canal.id)
            return e.falloReciente
        }
        if let fallo { throw fallo }
        return biblioteca
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

/// La máquina de estados del reproductor con un AVPlayer simulado (player/runtime.ts): arranque, reconexión con
/// espera, salto al directo, cambio de fuente, traspaso, latido, eventos del backend, vuelta a primer plano,
/// demo y los avisos con los textos de la web.
final class ReproductorTests: XCTestCase {
    private let visor = "v_pruebaPrueba01"
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
        reproductor.demo = false
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
        var fuente = canalA
        fuente.fuente = "Elcano"
        XCTAssertEqual(reproductor.reposo, .inicio)
        reproductor.reproducir(fuente)
        XCTAssertEqual(reproductor.mensaje, "Conectando con AceStream…")
        // Recientes se apunta al pedir la fuente (recordHistory), no al arrancar.
        let id = canalA.id
        await esperarHasta("Se guarda en recientes") { servicio.foto.recientes == [id] }
        await esperarHasta("La URL se concede") { reproductor.conexion == .conectando }
        motor.emitir(.listo)
        motor.emitir(.estado(.reproduciendo))
        motor.emitir(.primerFotograma)

        XCTAssertEqual(reproductor.fase, .reproduciendo)
        XCTAssertTrue(reproductor.arranco)
        XCTAssertNil(reproductor.mensaje)
        XCTAssertNil(reproductor.reposo)
        XCTAssertEqual(reproductor.protocolo, .hlsFmp4)
        XCTAssertEqual(reproductor.codec?.video, "hevc")
        XCTAssertEqual(motor.cargadas.first?.path(), "/native/api/v1/video/s_Q2FuYWxEZVBydWViYQ/index.m3u8")
        // El colchón inicial sale del modo (Equilibrado: 8 s por delante y 8 s del directo).
        XCTAssertEqual(motor.perfiles.first?.preferredForwardBufferDuration, 8)
        XCTAssertEqual(motor.perfiles.first?.liveEdgeOffsetS, 8)
        XCTAssertGreaterThanOrEqual(motor.reproducciones, 1)
        await esperarHasta("Se manda «arranco» con el proveedor") { servicio.foto.resultados == [.arranco] }
        XCTAssertEqual(servicio.foto.fuentesResultado, ["Elcano"])

        // Otro primer fotograma (tras un reenganche) no repite el «arranco».
        motor.emitir(.primerFotograma)
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(servicio.foto.resultados, [.arranco])
    }

    @MainActor
    func testUnHashPegadoNoEntraEnRecientesYElFalloDeRecientesAvisa() async throws {
        let (reproductor, _, servicio) = try preparar()
        var avisos: [AvisoReproductor] = []
        reproductor.avisar = { avisos.append($0) }
        var pegado = canalB
        pegado.origen = "manual"
        reproductor.reproducir(pegado)
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertTrue(servicio.foto.recientes.isEmpty)

        servicio.estado.withLock { $0.falloReciente = .red(.notConnectedToInternet) }
        reproductor.reproducir(canalA)
        await esperarHasta("Toast «No se pudo guardar el historial»") {
            avisos.contains { $0.texto == "No se pudo guardar el historial" && $0.clase == .accion && $0.tono == .warn }
        }
    }

    @MainActor
    func testElMismoCanalEnMarchaNoSeReinicia() async throws {
        let (reproductor, motor, servicio) = try preparar()
        await arrancar(reproductor, motor)
        var conSubtitulo = canalA
        conSubtitulo.subtitulo = "Fuente 2, Faro"
        reproductor.reproducir(conSubtitulo)
        XCTAssertEqual(reproductor.conexion, .activa)
        XCTAssertEqual(reproductor.canal?.subtitulo, "Fuente 2, Faro")
        XCTAssertEqual(servicio.foto.streams.count, 1)
    }

    @MainActor
    func testCambiarDeModoNoReconectaYAvisa() async throws {
        let (reproductor, motor, servicio) = try preparar()
        var avisos: [AvisoReproductor] = []
        reproductor.avisar = { avisos.append($0) }
        await arrancar(reproductor, motor)
        reproductor.cambiarModo(.low)
        XCTAssertEqual(motor.perfiles.last, PlaybackMode.low.perfilIOS)
        XCTAssertEqual(servicio.foto.streams.count, 1)
        XCTAssertEqual(reproductor.conexion, .activa)
        XCTAssertEqual(avisos.last?.texto, "Modo «Baja latencia» activado")
        XCTAssertEqual(avisos.last?.tono, .ok)
    }

    @MainActor
    func testReconectaConEsperaYTrasTresReconexionesPasaALaSiguienteFuente() async throws {
        let (reproductor, motor, servicio) = try preparar()
        var fallos: [FalloFuente] = []
        var avisos: [AvisoReproductor] = []
        reproductor.avisar = { avisos.append($0) }
        let siguiente = canalB
        reproductor.alFallarFuente = { fallo in
            fallos.append(fallo)
            reproductor.reproducir(siguiente, origen: .automatico)
            return true
        }
        await arrancar(reproductor, motor)

        for n in 1...3 {
            motor.emitir(.fallo("corte de red"))
            XCTAssertEqual(reproductor.intento, IntentoReconexion(n: n, max: 3))
            XCTAssertEqual(reproductor.mensaje, "La señal se ha cortado: reconectando (\(n)/3)…")
            XCTAssertEqual(avisos.last?.texto, "La señal se ha cortado: reconectando (\(n)/3)…")
            XCTAssertEqual(avisos.last?.icono, .refresh)
            await esperarHasta("Reconexión \(n)") {
                reproductor.conexion == .conectando && servicio.foto.streams.count == n + 1
            }
            XCTAssertEqual(reproductor.mensaje, "Reconectando con AceStream…")
        }
        // La cuarta caída ya no reconecta: la fuente se da por perdida.
        motor.emitir(.fallo("corte de red"))

        XCTAssertEqual(fallos.count, 1)
        XCTAssertEqual(fallos.first?.canal.id, canalA.id)
        XCTAssertEqual(fallos.first?.resultado, .cayo, "Llegó a verse: es una caída, no un fallo")
        XCTAssertEqual(reproductor.canal?.id, canalB.id, "Suena la siguiente verificada")
        XCTAssertEqual(reproductor.mensaje, "Esta fuente no responde: probando la siguiente…")
        XCTAssertEqual(avisos.last?.senal, .checking)
        await esperarHasta("Se suelta la sesión con motivo error") { servicio.foto.soltadas.contains(.error) }
        await esperarHasta("Se anota «cayo»") { servicio.foto.resultados.contains(.cayo) }
        await esperarHasta("Queda en el registro de fallos") {
            servicio.foto.informes.contains("player_source_failed")
        }
    }

    @MainActor
    func testFuenteAgotadaSinOtraEnseñaElTextoDeLaSesionODeLaWeb() async throws {
        let (reproductor, motor, _) = try preparar()
        var avisos: [AvisoReproductor] = []
        reproductor.avisar = { avisos.append($0) }
        reproductor.alFallarFuente = { _ in
            reproductor.textoFalloPendiente = "Esta señal no responde y no quedan más fuentes para este canal."
            return false
        }
        reproductor.reproducir(canalA, origen: .automatico)
        await esperarHasta("Concedida") { reproductor.conexion == .conectando }
        motor.emitir(.fallo("x"))
        await esperarHasta("Reconecta") { reproductor.conexion == .conectando }
        motor.emitir(.fallo("x"))
        XCTAssertEqual(reproductor.conexion, .error)
        XCTAssertEqual(reproductor.reposo, .fallo)
        XCTAssertEqual(reproductor.mensaje, "Esta señal no responde y no quedan más fuentes para este canal.")
        XCTAssertEqual(avisos.last?.tono, .err)
        XCTAssertEqual(avisos.last?.senal, .fail)
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
        XCTAssertEqual(reproductor.mensaje, MotivoReposo.fallo.mensaje)
        XCTAssertNotNil(reproductor.canal, "Tras una fuente agotada el canal se queda (reposo «fallo»)")
    }

    @MainActor
    func testImagenCongeladaConVideoPorDelanteSaltaAlDirectoEnVezDeReiniciar() async throws {
        let (reproductor, motor, servicio) = try preparar()
        await arrancar(reproductor, motor)
        motor.ventana = VentanaDirecto(inicio: 0, fin: 100)
        motor.tiempoActual = 50

        // Sin gracia tras el primer arranque (solo tras reconectar): 4 tics con la imagen parada.
        for _ in 0..<8 { reproductor.tic() }
        await esperarHasta("Salta al borde útil (100 − 8 s de colchón)") { motor.saltos == [92] }
        XCTAssertEqual(reproductor.saltosAlDirecto, 1)
        XCTAssertEqual(reproductor.conexion, .activa, "No reinicia la conexión")
        XCTAssertEqual(servicio.foto.streams.count, 1)

        // Si después del salto sigue parada 16 tics (24 s) y ya no hay vídeo por delante, reconecta.
        motor.probableSinCortes = false
        reproductor.tic()
        for _ in 0..<16 { reproductor.tic() }
        XCTAssertEqual(reproductor.conexion, .reconectando)
        XCTAssertEqual(reproductor.mensaje, "La imagen se ha quedado parada: reconectando (1/3)…")
        XCTAssertEqual(motor.saltos, [92], "Sin vídeo por delante no vuelve a saltar")
    }

    @MainActor
    func testConectandoSinImagen54SegundosReintenta() async throws {
        let (reproductor, _, _) = try preparar()
        reproductor.reproducir(canalA)
        await esperarHasta("Concedida") { reproductor.conexion == .conectando }
        for _ in 0..<36 { reproductor.tic() }
        XCTAssertEqual(reproductor.conexion, .reconectando)
        XCTAssertEqual(reproductor.mensaje, "Sin señal suficiente: reintentando (1/3)…")
    }

    @MainActor
    func testTrasReconectarLaImagenVuelveConAvisoYGracia() async throws {
        let (reproductor, motor, _) = try preparar()
        var avisos: [AvisoReproductor] = []
        reproductor.avisar = { avisos.append($0) }
        await arrancar(reproductor, motor)
        motor.emitir(.fallo("corte"))
        await esperarHasta("Reconecta") { reproductor.conexion == .conectando }
        motor.emitir(.listo)
        motor.emitir(.primerFotograma)
        XCTAssertEqual(reproductor.conexion, .activa)
        XCTAssertNil(reproductor.intento)
        XCTAssertEqual(avisos.last?.texto, "Señal recuperada")
        XCTAssertEqual(avisos.last?.tono, .ok)
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
    func testAlternarNoHaceNadaConectandoYReintentaConError() async throws {
        let (reproductor, motor, servicio) = try preparar()
        reproductor.reproducir(canalA)
        reproductor.alternar()
        XCTAssertTrue(reproductor.quiereReproducir, "Conectando no hay nada que pausar")
        XCTAssertEqual(motor.pausas, 0)
        servicio.estado.withLock {
            $0.falloStream = .servidor(codigo: "invalid_hash", estado: 400, mensaje: "Hash no válido", requestId: nil)
        }
        reproductor.detener()
        reproductor.reproducir(canalB)
        await esperarHasta("Error") { reproductor.conexion == .error }
        servicio.estado.withLock { $0.falloStream = nil }
        reproductor.alternar()
        await esperarHasta("Reintenta la misma fuente") { reproductor.conexion == .conectando }
        XCTAssertEqual(reproductor.canal?.id, canalB.id)
    }

    @MainActor
    func testTraspasoPorSSEParaSinSoltarLaSesion() async throws {
        let (reproductor, motor, servicio) = try preparar()
        var avisos: [AvisoReproductor] = []
        var sucesos: [SucesoReproductor] = []
        reproductor.avisar = { avisos.append($0) }
        reproductor.escuchar { sucesos.append($0) }
        await arrancar(reproductor, motor)
        let datos = PlaybackHandoffData(
            sessionId: servicio.grant.session.id, viewerIds: [visor], byDeviceId: "web_salon", byClient: .web,
            hash: canalB.id, title: "Otro", reason: .otherChannel)
        reproductor.procesar(.playbackHandoff(datos))

        XCTAssertEqual(reproductor.conexion, .idle)
        XCTAssertEqual(reproductor.motivoParada, .traspaso)
        XCTAssertEqual(reproductor.reposo, .traspasado)
        XCTAssertNil(reproductor.canal, "stop('traspasado') de la web: sin canal")
        XCTAssertEqual(reproductor.mensaje, "La reproducción ha pasado a otro dispositivo.")
        XCTAssertEqual(avisos.last?.texto, "La reproducción ha pasado a otro dispositivo")
        XCTAssertEqual(avisos.last?.icono, .movil)
        XCTAssertEqual(sucesos.last, .parado(.traspaso))
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
        XCTAssertEqual(reproductor.mensaje, "La sesión había caducado: reconectando (1/3)…")
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
        var avisos: [AvisoReproductor] = []
        reproductor.avisar = { avisos.append($0) }
        let datos = StreamReopenedData(
            sessionId: servicio.grant.session.id, viewerIds: [visor], url: servicio.grant.url, protocol: .hlsFmp4,
            reason: .remuxRestart)
        reproductor.procesar(.streamReopened(datos))
        XCTAssertEqual(reproductor.conexion, .conectando)
        // `reattach` de runtime.ts: el aviso queda como mensaje del vídeo (no «Conectando con AceStream…»).
        XCTAssertEqual(reproductor.mensaje, TextosReproductor.remuxReiniciado)
        await esperarHasta("Pide la URL otra vez") { servicio.foto.streams.count == 2 }
        motor.emitir(.listo)
        motor.emitir(.primerFotograma)
        XCTAssertEqual(reproductor.conexion, .activa)
        XCTAssertNil(reproductor.mensaje)
        XCTAssertNil(reproductor.intento, "Un reenganche no gasta reconexiones")
        // Es una recuperación: con la primera imagen, «Señal recuperada» (onFirstFrame con `recovery`).
        XCTAssertEqual(avisos.last?.texto, TextosReproductor.senalRecuperada)
        XCTAssertEqual(avisos.last?.tono, .ok)
    }

    @MainActor
    func testUnEventoDeOtraSesionNoNosToca() async throws {
        let (reproductor, motor, servicio) = try preparar()
        await arrancar(reproductor, motor)
        let datos = StreamReopenedData(
            sessionId: "s_otra", viewerIds: ["v_otro"], url: "/x", protocol: .hlsFmp4, reason: .engineRestart)
        reproductor.procesar(.streamReopened(datos))
        XCTAssertEqual(reproductor.conexion, .activa)
        XCTAssertEqual(servicio.foto.streams.count, 1)
    }

    @MainActor
    func testStreamClosedRevocadoEsUnFalloDeSistema() async throws {
        let (reproductor, motor, servicio) = try preparar()
        var agotadas = 0
        reproductor.alFallarFuente = { _ in
            agotadas += 1
            return false
        }
        await arrancar(reproductor, motor)
        let datos = StreamClosedData(
            sessionId: servicio.grant.session.id, viewerIds: [visor], reason: .revoked, code: nil)
        reproductor.procesar(.streamClosed(datos))
        XCTAssertEqual(reproductor.conexion, .error)
        XCTAssertEqual(reproductor.mensaje, "Este dispositivo ya no tiene acceso al reproductor.")
        XCTAssertEqual(agotadas, 0, "Un fallo de sistema no salta de fuente")
    }

    @MainActor
    func testMotorCaidoEsperaAQueVuelvaYReengancha() async throws {
        let (reproductor, _, servicio) = try preparar()
        var avisos: [AvisoReproductor] = []
        reproductor.avisar = { avisos.append($0) }
        servicio.estado.withLock {
            $0.falloStream = .servidor(
                codigo: "engine_unavailable", estado: 503, mensaje: "El motor no responde", requestId: nil)
        }
        reproductor.reproducir(canalA)
        await esperarHasta("Fallo de sistema") { reproductor.conexion == .error }
        XCTAssertEqual(reproductor.reposo, .sinMotor)
        XCTAssertEqual(servicio.foto.streams.count, 1, "No reintenta")
        servicio.estado.withLock { $0.falloStream = nil }
        let motor = try JSONDecoder().decode(EngineStatus.self, from: Fixtures.datos("v1/engineStatus.json"))
        XCTAssertTrue(motor.online)
        reproductor.procesar(.engineStatus(motor))
        XCTAssertEqual(avisos.last?.texto, "Motor de vuelta: reconectando «DAZN 1»…")
        await esperarHasta("Vuelve a pedir la fuente") { servicio.foto.streams.count == 2 }
    }

    @MainActor
    func testUnErrorDeSistemaNoSeReintentaNiSaltaDeFuente() async throws {
        let (reproductor, _, servicio) = try preparar()
        var agotadas = 0
        reproductor.alFallarFuente = { _ in
            agotadas += 1
            return false
        }
        servicio.estado.withLock {
            $0.falloStream = .servidor(codigo: "remux_busy", estado: 503, mensaje: "Remux ocupado", requestId: nil)
        }
        reproductor.reproducir(canalA)
        await esperarHasta("Error") { reproductor.conexion == .error }
        XCTAssertEqual(servicio.foto.streams.count, 1)
        XCTAssertEqual(agotadas, 0)
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
    func testAlVolverAPrimerPlanoLateYSiguePausadoPorAjenoSeReanuda() async throws {
        let (reproductor, motor, servicio) = try preparar()
        await arrancar(reproductor, motor)
        motor.estadoTiempo = .pausado
        let antes = motor.reproducciones

        reproductor.volvioAPrimerPlano()

        XCTAssertGreaterThan(motor.reproducciones, antes)
        await esperarHasta("Comprueba la sesión con un latido") { servicio.foto.latidos >= 1 }
        XCTAssertTrue(motor.saltos.isEmpty, "La web no salta al directo al volver")
    }

    @MainActor
    func testAlVolverConElMedioRotoReconectaDeCero() async throws {
        let (reproductor, motor, _) = try preparar()
        await arrancar(reproductor, motor)
        motor.estadoTiempo = .esperando
        motor.probableSinCortes = false
        motor.colchonPorDelante = 0
        reproductor.volvioAPrimerPlano()
        XCTAssertEqual(reproductor.conexion, .reconectando)
        XCTAssertEqual(reproductor.mensaje, "Reconectando al volver a la app (1/3)…")
    }

    @MainActor
    func testDetenerSueltaLaSesionYDejaElMensajeDeLaWeb() async throws {
        let (reproductor, motor, servicio) = try preparar()
        var sucesos: [SucesoReproductor] = []
        reproductor.escuchar { sucesos.append($0) }
        await arrancar(reproductor, motor)

        reproductor.detener()

        XCTAssertEqual(reproductor.conexion, .idle)
        XCTAssertNil(reproductor.canal)
        XCTAssertEqual(reproductor.motivoParada, .usuario)
        XCTAssertEqual(reproductor.reposo, .detenido)
        XCTAssertEqual(reproductor.mensaje, "Reproducción detenida. Elige otro partido o canal.")
        XCTAssertTrue(reproductor.puedeDeshacerDetencion)
        XCTAssertEqual(sucesos.last, .parado(.usuario))
        XCTAssertGreaterThan(motor.vaciados, 0)
        await esperarHasta("Suelta con motivo «user»") { servicio.foto.soltadas == [.user] }
        await esperarHasta("Deja el resumen de la sesión") { servicio.foto.informes.contains("player_session") }

        XCTAssertTrue(reproductor.deshacerDetencion())
        XCTAssertEqual(reproductor.canal?.id, canalA.id)
    }

    @MainActor
    func testCambiarDeCanalNoSueltaLaSesionAnterior() async throws {
        let (reproductor, motor, servicio) = try preparar()
        await arrancar(reproductor, motor)
        reproductor.reproducir(canalB)
        XCTAssertEqual(reproductor.canal?.id, canalB.id)
        try await Task.sleep(for: .milliseconds(30))
        // La concesión nueva con el mismo visor sustituye a la vieja en el backend (a7 §9.2).
        XCTAssertTrue(servicio.foto.soltadas.isEmpty)
        await esperarHasta("Resumen de la fuente anterior") { servicio.foto.informes.contains("player_session") }
    }

    @MainActor
    func testZappingComoLaWeb() async throws {
        let (reproductor, motor, _) = try preparar()
        var avisos: [AvisoReproductor] = []
        var vibraciones: [TipoHaptico] = []
        var destinos: [String] = []
        reproductor.avisar = { avisos.append($0) }
        reproductor.vibrar = { vibraciones.append($0) }
        reproductor.alZapear = { destinos.append($0.id) }
        let canalC = CanalReproducible(id: "c3d4e5f60718293a4b5c6d7e8f9012345678901a", titulo: "Canal C", ih: false)
        reproductor.lista = [canalA, canalB, canalC]
        await arrancar(reproductor, motor)
        XCTAssertTrue(reproductor.puedeZapear)
        reproductor.cambiarCanal(-1)
        XCTAssertEqual(reproductor.canal?.id, canalC.id, "En bucle hacia atrás")
        XCTAssertEqual(reproductor.origen, .zapping)
        XCTAssertEqual(avisos.last?.texto, "Zapping: Canal C")
        XCTAssertEqual(vibraciones, [.rigida])
        XCTAssertEqual(destinos, [canalC.id])

        // Si el actual no está en la lista, el siguiente es el primero (zapTarget), sea cual sea el sentido.
        XCTAssertEqual(Reproductor.destinoZapeo([canalA, canalB], actual: "otro", paso: -1)?.id, canalA.id)
        XCTAssertNil(Reproductor.destinoZapeo([canalA], actual: canalA.id, paso: 1), "Nunca el mismo")
        XCTAssertNil(Reproductor.destinoZapeo([], actual: nil, paso: 1))
    }

    @MainActor
    func testElDirectoYLosAvisosDelBotonYDeMenos30() async throws {
        let (reproductor, motor, _) = try preparar()
        var avisos: [AvisoReproductor] = []
        reproductor.avisar = { avisos.append($0) }
        await arrancar(reproductor, motor)
        motor.ventana = VentanaDirecto(inicio: 0, fin: 100)
        motor.tiempoActual = 91
        reproductor.tic()
        XCTAssertTrue(reproductor.directo.enDirecto)
        await reproductor.irAlDirecto()
        XCTAssertEqual(avisos.last?.texto, "Ya estabas en el directo")
        motor.tiempoActual = 60
        reproductor.tic()
        XCTAssertFalse(reproductor.directo.enDirecto)
        XCTAssertEqual(EstadoVisible.botonDirecto(reproductor.foto).texto, "−32 s")

        await reproductor.retroceder()
        XCTAssertEqual(motor.saltos.last, 30)
        XCTAssertEqual(avisos.last?.texto, "Retrocedido 30 s · pulsa DIRECTO para volver")
        await reproductor.irAlDirecto()
        XCTAssertEqual(motor.saltos.last, 92)
        XCTAssertEqual(avisos.last?.texto, "De vuelta al directo")

        motor.tiempoActual = 0.5
        await reproductor.retroceder()
        XCTAssertEqual(avisos.last?.texto, "No hay más imagen guardada hacia atrás")
        motor.ventana = nil
        await reproductor.retroceder()
        XCTAssertEqual(avisos.last?.texto, "Todavía no hay imagen guardada para retroceder")
        motor.ventana = VentanaDirecto(inicio: 0, fin: 100)
        motor.tiempoActual = 10
        motor.saltoLlega = false
        await reproductor.irAlDirecto()
        XCTAssertEqual(avisos.last?.texto, "La señal no deja saltar más adelante")
        XCTAssertEqual(avisos.last?.tono, .warn)
    }

    @MainActor
    func testEnDemoNoPideLaFuenteNiLateNiCuentaNada() async throws {
        let (reproductor, motor, servicio) = try preparar()
        reproductor.demo = true
        var avisos: [AvisoReproductor] = []
        reproductor.avisar = { avisos.append($0) }
        reproductor.reproducir(canalA)
        XCTAssertEqual(reproductor.conexion, .conectando)
        XCTAssertEqual(motor.cargadas.last?.absoluteString, "demo:\(canalA.id)")
        motor.emitir(.listo)
        motor.emitir(.estado(.reproduciendo))
        motor.emitir(.primerFotograma)
        XCTAssertEqual(reproductor.conexion, .activa)
        XCTAssertEqual(EstadoVisible.linea(reproductor.foto)?.dato, "demo")
        await reproductor.latir()
        await reproductor.irAlDirecto()
        XCTAssertEqual(avisos.last?.texto, "Ya estás en el directo (en demo no hay retardo)")
        await reproductor.retroceder()
        XCTAssertEqual(avisos.last?.texto, "En la demo no hay imagen guardada que repetir")
        reproductor.detener()
        try await Task.sleep(for: .milliseconds(30))
        let foto = servicio.foto
        XCTAssertTrue(foto.streams.isEmpty && foto.latidos == 0 && foto.soltadas.isEmpty)
        XCTAssertTrue(foto.resultados.isEmpty && foto.informes.isEmpty)
        XCTAssertEqual(foto.recientes, [canalA.id], "Recientes sí (a7 §13.13)")

        // El canal de muestra «caído» lleva la marca para que el motor simulado falle.
        let caido = CanalReproducible(id: canalB.id, titulo: "Canal caído")
        reproductor.reproducir(caido)
        XCTAssertEqual(motor.cargadas.last?.absoluteString, "demo:\(canalB.id)?falla=1")
        motor.emitir(.fallo("La señal de muestra no responde; buscando una alternativa"))
        XCTAssertEqual(reproductor.mensaje, "La señal de muestra no responde; buscando una alternativa (1/3)…")
    }

    @MainActor
    func testSilencio() throws {
        let (reproductor, motor, _) = try preparar()
        reproductor.silenciar(true)
        XCTAssertTrue(motor.silenciado)
        XCTAssertTrue(reproductor.silenciado)
    }
}
