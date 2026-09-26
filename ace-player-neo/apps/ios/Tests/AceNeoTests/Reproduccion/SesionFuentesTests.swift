import XCTest
import os

@testable import AceNeo

/// Lo que la sesión de fuentes necesita de la app, con piezas de verdad (doble de `ContenedorApp`).
@MainActor
final class EntornoFuentesDePrueba: EntornoSesionFuentes {
    let api: APIClient
    let reproductor: Reproductor
    let avisos = Avisos()
    let haptica = Haptica()
    let hojas = CentroHojas()
    let reloj: any Reloj = RelojSistema()
    let datos: DatosApp
    var visor: String { reproductor.visor }
    var tiempoRealAbierto = false

    init(api: APIClient, reproductor: Reproductor, datos: DatosApp) {
        self.api = api
        self.reproductor = reproductor
        self.datos = datos
    }

    /// Los textos de los toasts que se ven (y los que están saliendo).
    var textos: [String] { avisos.cola.toasts.map(\.texto) }
}

/// Respuestas del servidor para la sesión de fuentes (con la forma de @ace/shared, como test-utils.ts de la web).
enum GuionFuentes {
    static let trabajoId = "0123456789abcdef01234567"
    static let reporteId = "abcdefabcdefabcdefabcdef"
    static let proveedores = ["Elcano", "Faro", "Norte", "Vega", "Tarifa", "Sur"]

    static func hash(_ n: Int) -> String {
        let hex = String(n, radix: 16)
        return String(repeating: "0", count: 40 - hex.count) + hex
    }

    static func candidata(_ n: Int, fuente: CandidateSource = .m3u) -> ResolutionCandidate {
        ResolutionCandidate(
            id: hash(n), title: "M+ Liga de Campeones --> \(proveedores[(n - 1) % proveedores.count])", alias: nil,
            ih: false, source: fuente, score: Double(100 - n), matchedChannel: "M+ Liga de Campeones",
            soloFamilia: false, familyFallbackAllowed: false, listaId: "principal", availability: nil, bitrate: nil,
            learned: nil, reported: nil, rejectedByLearning: false, quarantined: false, semantic: nil,
            semanticSimilarity: nil)
    }

    static func resolucion(_ total: Int, conComprobador: Bool = true, estado: ResolutionStatus = .found) -> Resolution {
        let candidatas = (1...max(1, total)).map { candidata($0) }
        let ref = ScanRef(id: trabajoId, statusUrl: "/api/v1/football/scans/\(trabajoId)", total: total, initialCount: 3)
        return Resolution(
            status: estado, channels: ["M+ Liga de Campeones"], checked: ["saved", "m3u", "acestream"],
            candidate: estado == .found ? candidatas.first : nil, candidates: estado == .found ? candidatas : [],
            engineAvailable: true, ai: AiInfo(enabled: false, used: false, model: nil, catalogSize: 0, error: nil),
            program: nil, research: false, preheated: nil, preheat: nil,
            scan: conComprobador && estado == .found ? ref : nil)
    }

    static func candidatoComprobador(_ n: Int, _ estado: ScanCandidateState, reintento: String? = nil) -> ScanCandidate {
        let viva = estado == .working || estado == .weak
        return ScanCandidate(
            id: hash(n), state: estado, checkedAt: nil, retryAt: reintento, durationMs: 900, bytes: viva ? 180_000 : 0,
            peers: viva ? 12 : 0, speedDown: 0, rateKbps: viva ? 4000 : nil, intakeKbps: viva ? 3000 : nil,
            streamKbps: viva ? 4000 : 0, reason: "", mediaValid: viva, browserCompatible: viva,
            videoCodec: viva ? "h264" : "", audioCodecs: [], cached: false,
            attempts: estado == .queued || estado == .checking ? 0 : 1,
            playableOn: estado == .queued || estado == .checking ? nil : PlayableOn(web: viva, ios: viva))
    }

    static func trabajo(
        _ estados: [ScanCandidateState], estado: ScanJobStatus, id: String = trabajoId, reintento: String? = nil,
        kind: ScanJobKind = .interactive
    ) -> ScanJob {
        let candidatos = estados.enumerated().map { candidatoComprobador($0.offset + 1, $0.element, reintento: reintento) }
        let hechas = estados.filter { $0 != .queued && $0 != .checking }.count
        let vivas = estados.filter { $0 == .working || $0 == .weak }.count
        return ScanJob(
            id: id, kind: kind, status: estado, createdAt: "2026-09-23T18:30:00.000Z",
            updatedAt: "2026-09-23T18:30:00.000Z", total: estados.count, checked: hechas, playable: vivas,
            failed: hechas - vivas, waiting: 0, retryAt: reintento, initialCount: 3, candidates: candidatos)
    }

    static func codificar<T: Encodable>(_ valor: T) -> Data {
        (try? JSONEncoder().encode(valor)) ?? Data()
    }
}

/// Lo que cambia mientras dura una prueba: qué contestan resolver, el comprobador y el reporte.
final class ServidorFuentes: Sendable {
    struct Estado: Sendable {
        var resolucion: Resolution = GuionFuentes.resolucion(3)
        var rebusqueda: Resolution?
        var trabajo: ScanJob? = GuionFuentes.trabajo([.working, .working, .weak], estado: .complete)
        var trabajoReporte: ScanJob?
        var falloComprobador = false
        var falloResolver = false
        var falloVincular = false
    }

    let estado = OSAllocatedUnfairLock(initialState: Estado())

    func responder(_ peticion: URLRequest) throws -> (Int, [String: String], Data) {
        let ruta = peticion.url?.path() ?? ""
        let e = estado.withLock { $0 }
        let query = peticion.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }?.queryItems ?? []
        if ruta.hasSuffix("/football/resolve") {
            if e.falloResolver { return (503, [:], Prueba.errorJSON("engine_unavailable")) }
            let rebuscar = query.contains { $0.name == "research" }
            return (200, [:], GuionFuentes.codificar(rebuscar ? (e.rebusqueda ?? e.resolucion) : e.resolucion))
        }
        if ruta.contains("/football/scans/\(GuionFuentes.reporteId)"), let reporte = e.trabajoReporte {
            return (200, [:], GuionFuentes.codificar(reporte))
        }
        if ruta.contains("/football/scans/") {
            if e.falloComprobador { return (500, [:], Prueba.errorJSON("internal_error")) }
            if let trabajo = e.trabajo { return (200, [:], GuionFuentes.codificar(trabajo)) }
            return (404, [:], Prueba.errorJSON("not_found"))
        }
        if ruta.hasSuffix("/sources/report") {
            let respuesta = #"{"report":{"reportId":"rep_1","id":"x","channel":"M+ Liga de Campeones","matchId":"m1","#
                + #""reason":"not_starting","state":"checking","checkReason":"","reportedAt":"2026-09-23T18:30:00.000Z","#
                + #""lastCheckedAt":null,"quarantineUntil":null},"scan":{"id":"\#(GuionFuentes.reporteId)","#
                + #""statusUrl":"/api/v1/football/scans/\#(GuionFuentes.reporteId)","total":1,"initialCount":1}}"#
            return (201, [:], Data(respuesta.utf8))
        }
        if ruta.hasSuffix("/sources/feedback") { return (200, [:], try Fixtures.datos("v1/sourcesFeedback.json")) }
        if ruta.hasSuffix("/football/bindings") {
            if e.falloVincular { return (500, [:], Prueba.errorJSON("internal_error")) }
            return (201, [:], try Fixtures.datos("v1/footballBind.json"))
        }
        return (404, [:], Prueba.errorJSON("not_found"))
    }
}

/// La sesión de fuentes (features/sources/session.ts) con el reproductor de verdad, un AVPlayer simulado y el API
/// por `URLProtocol`: arranque automático, cambio de fuente al fallar, manual que nunca salta, detener, zapping
/// fuera de la lista, reportar y seguir el reporte, comprobador caído, «Encontrar canal», pegar y canal suelto.
final class SesionFuentesTests: XCTestCase {
    private var retenidos: [AnyObject] = []

    override func tearDown() {
        MockURLProtocol.limpiar()
        retenidos = []
        super.tearDown()
    }

    private let partidoJSON =
        #"{"id":"m1","date":"2026-09-23","time":"21:00","title":"Atlético de Madrid vs Tottenham","home":"Atlético de Madrid","away":"Tottenham","competition":"Champions League","country":"Spain","channels":[{"id":"c1","name":"M+ Liga de Campeones"}]}"#

    @MainActor
    private func preparar(
        _ servidor: ServidorFuentes = ServidorFuentes()
    ) throws -> (SesionFuentes, EntornoFuentesDePrueba, MotorFalso, ServicioFalso) {
        MockURLProtocol.responder { peticion in try servidor.responder(peticion) }
        let api = APIClient(
            session: MockURLProtocol.sesion(), servidores: try Prueba.servidores(),
            tokens: MemoryTokenStore(token: Prueba.token))
        let cache = FileManager.default.temporaryDirectory
            .appendingPathComponent("AceNeoTests-fuentes-\(UUID().uuidString)", isDirectory: true)
        let datos = DatosApp(api: api, cache: DiskCache(directorio: cache))
        let motor = MotorFalso()
        let servicio = try ServicioFalso()
        let reproductor = Reproductor(
            motor: motor, servicio: servicio, visor: "v_pruebaPrueba01", automatico: false, esperar: { _ in })
        reproductor.demo = false
        let entorno = EntornoFuentesDePrueba(api: api, reproductor: reproductor, datos: datos)
        let sesion = SesionFuentes()
        sesion.intervaloSondeo = .milliseconds(20)
        sesion.conectar(entorno)
        reproductor.alFallarFuente = { [weak sesion] fallo in sesion?.alFallarFuente(fallo) ?? false }
        retenidos += [entorno, sesion, servidor]
        return (sesion, entorno, motor, servicio)
    }

    @MainActor
    private func partido(canales: Bool = true) throws -> FootballMatch {
        var partido = try JSONDecoder().decode(FootballMatch.self, from: Data(partidoJSON.utf8))
        if !canales { partido.channels = [] }
        return partido
    }

    /// Primera imagen de la fuente que se está conectando.
    @MainActor
    private func primeraImagen(_ entorno: EntornoFuentesDePrueba, _ motor: MotorFalso) async {
        await esperarHasta("Concedida", plazo: 5) { entorno.reproductor.conexion == .conectando }
        motor.emitir(.listo)
        motor.emitir(.estado(.reproduciendo))
        motor.emitir(.primerFotograma)
        XCTAssertEqual(entorno.reproductor.conexion, .activa)
    }

    /// Caídas hasta agotar la fuente (3 reconexiones con imagen; 1 en automático antes de la primera imagen).
    @MainActor
    private func agotar(_ entorno: EntornoFuentesDePrueba, _ motor: MotorFalso, servicio: ServicioFalso) async {
        let id = entorno.reproductor.canal?.id
        let maximo = entorno.reproductor.arranco || entorno.reproductor.origen != .automatico ? 3 : 1
        for n in 1...maximo {
            let antes = servicio.foto.streams.count
            motor.emitir(.fallo("corte de red"))
            await esperarHasta("Reconexión \(n)", plazo: 5) {
                entorno.reproductor.conexion == .conectando && servicio.foto.streams.count == antes + 1
                    && entorno.reproductor.canal?.id == id
            }
        }
        motor.emitir(.fallo("corte de red"))
    }

    // MARK: Entrar y arrancar solo

    @MainActor
    func testEntraResuelveYArrancaSolaLaPrimeraVerificada() async throws {
        let (sesion, entorno, _, servicio) = try preparar()
        await sesion.entrarPartido(try partido())

        XCTAssertEqual(sesion.clave, "partido:m1")
        XCTAssertEqual(sesion.tipo, .partido)
        XCTAssertEqual(sesion.entradas.map(\.id), (1...3).map { GuionFuentes.hash($0) }, "Orden del servidor")
        await esperarHasta("Arranca sola la verificada", plazo: 5) {
            entorno.reproductor.canal?.id == GuionFuentes.hash(1)
        }
        let canal = try XCTUnwrap(entorno.reproductor.canal)
        XCTAssertEqual(canal.titulo, "M+ Liga de Campeones", "El título sin el proveedor")
        XCTAssertEqual(canal.subtitulo, "Fuente 1, Elcano")
        XCTAssertEqual(canal.lead, "Fuente 1 verificada.")
        XCTAssertEqual(canal.fuente, "Elcano")
        XCTAssertEqual(entorno.reproductor.origen, .automatico)
        XCTAssertTrue(entorno.textos.contains("Fuente 1 verificada: arrancando"))
        XCTAssertNil(sesion.textoEspera)
        XCTAssertNil(entorno.reproductor.espera)
        XCTAssertEqual(sesion.activa, GuionFuentes.hash(1))
        XCTAssertTrue(sesion.entradas[0].probadaAuto)
        await esperarHasta("Pide la fuente", plazo: 5) { servicio.foto.streams.count == 1 }
        XCTAssertEqual(servicio.foto.streams, [GuionFuentes.hash(1)])
        // La que se conecta en pantalla cuenta como «comprobando» (regla 20): quedan la verificada y la floja.
        XCTAssertEqual(sesion.textoProgreso(ahora: Date()), "2 verificadas · 3 comprobadas")
    }

    @MainActor
    func testEntrarDeNuevoMientrasSuenaNoVuelveAResolver() async throws {
        let (sesion, entorno, motor, _) = try preparar()
        await sesion.entrarPartido(try partido())
        await primeraImagen(entorno, motor)
        let peticiones = MockURLProtocol.peticiones.filter { $0.url?.path().hasSuffix("/football/resolve") == true }
        sesion.salirVista()
        XCTAssertTrue(sesion.automatico || sesion.activa != nil, "Con el mini sonando la sesión sigue viva")
        await sesion.entrarPartido(try partido())
        let despues = MockURLProtocol.peticiones.filter { $0.url?.path().hasSuffix("/football/resolve") == true }
        XCTAssertEqual(peticiones.count, despues.count)
    }

    @MainActor
    func testSinCanalesNoResuelveYAvisa() async throws {
        let (sesion, entorno, _, _) = try preparar()
        await sesion.entrarPartido(try partido(canales: false))
        XCTAssertEqual(sesion.fase, .sinCanales)
        XCTAssertTrue(entorno.textos.contains("El canal todavía no está anunciado"))
        XCTAssertTrue(MockURLProtocol.peticiones.isEmpty)
    }

    @MainActor
    func testNoEncontradoAbreEncontrarCanal() async throws {
        let servidor = ServidorFuentes()
        servidor.estado.withLock { $0.resolucion = GuionFuentes.resolucion(0, estado: .notFound) }
        let (sesion, entorno, _, _) = try preparar(servidor)
        await sesion.entrarPartido(try partido())
        XCTAssertEqual(sesion.fase, .noEncontrado)
        XCTAssertTrue(sesion.resolverAbierto)
        XCTAssertEqual(entorno.hojas.actual, .encontrarCanal)
        XCTAssertEqual(sesion.tituloResolver, "M+ Liga de Campeones")
    }

    @MainActor
    func testUnErrorDeRedAlResolverEsComoNoEncontrado() async throws {
        let servidor = ServidorFuentes()
        servidor.estado.withLock { $0.falloResolver = true }
        let (sesion, _, _, _) = try preparar(servidor)
        await sesion.entrarPartido(try partido())
        XCTAssertEqual(sesion.fase, .noEncontrado)
        XCTAssertEqual(sesion.resolucion?.engineAvailable, false)
        XCTAssertEqual(sesion.resolucion?.checked, ["saved", "m3u", "library", "acestream"])
    }

    @MainActor
    func testSinComprobadorReproduceLaMejor() async throws {
        let servidor = ServidorFuentes()
        servidor.estado.withLock { $0.resolucion = GuionFuentes.resolucion(2, conComprobador: false) }
        let (sesion, entorno, _, _) = try preparar(servidor)
        await sesion.entrarPartido(try partido())
        XCTAssertEqual(entorno.reproductor.canal?.id, GuionFuentes.hash(1))
        XCTAssertEqual(entorno.reproductor.origen, .usuario)
        XCTAssertFalse(sesion.automatico)
        XCTAssertEqual(sesion.textoProgreso(ahora: Date()), "2 fuentes disponibles")
    }

    @MainActor
    func testMientrasCompruebaDiceLaEsperaYConFlojaAlTerminar() async throws {
        let servidor = ServidorFuentes()
        servidor.estado.withLock { $0.trabajo = GuionFuentes.trabajo([.failed, .checking, .queued], estado: .running) }
        let (sesion, entorno, _, _) = try preparar(servidor)
        await sesion.entrarPartido(try partido())
        await esperarHasta("Espera con progreso", plazo: 5) { sesion.textoEspera == "Comprobando fuentes… 1/3" }
        XCTAssertEqual(entorno.reproductor.espera, "Comprobando fuentes… 1/3")
        XCTAssertNil(entorno.reproductor.canal)
        XCTAssertEqual(EstadoVisible.mensajeEscenario(entorno.reproductor.foto)?.titulo, "Buscando señal")
        // Solo se ven la viva o las iniciales sin probar (regla 22): la fallida va plegada.
        XCTAssertEqual(sesion.plegadas.map(\.id), [GuionFuentes.hash(1)])

        servidor.estado.withLock { $0.trabajo = GuionFuentes.trabajo([.failed, .weak, .failed], estado: .complete) }
        await esperarHasta("Arranca la floja al terminar", plazo: 5) {
            entorno.reproductor.canal?.id == GuionFuentes.hash(2)
        }
        XCTAssertTrue(entorno.textos.contains("Ninguna verificada del todo; probamos la fuente 2, que da señal floja"))
        XCTAssertEqual(entorno.reproductor.canal?.lead, "Fuente 2, señal floja.")
    }

    @MainActor
    func testTerminadoSinNingunaVivaDejaElTextoDeFallo() async throws {
        let servidor = ServidorFuentes()
        servidor.estado.withLock { $0.trabajo = GuionFuentes.trabajo([.failed, .failed, .failed], estado: .complete) }
        let (sesion, entorno, _, _) = try preparar(servidor)
        await sesion.entrarPartido(try partido())
        let texto = "Ninguna de las 3 fuentes da señal ahora mismo. Prueba \"Rebuscar\" o pega un Content ID."
        await esperarHasta("Texto de fallo", plazo: 5) { sesion.textoFallo == texto }
        XCTAssertFalse(sesion.automatico)
        XCTAssertNil(entorno.reproductor.canal)
    }

    @MainActor
    func testEnReposoDiceCuandoVuelveAProbar() async throws {
        let servidor = ServidorFuentes()
        servidor.estado.withLock {
            $0.trabajo = GuionFuentes.trabajo(
                [.failed, .failed], estado: .waiting, reintento: "2026-09-23T19:36:00.000Z")
            $0.resolucion = GuionFuentes.resolucion(2)
        }
        let (sesion, _, _, _) = try preparar(servidor)
        await sesion.entrarPartido(try partido())
        await esperarHasta("Espera con la hora de Madrid", plazo: 5) {
            sesion.textoEspera
                == "Ninguna de las 2 fuentes da señal todavía. Las vuelvo a probar a las 21:36 y arranco la primera que responda."
        }
        XCTAssertTrue(sesion.automatico, "Sigue esperando")
    }

    @MainActor
    func testTresFallosDelComprobadorEnseñanTodasYArrancaLaMejor() async throws {
        let servidor = ServidorFuentes()
        servidor.estado.withLock { $0.falloComprobador = true }
        let (sesion, entorno, _, _) = try preparar(servidor)
        await sesion.entrarPartido(try partido())
        await esperarHasta("Se rinde con el comprobador", plazo: 5) { sesion.comprobador == nil }
        XCTAssertTrue(entorno.textos.contains("El comprobador no responde; se muestran todas las fuentes"))
        XCTAssertEqual(entorno.reproductor.canal?.id, GuionFuentes.hash(1))
        XCTAssertEqual(sesion.visibles.count, 3)
    }

    @MainActor
    func testConElSSEAbiertoNoSondeaYElProgresoPideElTrabajo() async throws {
        let servidor = ServidorFuentes()
        servidor.estado.withLock { $0.trabajo = GuionFuentes.trabajo([.checking, .queued, .queued], estado: .running) }
        let (sesion, entorno, _, _) = try preparar(servidor)
        entorno.tiempoRealAbierto = true
        await sesion.entrarPartido(try partido())
        let consultas = { MockURLProtocol.peticiones.filter { $0.url?.path().contains("/football/scans/") == true }.count }
        await esperarHasta("La primera consulta", plazo: 5) { consultas() == 1 }
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(consultas(), 1, "Con el SSE abierto no hay sondeo")

        // Un veredicto por SSE cambia la fuente al momento y arranca.
        let veredicto = ScanVerdictData(
            jobId: GuionFuentes.trabajoId, hash: GuionFuentes.hash(2), state: .working, reason: "playable_media",
            by: .scanner, checkedAt: "2026-09-23T18:31:00.000Z", playableOn: PlayableOn(web: true, ios: true))
        sesion.procesar(.scanVerdict(veredicto))
        XCTAssertEqual(entorno.reproductor.canal?.id, GuionFuentes.hash(2))
        await esperarHasta("Y pide el trabajo entero", plazo: 5) { consultas() == 2 }
    }

    // MARK: Política de cambio de fuente

    @MainActor
    func testEnAutomaticoAlAgotarLaFuentePasaALaSiguiente() async throws {
        let (sesion, entorno, motor, servicio) = try preparar()
        await sesion.entrarPartido(try partido())
        await primeraImagen(entorno, motor)
        XCTAssertEqual(sesion.entradas[0].veredicto?.motivo, "player_ok")

        await agotar(entorno, motor, servicio: servicio)

        XCTAssertEqual(entorno.reproductor.canal?.id, GuionFuentes.hash(2), "Suena la siguiente verificada")
        XCTAssertEqual(entorno.reproductor.origen, .automatico)
        XCTAssertEqual(entorno.reproductor.mensaje, "Esta fuente no responde: probando la siguiente…")
        XCTAssertEqual(entorno.haptica.pulso.tipo, .aviso)
        XCTAssertTrue(sesion.automatico)
        XCTAssertEqual(sesion.activa, GuionFuentes.hash(2))
        XCTAssertEqual(sesion.entradas[0].veredicto?.motivo, "player_failed")
        XCTAssertTrue(sesion.entradas[1].probadaAuto)
    }

    @MainActor
    func testUnaFuenteAutomaticaQueNoArrancaSoloTieneUnaReconexion() async throws {
        let (sesion, entorno, motor, servicio) = try preparar()
        await sesion.entrarPartido(try partido())
        await esperarHasta("Concedida", plazo: 5) { entorno.reproductor.conexion == .conectando }
        await agotar(entorno, motor, servicio: servicio)
        await esperarHasta("Pide la siguiente", plazo: 5) { servicio.foto.streams.count == 3 }
        XCTAssertEqual(servicio.foto.streams, [GuionFuentes.hash(1), GuionFuentes.hash(1), GuionFuentes.hash(2)])
        XCTAssertEqual(sesion.activa, GuionFuentes.hash(2))
    }

    @MainActor
    func testEnManualNuncaSeSaltaSolaYDiceCuantasQuedan() async throws {
        let (sesion, entorno, motor, servicio) = try preparar()
        await sesion.entrarPartido(try partido())
        await esperarHasta("Arranca sola", plazo: 5) { entorno.reproductor.canal != nil }

        sesion.elegir(GuionFuentes.hash(3))
        XCTAssertFalse(sesion.automatico)
        XCTAssertTrue(sesion.eleccionManual)
        XCTAssertEqual(entorno.reproductor.canal?.id, GuionFuentes.hash(3))
        XCTAssertTrue(entorno.textos.contains("M3U · Norte · \(GuionFuentes.hash(3).prefix(10))"))
        await primeraImagen(entorno, motor)
        await agotar(entorno, motor, servicio: servicio)

        XCTAssertEqual(entorno.reproductor.fase, .error)
        XCTAssertEqual(entorno.reproductor.canal?.id, GuionFuentes.hash(3), "En manual no se cambia de fuente")
        XCTAssertEqual(entorno.haptica.pulso.tipo, .error)
        XCTAssertEqual(
            entorno.reproductor.mensaje,
            "Esta señal no responde. Tienes 2 fuentes más para este partido: prueba otra en el selector.")
    }

    @MainActor
    func testElegirLaQueYaSuenaNoHaceNadaYPasoDaLaVuelta() async throws {
        let (sesion, entorno, _, servicio) = try preparar()
        await sesion.entrarPartido(try partido())
        await esperarHasta("Arranca sola", plazo: 5) { entorno.reproductor.canal != nil }
        sesion.elegir(GuionFuentes.hash(1))
        XCTAssertTrue(sesion.automatico, "Pulsar la activa mientras suena no hace nada")
        XCTAssertEqual(servicio.foto.streams.count, 1)
        sesion.paso(-1)
        XCTAssertEqual(entorno.reproductor.canal?.id, GuionFuentes.hash(3), "En bucle")
        sesion.paso(1)
        XCTAssertEqual(entorno.reproductor.canal?.id, GuionFuentes.hash(1))
    }

    @MainActor
    func testDetenerApagaElAutomatismoYLaListaSeQueda() async throws {
        let (sesion, entorno, motor, _) = try preparar()
        await sesion.entrarPartido(try partido())
        await primeraImagen(entorno, motor)
        entorno.reproductor.detener()
        XCTAssertTrue(sesion.detenida)
        XCTAssertFalse(sesion.automatico)
        XCTAssertEqual(sesion.entradas.count, 3)
        XCTAssertEqual(sesion.clave, "partido:m1")
        // Volver al partido detenido con fuentes no vuelve a resolver ni arranca nada.
        await sesion.entrarPartido(try partido())
        XCTAssertNil(entorno.reproductor.canal)
    }

    @MainActor
    func testSonarAlgoQueNoEsDeLaSesionLaTermina() async throws {
        let (sesion, entorno, motor, _) = try preparar()
        await sesion.entrarPartido(try partido())
        await primeraImagen(entorno, motor)
        entorno.reproductor.reproducir(CanalReproducible(id: GuionFuentes.hash(99), titulo: "Otro"), origen: .zapping)
        XCTAssertNil(sesion.clave)
        XCTAssertTrue(sesion.entradas.isEmpty)
    }

    @MainActor
    func testSalirSinNadaSonandoApagaElAutomatismo() async throws {
        let servidor = ServidorFuentes()
        servidor.estado.withLock { $0.trabajo = GuionFuentes.trabajo([.checking, .queued, .queued], estado: .running) }
        let (sesion, entorno, _, _) = try preparar(servidor)
        await sesion.entrarPartido(try partido())
        sesion.salirVista()
        XCTAssertFalse(sesion.automatico)
        XCTAssertNil(sesion.textoEspera)
        servidor.estado.withLock { $0.trabajo = GuionFuentes.trabajo([.working, .queued, .queued], estado: .running) }
        try await Task.sleep(for: .milliseconds(120))
        XCTAssertNil(entorno.reproductor.canal, "Con la persona en otra pantalla no arranca nada")
    }

    // MARK: Acciones

    @MainActor
    func testReportarApartaOfreceOtraYElSeguimientoLaDevuelve() async throws {
        let servidor = ServidorFuentes()
        let (sesion, entorno, _, _) = try preparar(servidor)
        await sesion.entrarPartido(try partido())
        await esperarHasta("Arranca sola", plazo: 5) { entorno.reproductor.canal != nil }
        servidor.estado.withLock {
            $0.trabajoReporte = GuionFuentes.trabajo(
                [.checking], estado: .running, id: GuionFuentes.reporteId, kind: .report)
        }

        try await sesion.reportar(GuionFuentes.hash(1), motivo: .notStarting)

        let reportada = sesion.entradas[0]
        XCTAssertTrue(ReglasFuentes.reportada(reportada, ahora: Date()))
        XCTAssertEqual(entorno.reproductor.canal?.id, GuionFuentes.hash(1), "Reportar no cambia de fuente")
        XCTAssertEqual(entorno.haptica.pulso.tipo, .exito)
        let toast = try XCTUnwrap(entorno.avisos.cola.toasts.last { $0.texto.hasPrefix("Fuente apartada") })
        XCTAssertEqual(toast.tituloAccion, "Ver la 2")

        // El segundo motor la da por viva y el motivo era «No arranca»: vuelve.
        servidor.estado.withLock {
            $0.trabajoReporte = GuionFuentes.trabajo(
                [.working], estado: .complete, id: GuionFuentes.reporteId, kind: .report)
        }
        await esperarHasta("Vuelve", plazo: 5) { !ReglasFuentes.reportada(sesion.entradas[0], ahora: Date()) }
        XCTAssertTrue(entorno.textos.contains("El segundo motor confirma que la fuente vuelve a funcionar"))
    }

    @MainActor
    func testConfirmarElCanalLoAprende() async throws {
        let (sesion, entorno, _, _) = try preparar()
        await sesion.entrarPartido(try partido())
        await sesion.confirmar(GuionFuentes.hash(2))
        XCTAssertEqual(sesion.entradas[1].aprendida, .correct)
        XCTAssertTrue(entorno.textos.contains("La asociación queda aprendida en el NAS"))
    }

    @MainActor
    func testPegarUnHashLoAñadeAlFinalYTodoPasaAManual() async throws {
        let (sesion, entorno, _, _) = try preparar()
        await sesion.entrarPartido(try partido())
        do {
            try await sesion.pegar("esto no es un hash")
            XCTFail("Un texto sin hash no se pega")
        } catch {
            XCTAssertEqual(error as? ErrorFuentes, .hashNoValido)
        }
        let nuevo = "acestream://" + GuionFuentes.hash(0xabc).uppercased()
        try await sesion.pegar(nuevo)
        let ultima = try XCTUnwrap(sesion.entradas.last)
        XCTAssertEqual(ultima.id, GuionFuentes.hash(0xabc))
        XCTAssertEqual(ultima.origen, "manual")
        XCTAssertNil(ultima.ih)
        XCTAssertTrue(sesion.eleccionManual)
        XCTAssertEqual(entorno.reproductor.canal?.id, ultima.id)
        XCTAssertEqual(entorno.reproductor.canal?.subtitulo, "Fuente 4, Externa")
        XCTAssertTrue(entorno.textos.contains("Hash externo añadido y reproduciendo"))
    }

    @MainActor
    func testElegirEnEncontrarCanalVinculaArmaElSaltoYSaltaSiFalla() async throws {
        let servidor = ServidorFuentes()
        var eleccion = GuionFuentes.resolucion(2)
        eleccion.status = .choices
        eleccion.candidate = nil
        let opciones = eleccion
        servidor.estado.withLock {
            $0.resolucion = opciones
            $0.trabajo = GuionFuentes.trabajo([.failed, .working], estado: .complete)
        }
        let (sesion, entorno, _, _) = try preparar(servidor)
        await sesion.entrarPartido(try partido())
        XCTAssertEqual(sesion.fase, .opciones)

        await sesion.elegirCandidata(GuionFuentes.candidata(1))

        XCTAssertTrue(MockURLProtocol.peticiones.contains { $0.url?.path().hasSuffix("/football/bindings") == true })
        XCTAssertEqual(sesion.fase, .lista)
        XCTAssertFalse(sesion.resolverAbierto)
        // La elegida sale fallida en el comprobador y no se ve: la primera viva (salto de entrada).
        await esperarHasta("Salto de entrada", plazo: 5) { entorno.reproductor.canal?.id == GuionFuentes.hash(2) }
        XCTAssertFalse(sesion.saltoArmado)
        XCTAssertTrue(
            entorno.textos.contains("La señal inicial no responde; probamos automáticamente la fuente 2"))
    }

    @MainActor
    func testVincularAMano() async throws {
        let servidor = ServidorFuentes()
        servidor.estado.withLock {
            $0.resolucion = GuionFuentes.resolucion(0, estado: .notFound)
            $0.falloVincular = true
        }
        let (sesion, entorno, _, _) = try preparar(servidor)
        await sesion.entrarPartido(try partido())
        do {
            try await sesion.vincularManual("x")
            XCTFail("Hash no válido")
        } catch {
            XCTAssertEqual((error as? ErrorFuentes)?.mensaje, ReglasFuentes.textoHashNoValido)
        }
        try await sesion.vincularManual(GuionFuentes.hash(7))
        XCTAssertEqual(entorno.reproductor.canal?.id, GuionFuentes.hash(7))
        XCTAssertEqual(sesion.entradas.last?.origen, "saved")
        XCTAssertTrue(entorno.textos.contains("El canal se reproduce, pero no pudimos recordar la asociación"))
    }

    @MainActor
    func testRebuscarSinCanalesAvisaYConNovedadesLasJunta() async throws {
        let servidor = ServidorFuentes()
        var rebuscada = GuionFuentes.resolucion(4)
        rebuscada.research = true
        let nueva = rebuscada
        servidor.estado.withLock { $0.rebusqueda = nueva }
        let (sesion, entorno, _, _) = try preparar(servidor)
        await sesion.rebuscar()
        XCTAssertTrue(entorno.textos.contains("Este partido todavía no tiene canales anunciados"))

        await sesion.entrarPartido(try partido())
        await esperarHasta("Arranca sola", plazo: 5) { entorno.reproductor.canal != nil }
        await sesion.rebuscar()
        XCTAssertEqual(sesion.entradas.count, 4)
        XCTAssertTrue(entorno.textos.contains("Rebúsqueda: 4 señales reunidas, 1 sin probar antes · comprobándolas…"))
        XCTAssertFalse(sesion.rebuscando)
        XCTAssertTrue(sesion.entradas[0].probadaAuto, "Conserva lo ya probado")
    }

    // MARK: Canal suelto

    @MainActor
    func testCanalSueltoConSusHermanasDeLaBiblioteca() async throws {
        let (sesion, entorno, motor, servicio) = try preparar()
        let json = #"{"web":[{"id":"\#(GuionFuentes.hash(1))","title":"DAZN 1","type":"web","category":"Deportes","date":"2026-09-23T18:30:00.000Z","fromWebSync":true,"ih":false},{"id":"\#(GuionFuentes.hash(2))","title":"DAZN 1 HD","type":"web","category":"Deportes","date":"2026-09-23T18:30:00.000Z","fromWebSync":true,"ih":false},{"id":"\#(GuionFuentes.hash(3))","title":"Movistar Plus+","type":"web","category":"Deportes","date":"2026-09-23T18:30:00.000Z","fromWebSync":true,"ih":false}],"webSyncedAt":null,"webSources":[{"id":"principal","name":"Directorio de Isma","url":"https://example.com/l.m3u","type":"m3u","count":3,"syncedAt":null,"lastErrorAt":null,"lastError":null}],"activeWebSourceId":"principal","favorites":[],"history":[]}"#
        entorno.datos.biblioteca.escribir(try JSONDecoder().decode(LibraryView.self, from: Data(json.utf8)))

        let canal = RefCanal(hash: GuionFuentes.hash(1), titulo: "DAZN 1", coleccion: .web, ih: false)
        await sesion.entrarCanal(canal, listaActiva: nil)

        XCTAssertEqual(sesion.clave, "canal:\(GuionFuentes.hash(1))")
        XCTAssertEqual(sesion.entradas.map(\.id), [GuionFuentes.hash(1), GuionFuentes.hash(2)], "Solo el mismo canal")
        XCTAssertEqual(sesion.entradas.first?.listaId, "principal")
        XCTAssertEqual(entorno.reproductor.canal?.id, GuionFuentes.hash(1), "Desde el inicio lo reproduce")
        XCTAssertEqual(entorno.reproductor.origen, .biblioteca)
        let filas = sesion.filas(ahora: Date())
        XCTAssertEqual(filas[0].presentacion.etiqueta, "M3U · Isma")

        // Elegir una hermana: «Fuente 2 de 2»; nunca salta sola.
        await primeraImagen(entorno, motor)
        sesion.elegir(GuionFuentes.hash(2))
        XCTAssertEqual(entorno.reproductor.canal?.subtitulo, "Fuente 2 de 2")
        XCTAssertEqual(sesion.clave, "canal:\(GuionFuentes.hash(1))", "Una hermana no abre otra sesión")
        await primeraImagen(entorno, motor)
        await agotar(entorno, motor, servicio: servicio)
        XCTAssertEqual(
            entorno.reproductor.mensaje,
            "Esta señal no responde. Tienes 1 fuente más para este canal: prueba otra en el selector.")

        // Tras «Detener», volver al canal no lo relanza.
        entorno.reproductor.detener()
        await sesion.entrarCanal(RefCanal(hash: GuionFuentes.hash(3), titulo: "Movistar Plus+"), listaActiva: nil)
        XCTAssertNil(entorno.reproductor.canal)
    }
}
