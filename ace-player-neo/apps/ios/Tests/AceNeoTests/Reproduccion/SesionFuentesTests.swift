import XCTest

@testable import AceNeo

/// Lo que la sesión de fuentes necesita de la app, con piezas de verdad (doble de `ContenedorApp`).
@MainActor
private final class EntornoFuentesDePrueba: EntornoSesionFuentes {
    let api: APIClient
    let reproductor: Reproductor
    let avisos = Avisos()
    let haptica = Haptica()
    let hojas = CentroHojas()
    let reloj: any Reloj = RelojSistema()
    var visor: String { reproductor.visor }
    var tiempoRealAbierto: Bool { false }

    init(api: APIClient, reproductor: Reproductor) {
        self.api = api
        self.reproductor = reproductor
    }
}

/// Política única de cambio de fuente de la sesión de fuentes (el `session.ts`
/// de la web) con el reproductor de verdad, un AVPlayer simulado y el API por
/// `URLProtocol` (las respuestas del servidor simulado: la fuente A
/// verificada y la B floja):
///
/// - automático: arranca sola la verificada y, agotadas las 3 reconexiones,
///   pasa a la siguiente sin que nadie toque nada;
/// - manual (la persona eligió): nunca se salta sola y se le pide otra.
///
/// Poda (fase 0.2): era `CentroPartidoTests` con `AppModel`; ahora con `EntornoSesionFuentes`.
/// Fase 0.3b: prueba `SesionFuentesPartido` (lo rescatado, referencia de M3); el contrato
/// `SesionFuentes` de §2.6 lo prueba M3 cuando porte session.ts.
final class SesionFuentesTests: XCTestCase {
    private let fuenteA = ServidorSimulado.fuenteA
    private let fuenteB = ServidorSimulado.fuenteB

    private let partidoJSON =
        #"{"id":"sim-1","date":"2026-09-23","time":"18:30","title":"Equipo Local - Equipo Visitante","home":"Equipo Local","away":"Equipo Visitante","competition":"LaLiga","country":"Spain","channels":[{"id":"m-laliga","name":"M+ LaLiga"}]}"#

    /// La sesión guarda su entorno `unowned` (como hacía con `AppModel`): la prueba lo retiene.
    private var retenidos: [AnyObject] = []

    override func tearDown() {
        MockURLProtocol.limpiar()
        super.tearDown()
    }

    @MainActor
    private func preparar() throws -> (EntornoFuentesDePrueba, MotorFalso, SesionFuentesPartido) {
        MockURLProtocol.responder { peticion in
            let (codigo, tipo, datos) = ServidorSimulado.respuesta(a: peticion)
            return (codigo, ["Content-Type": tipo], datos)
        }
        let configuracion = ServerConfigStore(suite: "es.ismaeloul.aceplayerneo.tests.centro.\(UUID().uuidString)")
        configuracion.guardar(ServerConfig(lan: Prueba.base))
        let cache = FileManager.default.temporaryDirectory
            .appendingPathComponent("AceNeoTests-centro-\(UUID().uuidString)", isDirectory: true)
        let entorno = Entorno(
            session: MockURLProtocol.sesion(), tokens: MemoryTokenStore(token: Prueba.token),
            configuracion: configuracion, cache: DiskCache(directorio: cache))
        let motor = MotorFalso()
        // Sin vigilante ni latido automáticos y sin esperar entre reconexiones.
        let reproductor = Reproductor(
            motor: motor, servicio: ServicioReproduccionAPI(api: entorno.api), visor: "ios_prueba",
            automatico: false, esperar: { _ in })
        let app = EntornoFuentesDePrueba(api: entorno.api, reproductor: reproductor)
        retenidos.append(app)
        let partido = try JSONDecoder().decode(FootballMatch.self, from: Data(partidoJSON.utf8))
        return (app, motor, SesionFuentesPartido(partido: partido, entorno: app))
    }

    /// Peticiones de vídeo (`channels/<id>/stream`) de una fuente.
    private func streams(de id: String) -> Int {
        MockURLProtocol.peticiones.filter {
            let ruta = $0.url?.path() ?? ""
            return ruta.hasSuffix("/stream") && ruta.contains(id)
        }.count
    }

    /// Primera imagen de la fuente que se está conectando.
    @MainActor
    private func primeraImagen(_ app: EntornoFuentesDePrueba, _ motor: MotorFalso) {
        motor.emitir(.listo)
        motor.emitir(.estado(.reproduciendo))
        motor.emitir(.primerFotograma)
        XCTAssertEqual(app.reproductor.conexion, .activa)
    }

    /// Tres caídas con su reconexión y una cuarta que ya agota la fuente.
    @MainActor
    private func agotar(_ id: String, _ app: EntornoFuentesDePrueba, _ motor: MotorFalso) async {
        let antes = streams(de: id)
        for n in 1...3 {
            motor.emitir(.fallo("corte de red"))
            await esperarHasta("Reconexión \(n) de \(id.prefix(6))", plazo: 5) {
                app.reproductor.conexion == .conectando && self.streams(de: id) == antes + n
            }
        }
        motor.emitir(.fallo("corte de red"))
    }

    @MainActor
    func testEnAutomaticoArrancaLaVerificadaYAlAgotarlaPasaALaSiguiente() async throws {
        let (app, motor, centro) = try preparar()
        centro.vista(abierta: true)
        await centro.cargar()
        XCTAssertEqual(centro.entradas.map(\.id), [fuenteA, fuenteB])

        // El comprobador (primer sondeo) marca A verificada: arranca sola.
        await esperarHasta("Arranca sola la verificada", plazo: 5) {
            app.reproductor.canal?.id == self.fuenteA && app.reproductor.conexion == .conectando
        }
        XCTAssertTrue(centro.automatico)
        XCTAssertTrue(centro.suenaAqui)
        primeraImagen(app, motor)

        await agotar(fuenteA, app, motor)

        // Nadie ha tocado nada: suena la siguiente (la floja, con el comprobador terminado).
        await esperarHasta("Pasa a la siguiente fuente", plazo: 5) {
            app.reproductor.canal?.id == self.fuenteB && app.reproductor.conexion == .conectando
        }
        XCTAssertEqual(streams(de: fuenteB), 1)
        XCTAssertTrue(centro.automatico, "Sigue en automático")
        let primera = try XCTUnwrap(centro.entradas.first { $0.id == fuenteA })
        XCTAssertTrue(primera.probadaAuto, "A no se vuelve a probar sola")
        XCTAssertNotNil(primera.veredicto, "Queda anotado lo que vio el reproductor con A")
        XCTAssertEqual(app.reproductor.errores, 1)

        // B arranca con normalidad.
        primeraImagen(app, motor)
        XCTAssertEqual(app.reproductor.fase, .reproduciendo)
        app.reproductor.detener()
    }

    @MainActor
    func testEnManualNuncaSeSaltaSolaYPideOtra() async throws {
        let (app, motor, centro) = try preparar()
        centro.vista(abierta: true)
        await centro.cargar()
        await esperarHasta("Arranca sola la verificada", plazo: 5) {
            app.reproductor.canal?.id == self.fuenteA && app.reproductor.conexion == .conectando
        }

        // La persona elige B: desde aquí todo es manual.
        let elegida = try XCTUnwrap(centro.entradas.first { $0.id == fuenteB })
        centro.elegir(elegida)
        XCTAssertFalse(centro.automatico)
        await esperarHasta("Pide la elegida", plazo: 5) {
            app.reproductor.canal?.id == self.fuenteB && app.reproductor.conexion == .conectando
        }
        primeraImagen(app, motor)

        await agotar(fuenteB, app, motor)

        await esperarHasta("Se rinde con la elegida", plazo: 5) { app.reproductor.fase == .error }
        XCTAssertEqual(app.reproductor.canal?.id, fuenteB, "En manual no se cambia de fuente")
        XCTAssertEqual(streams(de: fuenteB), 4, "La primera y las tres reconexiones, ni una más")
        XCTAssertEqual(app.reproductor.motivoParada, .fallo)
        XCTAssertEqual(app.reproductor.mensaje, "Esta fuente no responde. Prueba con otra.")
        let entrada = try XCTUnwrap(centro.entradas.first { $0.id == fuenteB })
        XCTAssertNotNil(entrada.veredicto, "El fallo queda anotado en la fuente")
        app.reproductor.detener()
    }
}
