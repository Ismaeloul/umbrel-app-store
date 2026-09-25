import MediaPlayer
import XCTest

@testable import AceNeo

/// «Hecho cuando» de M3 (b-arquitectura §3.4) con las piezas de la demo: el servidor de la demo
/// (`ServidorDemo.entorno`), el motor simulado (`MotorSimulado`, señal a 1,8 s) y la sesión de fuentes de verdad.
/// El partido de la demo arranca solo, cambia de fuente al agotar la primera y la pantalla de bloqueo enseña el
/// título, el subtítulo y los mandos de la web. Vale con la demo provisional de hoy y con la de M2 (toma el primer
/// partido con canales de la agenda de la demo).
final class DemoReproduccionTests: XCTestCase {
    private var retenidos: [AnyObject] = []

    override func tearDown() {
        retenidos = []
        super.tearDown()
    }

    @MainActor
    func testElPartidoDeLaDemoArrancaSoloCambiaDeFuenteYLlegaALaPantallaDeBloqueo() async throws {
        let base = ServidorDemo.entorno(opciones: OpcionesSimulado())
        let agenda = try await base.api.enviar(API.agenda)
        let partido = try XCTUnwrap(
            agenda.days.flatMap(\.matches).first { !$0.channels.isEmpty }, "La demo tiene partidos con canal")

        let motor = MotorSimulado()
        let reproductor = Reproductor(
            motor: motor, servicio: ServicioReproduccionAPI(api: base.api), visor: IdentidadVisor.id(),
            automatico: false, esperar: { _ in })
        reproductor.demo = true
        let controles = ControlesSistema()
        controles.conectar(reproductor)
        let entorno = EntornoFuentesDePrueba(
            api: base.api, reproductor: reproductor, datos: DatosApp(api: base.api, cache: base.cache))
        let sesion = SesionFuentes()
        sesion.intervaloSondeo = .milliseconds(50)
        sesion.conectar(entorno)
        reproductor.alFallarFuente = { [weak sesion] fallo in sesion?.alFallarFuente(fallo) ?? false }
        retenidos += [entorno, sesion, controles]

        await sesion.entrarPartido(partido)

        // Arranca sola la primera verificada y, a los 1,8 s, hay «imagen».
        await esperarHasta("Arranca sola", plazo: 10) { reproductor.canal != nil }
        XCTAssertEqual(reproductor.origen, .automatico)
        let primera = try XCTUnwrap(reproductor.canal)
        await esperarHasta("Hay imagen", plazo: 10) { reproductor.fase == .reproduciendo }
        XCTAssertEqual(EstadoVisible.linea(reproductor.foto)?.dato, "demo")

        // Pantalla de bloqueo: título = canal, artista = «Fuente N, proveedor», álbum «Ace Player Neo».
        let info = try XCTUnwrap(MPNowPlayingInfoCenter.default().nowPlayingInfo)
        XCTAssertEqual(info[MPMediaItemPropertyTitle] as? String, primera.titulo)
        XCTAssertEqual(info[MPMediaItemPropertyArtist] as? String, primera.subtitulo)
        XCTAssertTrue(primera.subtitulo?.hasPrefix("Fuente 1, ") == true)
        XCTAssertEqual(info[MPMediaItemPropertyAlbumTitle] as? String, "Ace Player Neo")
        XCTAssertTrue(MPRemoteCommandCenter.shared().stopCommand.isEnabled)

        // La fuente se cae tres veces con imagen y una cuarta: la sesión pasa sola a la siguiente.
        for n in 1...3 {
            reproductor.fallar(TextosReproductor.senalCortada)
            await esperarHasta("Reconexión \(n)", plazo: 5) { reproductor.conexion == .conectando }
        }
        reproductor.fallar(TextosReproductor.senalCortada)
        let segunda = try XCTUnwrap(reproductor.canal)
        XCTAssertNotEqual(segunda.id, primera.id, "Cambia de fuente al agotar la primera")
        XCTAssertEqual(reproductor.origen, .automatico)
        XCTAssertEqual(reproductor.mensaje, "Esta fuente no responde: probando la siguiente…")
        await esperarHasta("La siguiente da imagen", plazo: 10) { reproductor.fase == .reproduciendo }

        reproductor.detener()
        XCTAssertNil(MPNowPlayingInfoCenter.default().nowPlayingInfo)
        XCTAssertTrue(sesion.detenida)
    }
}
