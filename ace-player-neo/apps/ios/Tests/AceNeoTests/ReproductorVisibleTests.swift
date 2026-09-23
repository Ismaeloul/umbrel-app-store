import AVFoundation
import UIKit
import XCTest

@testable import AceNeo

/// Controlador del PiP de mentira: apunta lo que se le pide.
@MainActor
final class ControladorPiPFalso: ControladorPiP {
    var activo = false
    var posible = true
    private(set) var empezados = 0
    private(set) var parados = 0

    func empezar() { empezados += 1 }
    func parar() { parados += 1 }
}

/// Los gestos del mini y del reproductor grande (decisiones puras).
final class GestosReproductorTests: XCTestCase {
    func testDeslizarHaciaArribaElMiniLoAbre() {
        XCTAssertEqual(GestosReproductor.alSoltarMini(traslacion: CGSize(width: 4, height: -60), prevista: .zero), .abrir)
        // Un golpe corto pero rápido hacia arriba también.
        XCTAssertEqual(
            GestosReproductor.alSoltarMini(
                traslacion: CGSize(width: 0, height: -14), prevista: CGSize(width: 0, height: -300)),
            .abrir)
    }

    func testDeslizarElMiniDeLadoLoDetiene() {
        XCTAssertEqual(GestosReproductor.alSoltarMini(traslacion: CGSize(width: -140, height: 10), prevista: .zero), .detener)
        XCTAssertEqual(
            GestosReproductor.alSoltarMini(
                traslacion: CGSize(width: 40, height: 0), prevista: CGSize(width: 400, height: 0)),
            .detener)
    }

    func testPocoRecorridoNoHaceNada() {
        XCTAssertEqual(GestosReproductor.alSoltarMini(traslacion: CGSize(width: 10, height: -10), prevista: .zero), .nada)
        XCTAssertEqual(GestosReproductor.alSoltarMini(traslacion: CGSize(width: 0, height: 30), prevista: .zero), .nada)
        XCTAssertEqual(GestosReproductor.alSoltarMini(traslacion: CGSize(width: 60, height: 5), prevista: .zero), .nada)
    }

    func testElMiniSigueAlDedoConResistenciaHaciaArriba() {
        let deLado = GestosReproductor.desplazamientoMini(CGSize(width: 80, height: 10))
        XCTAssertEqual(deLado, CGSize(width: 80, height: 0))
        let arriba = GestosReproductor.desplazamientoMini(CGSize(width: 0, height: -400))
        XCTAssertLessThan(arriba.height, 0)
        XCTAssertGreaterThan(arriba.height, -90, "Nunca más allá del tope")
        let abajo = GestosReproductor.desplazamientoMini(CGSize(width: 0, height: 200))
        XCTAssertLessThan(abajo.height, 14)
    }

    func testDeslizarHaciaAbajoElGrandeLoMinimiza() {
        let alto: CGFloat = 844
        XCTAssertTrue(GestosReproductor.alSoltarGrande(traslacion: 200, prevista: 220, alto: alto))
        XCTAssertTrue(GestosReproductor.alSoltarGrande(traslacion: 40, prevista: 600, alto: alto), "Con velocidad basta menos")
        XCTAssertFalse(GestosReproductor.alSoltarGrande(traslacion: 60, prevista: 90, alto: alto), "Vuelve a su sitio")
        XCTAssertFalse(GestosReproductor.alSoltarGrande(traslacion: -80, prevista: -200, alto: alto), "Hacia arriba no")
    }

    func testElGrandeBajaConElDedoYNoSube() {
        XCTAssertEqual(GestosReproductor.desplazamientoGrande(120), 120)
        let arriba = GestosReproductor.desplazamientoGrande(-300)
        XCTAssertLessThan(arriba, 0)
        XCTAssertGreaterThan(arriba, -18)
        XCTAssertEqual(GestosReproductor.progreso(422, alto: 844), 0.5, accuracy: 0.001)
        XCTAssertEqual(GestosReproductor.progreso(-10, alto: 844), 0)
        XCTAssertEqual(GestosReproductor.resistencia(0, tope: 90), 0)
    }
}

/// Mini, grande o nada: lo que decide el reproductor.
final class VistaReproductorTests: XCTestCase {
    private let canal = CanalReproducible(
        id: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", titulo: "BOING", ih: true, origen: "favorites")

    @MainActor
    func testDelMiniAlGrandeYVuelta() throws {
        let reproductor = Reproductor(
            motor: MotorFalso(), servicio: try ServicioFalso(), visor: "ios_prueba", automatico: false,
            esperar: { _ in })
        XCTAssertEqual(reproductor.vista, .ninguna)
        reproductor.expandir()
        XCTAssertEqual(reproductor.vista, .ninguna, "Sin nada sonando no hay reproductor que abrir")

        reproductor.reproducir(canal)
        XCTAssertEqual(reproductor.vista, .mini)
        reproductor.expandir()
        XCTAssertEqual(reproductor.vista, .grande)
        XCTAssertFalse(reproductor.visibleEnMini, "Con el grande abierto no hay mini")
        reproductor.minimizar()
        XCTAssertEqual(reproductor.vista, .mini, "Minimizado siempre se puede volver: el mini sigue ahí")
        reproductor.expandir()
        XCTAssertEqual(reproductor.vista, .grande)

        // Con el partido en pantalla, ni mini ni grande (salvo que se abra).
        reproductor.minimizar()
        reproductor.superficieGrande(visible: true)
        XCTAssertEqual(reproductor.vista, .ninguna)
        reproductor.superficieGrande(visible: false)

        reproductor.detener()
        XCTAssertEqual(reproductor.vista, .ninguna)
        XCTAssertFalse(reproductor.expandido)
    }
}

/// UNA sola capa de vídeo: va al hueco de más prioridad que esté en pantalla.
final class SuperficieUnicaTests: XCTestCase {
    @MainActor
    private func capas(en vista: UIView) -> Int {
        var total = vista.layer is AVPlayerLayer ? 1 : 0
        for hija in vista.subviews { total += capas(en: hija) }
        return total
    }

    @MainActor
    func testLaCapaVaAlHuecoDeMasPrioridadYNuncaHayDos() {
        let superficie = SuperficieVideo()
        let ventana = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        ventana.isHidden = false

        let mini = HuecoVideoUIView(frame: CGRect(x: 0, y: 700, width: 76, height: 44))
        mini.superficie = superficie
        mini.prioridad = .mini
        mini.gravedad = .resizeAspectFill
        ventana.addSubview(mini)
        XCTAssertTrue(superficie.huecoActual === mini)
        XCTAssertEqual(superficie.vista.capa.videoGravity, .resizeAspectFill)

        let integrado = HuecoVideoUIView(frame: CGRect(x: 0, y: 100, width: 390, height: 219))
        integrado.superficie = superficie
        integrado.prioridad = .integrado
        ventana.addSubview(integrado)
        XCTAssertTrue(superficie.huecoActual === integrado, "El del partido gana al mini")
        XCTAssertEqual(superficie.vista.frame, integrado.bounds)

        let grande = HuecoVideoUIView(frame: CGRect(x: 0, y: 60, width: 390, height: 219))
        grande.superficie = superficie
        grande.prioridad = .grande
        ventana.addSubview(grande)
        XCTAssertTrue(superficie.huecoActual === grande, "El reproductor grande manda")

        // Un hueco del partido que se vuelve a crear (p. ej. al cambiar de fuente) no le quita la capa al grande.
        let otroIntegrado = HuecoVideoUIView(frame: CGRect(x: 0, y: 100, width: 390, height: 219))
        otroIntegrado.superficie = superficie
        otroIntegrado.prioridad = .integrado
        ventana.addSubview(otroIntegrado)
        XCTAssertTrue(superficie.huecoActual === grande)
        XCTAssertEqual(capas(en: ventana), 1, "Nunca dos imágenes del vídeo a la vez")

        // Al cerrar el grande, vuelve al del partido (el último que llegó).
        grande.removeFromSuperview()
        XCTAssertTrue(superficie.huecoActual === otroIntegrado)
        otroIntegrado.removeFromSuperview()
        integrado.removeFromSuperview()
        XCTAssertTrue(superficie.huecoActual === mini)
        XCTAssertEqual(capas(en: ventana), 1)
        ventana.isHidden = true
    }

    func testElegirDesempataPorElUltimo() {
        XCTAssertNil(SuperficieVideo.elegir([]))
        XCTAssertEqual(SuperficieVideo.elegir([(.mini, 0), (.integrado, 1), (.mini, 2)]), 1)
        XCTAssertEqual(SuperficieVideo.elegir([(.integrado, 0), (.integrado, 1)]), 1)
        XCTAssertEqual(SuperficieVideo.elegir([(.grande, 0), (.integrado, 1)]), 0)
    }
}

/// El PiP con un controlador de mentira: la vuelta a la app nunca deja dos vídeos.
final class PiPTests: XCTestCase {
    private let canal = CanalReproducible(
        id: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", titulo: "BOING", ih: true, origen: "favorites")

    override func tearDown() {
        MockURLProtocol.limpiar()
        super.tearDown()
    }

    @MainActor
    private func preparar() throws -> (AppModel, GestorPiP, ControladorPiPFalso) {
        MockURLProtocol.responder { peticion in
            let (codigo, tipo, datos) = ServidorSimulado.respuesta(a: peticion)
            return (codigo, ["Content-Type": tipo], datos)
        }
        let configuracion = ServerConfigStore(suite: "es.ismaeloul.aceplayerneo.tests.pip.\(UUID().uuidString)")
        configuracion.guardar(ServerConfig(lan: Prueba.base))
        let cache = FileManager.default.temporaryDirectory
            .appendingPathComponent("AceNeoTests-pip-\(UUID().uuidString)", isDirectory: true)
        let entorno = Entorno(
            session: MockURLProtocol.sesion(), tokens: MemoryTokenStore(token: Prueba.token),
            configuracion: configuracion, cache: DiskCache(directorio: cache))
        let reproductor = Reproductor(
            motor: MotorFalso(), servicio: try ServicioFalso(), visor: "ios_prueba", automatico: false,
            esperar: { _ in })
        let falso = ControladorPiPFalso()
        let pip = GestorPiP(superficie: SuperficieVideo(), soportado: true, fabrica: { _, _ in falso })
        pip.prepararControlador()
        let app = AppModel(entorno: entorno, reproductor: reproductor, pip: pip)
        return (app, pip, falso)
    }

    @MainActor
    func testAlVolverALaAppConPiPSeCierraYElVideoVuelveAlReproductorGrande() async throws {
        let (app, pip, falso) = try preparar()
        app.reproductor.reproducir(canal)
        XCTAssertEqual(app.reproductor.vista, .mini)

        // Sale de la app: arranca el PiP automático (AVKit avisa antes de abrirlo).
        pip.simularInicio()
        falso.activo = true
        app.pasoASegundoPlano()
        XCTAssertTrue(pip.activo)

        // Vuelve a la app tocando su icono: se cierra el PiP…
        app.volvioAPrimerPlano()
        XCTAssertEqual(falso.parados, 1, "Al volver a la app, el PiP se cierra (nunca dos vídeos)")

        // …y AVKit pide restaurar la interfaz: se enseña el reproductor ANTES de devolver la imagen.
        var grandeAlCompletar: Bool?
        var completado: Bool?
        pip.simularRestaurar { ok in
            grandeAlCompletar = app.reproductor.expandido
            completado = ok
        }
        await esperarHasta("AVKit recibe el «sí» tras presentar el reproductor", plazo: 3) { completado != nil }
        XCTAssertEqual(completado, true)
        XCTAssertEqual(grandeAlCompletar, true, "El reproductor grande ya estaba abierto al devolver el vídeo")
        pip.simularFin()
        falso.activo = false
        XCTAssertFalse(pip.activo)
        XCTAssertEqual(app.reproductor.vista, .grande)
    }

    @MainActor
    func testConElPartidoEnPantallaElVideoVuelveAEseSitio() async throws {
        let (app, pip, _) = try preparar()
        app.reproductor.reproducir(canal)
        app.reproductor.superficieGrande(visible: true)
        pip.simularInicio()
        var completado: Bool?
        pip.simularRestaurar { completado = $0 }
        await esperarHasta("Restaura", plazo: 3) { completado != nil }
        XCTAssertEqual(completado, true)
        XCTAssertFalse(app.reproductor.expandido, "No hace falta abrir el grande: el partido ya se ve")
    }

    @MainActor
    func testAbrirElPiPDesdeElGrandeLoMinimiza() throws {
        let (app, pip, falso) = try preparar()
        app.reproductor.reproducir(canal)
        app.reproductor.expandir()
        pip.alternar()
        XCTAssertEqual(falso.empezados, 1)
        pip.simularInicio()
        XCTAssertEqual(app.reproductor.vista, .mini, "Con el vídeo en la ventanita se sigue usando la app")
        falso.activo = true
        pip.alternar()
        XCTAssertEqual(falso.parados, 1, "El mismo botón lo cierra")
    }

    @MainActor
    func testSinPiPLaCapaSueltaElReproductorParaQueSigaElAudio() throws {
        let player = AVPlayer()
        let falso = ControladorPiPFalso()
        let pip = GestorPiP(superficie: SuperficieVideo(), soportado: true, fabrica: { _, _ in falso })
        pip.conectar(player)
        XCTAssertTrue(pip.superficie.vista.capa.player === player)
        pip.pasoASegundoPlano()
        XCTAssertNil(pip.superficie.vista.capa.player, "Sin PiP, la capa suelta el vídeo y sigue el audio")
        pip.volvioAPrimerPlano()
        XCTAssertTrue(pip.superficie.vista.capa.player === player)
        XCTAssertEqual(falso.parados, 0, "Sin PiP abierto no hay nada que cerrar")

        // Si AVKit ya está abriendo el PiP al salir, la capa NO se suelta.
        pip.simularInicio()
        pip.pasoASegundoPlano()
        XCTAssertTrue(pip.superficie.vista.capa.player === player)
    }
}
