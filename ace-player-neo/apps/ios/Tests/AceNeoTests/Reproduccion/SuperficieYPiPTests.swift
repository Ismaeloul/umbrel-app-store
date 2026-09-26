import AVFoundation
import UIKit
import XCTest

@testable import AceNeo

/* La única capa de vídeo y su PiP (Player/SuperficieVideo.swift).

   Poda (fase 0.2, b-arquitectura §1.11): de ReproductorVisibleTests.swift. `SuperficieUnicaTests` pasa a
   las prioridades nuevas (`mini < teatro < inmersivo < vuelo`). De `PiPTests` queda lo que es del
   `GestorPiP`; lo que hacía `AppModel` al volver del PiP (abrir el reproductor grande, minimizar al
   empezar) es presentación y lo prueba `PresentacionReproductorTests` (M3). `GestosReproductorTests` y
   `VistaReproductorTests` se borraron con su código (los sustituyen Puros/Comunes/GestosTests y
   PresentacionReproductorTests). */

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

/// UNA sola capa de vídeo: va al hueco de más prioridad que esté en pantalla.
final class SuperficieUnicaTests: XCTestCase {
    @MainActor
    private func capas(en vista: UIView) -> Int {
        var total = vista.layer is AVPlayerLayer ? 1 : 0
        for hija in vista.subviews { total += capas(en: hija) }
        return total
    }

    @MainActor
    private func hueco(_ prioridad: PrioridadHueco, _ superficie: SuperficieVideo, y: CGFloat) -> HuecoVideoUIView {
        let hueco = HuecoVideoUIView(frame: CGRect(x: 0, y: y, width: 390, height: 219))
        hueco.superficie = superficie
        hueco.prioridad = prioridad
        return hueco
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

        let teatro = hueco(.teatro, superficie, y: 100)
        ventana.addSubview(teatro)
        XCTAssertTrue(superficie.huecoActual === teatro, "El del teatro gana al mini")
        XCTAssertEqual(superficie.vista.frame, teatro.bounds)

        let inmersivo = hueco(.inmersivo, superficie, y: 60)
        ventana.addSubview(inmersivo)
        XCTAssertTrue(superficie.huecoActual === inmersivo, "El inmersivo gana al teatro")

        // Un hueco del teatro que se vuelve a crear (p. ej. al cambiar de fuente) no le quita la capa al inmersivo.
        let otroTeatro = hueco(.teatro, superficie, y: 100)
        ventana.addSubview(otroTeatro)
        XCTAssertTrue(superficie.huecoActual === inmersivo)
        XCTAssertEqual(capas(en: ventana), 1, "Nunca dos imágenes del vídeo a la vez")

        // El vuelo (escenario → mini) gana a todos mientras dura.
        let vuelo = hueco(.vuelo, superficie, y: 300)
        ventana.addSubview(vuelo)
        XCTAssertTrue(superficie.huecoActual === vuelo, "El vuelo gana a todo")
        vuelo.removeFromSuperview()
        XCTAssertTrue(superficie.huecoActual === inmersivo)

        // Al cerrar el inmersivo, vuelve al del teatro (el último que llegó).
        inmersivo.removeFromSuperview()
        XCTAssertTrue(superficie.huecoActual === otroTeatro)
        otroTeatro.removeFromSuperview()
        teatro.removeFromSuperview()
        XCTAssertTrue(superficie.huecoActual === mini)
        XCTAssertEqual(capas(en: ventana), 1)
        ventana.isHidden = true
    }

    func testElegirDesempataPorElUltimo() {
        XCTAssertNil(SuperficieVideo.elegir([]))
        XCTAssertEqual(SuperficieVideo.elegir([(.mini, 0), (.teatro, 1), (.mini, 2)]), 1)
        XCTAssertEqual(SuperficieVideo.elegir([(.teatro, 0), (.teatro, 1)]), 1)
        XCTAssertEqual(SuperficieVideo.elegir([(.inmersivo, 0), (.teatro, 1)]), 0)
        XCTAssertEqual(SuperficieVideo.elegir([(.inmersivo, 0), (.vuelo, 1), (.mini, 2)]), 1)
    }

    func testOrdenDeLasPrioridades() {
        XCTAssertEqual(PrioridadHueco.allCasesOrdenados, [.mini, .teatro, .inmersivo, .vuelo])
    }
}

extension PrioridadHueco {
    /// Las cuatro, ordenadas con `<` (para la prueba del orden).
    fileprivate static var allCasesOrdenados: [PrioridadHueco] {
        [PrioridadHueco.vuelo, .mini, .inmersivo, .teatro].sorted()
    }
}

/// Apunta lo que avisa el gestor (aislado en el actor principal: se puede capturar en sus cierres).
@MainActor
private final class Apunte {
    var ensenado = false
    var empezados = 0
}

/// El PiP con un controlador de mentira: la vuelta a la app nunca deja dos vídeos.
final class PiPTests: XCTestCase {
    @MainActor
    private func preparar() -> (GestorPiP, ControladorPiPFalso) {
        let falso = ControladorPiPFalso()
        let pip = GestorPiP(superficie: SuperficieVideo(), soportado: true, fabrica: { _, _ in falso })
        pip.prepararControlador()
        return (pip, falso)
    }

    @MainActor
    func testAlVolverALaAppConPiPSeCierraYAVKitEsperaAQueSeEnseneElReproductor() async {
        let (pip, falso) = preparar()
        let apunte = Apunte()
        pip.alRestaurar = { apunte.ensenado = true }

        // Sale de la app: arranca el PiP automático (AVKit avisa antes de abrirlo).
        pip.simularInicio()
        falso.activo = true
        pip.pasoASegundoPlano()
        XCTAssertTrue(pip.activo)

        // Vuelve a la app tocando su icono: se cierra el PiP (nunca dos vídeos).
        pip.volvioAPrimerPlano()
        XCTAssertEqual(falso.parados, 1, "Al volver a la app, el PiP se cierra (nunca dos vídeos)")

        // …y AVKit pide restaurar la interfaz: primero se enseña el reproductor, luego se devuelve la imagen.
        var ensenadoAlCompletar: Bool?
        var completado: Bool?
        pip.simularRestaurar { ok in
            ensenadoAlCompletar = apunte.ensenado
            completado = ok
        }
        await esperarHasta("AVKit recibe el «sí» tras enseñar el reproductor", plazo: 3) { completado != nil }
        XCTAssertEqual(completado, true)
        XCTAssertEqual(ensenadoAlCompletar, true, "El reproductor ya estaba enseñado al devolver el vídeo")
        pip.simularFin()
        falso.activo = false
        XCTAssertFalse(pip.activo)
    }

    /// Si al entrar en primer plano iOS aún no hace caso a «parar», se vuelve a pedir al activarse la escena (una
    /// vez); sin PiP abierto al volver, activarse no toca nada.
    @MainActor
    func testElPiPSeVuelveACerrarAlActivarseLaEscena() {
        let (pip, falso) = preparar()
        pip.simularInicio()
        falso.activo = true
        pip.pasoASegundoPlano()
        pip.volvioAPrimerPlano()
        XCTAssertEqual(falso.parados, 1)
        pip.seActivoLaEscena()
        XCTAssertEqual(falso.parados, 2, "Al activarse la escena se vuelve a cerrar")
        pip.seActivoLaEscena()
        XCTAssertEqual(falso.parados, 2, "Solo una vez por vuelta")
        pip.simularFin()
        falso.activo = false
        pip.pasoASegundoPlano()
        pip.volvioAPrimerPlano()
        pip.seActivoLaEscena()
        XCTAssertEqual(falso.parados, 2, "Sin PiP abierto no hay nada que cerrar")
    }

    @MainActor
    func testSinQuienEnseneElReproductorRestaurarDiceQueSi() async {
        let (pip, _) = preparar()
        pip.simularInicio()
        var completado: Bool?
        pip.simularRestaurar { completado = $0 }
        await esperarHasta("Restaura", plazo: 3) { completado != nil }
        XCTAssertEqual(completado, true)
    }

    @MainActor
    func testElMismoBotonAbreYCierraElPiPYAvisaAlEmpezar() {
        let (pip, falso) = preparar()
        let apunte = Apunte()
        pip.alEmpezar = { apunte.empezados += 1 }
        pip.alternar()
        XCTAssertEqual(falso.empezados, 1)
        pip.simularInicio()
        XCTAssertEqual(apunte.empezados, 1, "Avisa al abrirse (la presentación minimiza el teatro)")
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
