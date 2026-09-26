import XCTest

@testable import AceNeo

/// Cómo se enseña el reproductor (player/PlayerSurface.tsx, a4 §5.3 y §5.7): autoocultado de 3,2 s solo
/// reproduciendo y nunca con VoiceOver, el toque que alterna, dónde va el vídeo, el corte a negro al cambiar de
/// fuente, las 14 opciones del menú y el PiP en demo.
final class PresentacionReproductorTests: XCTestCase {
    private let canalA = CanalReproducible(id: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", titulo: "DAZN 1", ih: false)
    private let canalB = CanalReproducible(id: "b2c3d4e5f60718293a4b5c6d7e8f901234567890", titulo: "M+ LaLiga", ih: false)

    @MainActor
    private func preparar() throws -> (PresentacionReproductor, Reproductor, MotorFalso) {
        let motor = MotorFalso()
        let reproductor = Reproductor(
            motor: motor, servicio: try ServicioFalso(), visor: "v_pruebaPrueba01", automatico: false,
            esperar: { _ in })
        reproductor.demo = false
        let presentacion = PresentacionReproductor(
            reproductor: reproductor, pip: GestorPiP(soportado: true) { _, _ in ControladorPiPFalso() })
        presentacion.ocultarTras = .milliseconds(60)
        return (presentacion, reproductor, motor)
    }

    @MainActor
    private func sonando(_ reproductor: Reproductor, _ motor: MotorFalso, _ canal: CanalReproducible? = nil) async {
        reproductor.reproducir(canal ?? canalA)
        await esperarHasta("Concedida") { reproductor.conexion == .conectando }
        motor.emitir(.listo)
        motor.emitir(.estado(.reproduciendo))
        motor.emitir(.primerFotograma)
        XCTAssertEqual(reproductor.fase, .reproduciendo)
    }

    @MainActor
    func testLosControlesSeEsconden32SegundosDespuesSoloReproduciendo() async throws {
        let (presentacion, reproductor, motor) = try preparar()
        XCTAssertTrue(presentacion.controlesALaVista)
        reproductor.reproducir(canalA)
        presentacion.interaccionConControles()
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertTrue(presentacion.controlesALaVista, "Conectando se ven siempre")

        await sonando(reproductor, motor)
        await esperarHasta("Se esconden al vencer el plazo") { !presentacion.controlesALaVista }

        // En pausa se ven siempre.
        reproductor.pausar()
        XCTAssertTrue(presentacion.controlesALaVista)
    }

    @MainActor
    func testConVoiceOverNuncaSeEsconden() async throws {
        let (presentacion, reproductor, motor) = try preparar()
        presentacion.voiceOverActivo = true
        await sonando(reproductor, motor)
        presentacion.interaccionConControles()
        presentacion.tocarVideo()
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertTrue(presentacion.controlesALaVista)
    }

    @MainActor
    func testConElMenuAbiertoNoSeEsconden() async throws {
        let (presentacion, reproductor, motor) = try preparar()
        await sonando(reproductor, motor)
        presentacion.menuAbierto = true
        presentacion.interaccionConControles()
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertTrue(presentacion.controlesALaVista)
        presentacion.menuAbierto = false
        await esperarHasta("Al cerrarlo, el siguiente plazo los esconde") { !presentacion.controlesALaVista }
    }

    @MainActor
    func testUnToqueEscondeSiSeVenYSuenaYSiNoLosEnseña() async throws {
        let (presentacion, reproductor, motor) = try preparar()
        await sonando(reproductor, motor)
        presentacion.interaccionConControles()
        presentacion.tocarVideo()
        XCTAssertFalse(presentacion.controlesALaVista)
        presentacion.tocarVideo()
        XCTAssertTrue(presentacion.controlesALaVista)
    }

    @MainActor
    func testDondeVaElVideoYCuandoSeVeElMini() async throws {
        let (presentacion, reproductor, motor) = try preparar()
        XCTAssertEqual(presentacion.lugar(teatroVisible: false, inmersivo: false, volando: false), .ninguno)
        await sonando(reproductor, motor)
        XCTAssertEqual(presentacion.lugar(teatroVisible: false, inmersivo: false, volando: false), .mini)
        XCTAssertEqual(presentacion.lugar(teatroVisible: true, inmersivo: false, volando: false), .teatro)
        XCTAssertEqual(presentacion.lugar(teatroVisible: true, inmersivo: true, volando: false), .inmersivo)
        XCTAssertEqual(presentacion.lugar(teatroVisible: true, inmersivo: true, volando: true), .vuelo)
        XCTAssertTrue(presentacion.miniVisible(teatroVisible: false, inmersivo: false))
        XCTAssertFalse(presentacion.miniVisible(teatroVisible: true, inmersivo: false))
        reproductor.detener()
        XCTAssertFalse(presentacion.miniVisible(teatroVisible: false, inmersivo: false), "Tras detener, sin mini")
    }

    @MainActor
    func testCorteANegroSoloAlPasarDeUnaFuenteAOtra() async throws {
        let (presentacion, reproductor, _) = try preparar()
        reproductor.reproducir(canalA)
        XCTAssertEqual(presentacion.cortes, 0, "La primera fuente no corta")
        reproductor.reproducir(canalB)
        XCTAssertEqual(presentacion.cortes, 1)
        reproductor.detener()
        reproductor.reproducir(canalA)
        XCTAssertEqual(presentacion.cortes, 1, "Tras detener no hay corte")
    }

    @MainActor
    func testLasOpcionesDelMenuSalenDelEstado() async throws {
        let (presentacion, reproductor, motor) = try preparar()
        XCTAssertTrue(presentacion.opciones.isEmpty, "Sin canal no hay menú")
        await sonando(reproductor, motor)
        let ids = presentacion.opciones.map(\.id)
        XCTAssertEqual(
            ids, ["pausa", "atras", "directo", "detener", "nerd", "donde", "completa", "pip", "abrir", "url", "enlace", "hash"])
        XCTAssertEqual(presentacion.opciones.first?.titulo, "Pausar")
        XCTAssertEqual(presentacion.opciones.first { $0.id == "atras" }?.deshabilitada, false)
        presentacion.abrirDatosTecnicos()
        XCTAssertEqual(presentacion.opciones.first { $0.id == "nerd" }?.marcada, true)
        reproductor.detener()
        XCTAssertFalse(presentacion.datosTecnicosAbiertos, "Detener cierra los datos técnicos")
    }

    @MainActor
    func testElPiPEnDemoAvisaYSinDemoAlterna() async throws {
        let (presentacion, reproductor, _) = try preparar()
        var avisos: [AvisoReproductor] = []
        reproductor.avisar = { avisos.append($0) }
        reproductor.demo = true
        presentacion.alternarPiP()
        XCTAssertEqual(avisos.last?.texto, "PiP necesita un vídeo real (en demo no hay señal)")
        reproductor.demo = false
        presentacion.pip.prepararControlador()
        presentacion.alternarPiP()
        XCTAssertEqual(avisos.count, 1, "Con PiP posible no avisa")
    }
}
