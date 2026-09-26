import XCTest

/// Flujos del mini (b-arquitectura §3.7, M6; MiniPlayer.tsx): minimizar desde el teatro (⌄ y arrastrando el vídeo
/// hacia abajo), tocar el mini abre el teatro, pausa, detener, y deslizarlo a un lado lo quita con «Deshacer».
final class FlujoMiniUITests: XCTestCase {
    private let canal = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    private func abrirCanal(tema: String = "oscuro", reducido: Bool = true) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-AceNeoDemo", "-AceNeoApariencia", tema, "-AceNeoEscena", "partido/canal/\(canal)",
        ] + (reducido ? ["-AceNeoMovimientoReducido"] : [])
        app.launch()
        XCTAssertTrue(elementoUI(app, IDUI.videoTeatro).waitForExistence(timeout: 20), "No se abre el teatro del canal")
        return app
    }

    @MainActor
    private func captura(_ app: XCUIApplication, _ nombre: String) {
        Thread.sleep(forTimeInterval: 1)
        let adjunto = XCTAttachment(screenshot: app.screenshot())
        adjunto.name = nombre
        adjunto.lifetime = .keepAlways
        add(adjunto)
    }

    @MainActor
    private func minimizar(_ app: XCUIApplication) {
        let boton = elementoUI(app, IDUI.botonMinimizar)
        if !boton.waitForExistence(timeout: 10) || !boton.isHittable { elementoUI(app, IDUI.videoTeatro).tap() }
        XCTAssertTrue(boton.waitForExistence(timeout: 5), "Sin ⌄ Minimizar")
        boton.tap()
        XCTAssertTrue(elementoUI(app, IDUI.miniPausa).waitForExistence(timeout: 10), "No aparece el mini")
    }

    @MainActor
    func testTocarAbreYMinimizarVuelve() throws {
        for tema in ["oscuro", "claro"] {
            let app = abrirCanal(tema: tema)
            minimizar(app)
            XCTAssertTrue(conTextoUI(app, "DAZN 1").exists, "El mini no dice el canal")
            captura(app, "mini-reproductor-\(tema)")
            app.buttons["Volver al vídeo: DAZN 1"].firstMatch.tap()
            XCTAssertTrue(elementoUI(app, IDUI.videoTeatro).waitForExistence(timeout: 10), "Tocar el mini no abre el teatro")
            XCTAssertTrue(esperarQueDesaparezca(elementoUI(app, IDUI.miniPausa), plazo: 5), "El mini sigue con el teatro")
            app.terminate()
        }
    }

    /// Se arrastra con el canal ya pedido y con imagen (el motor de la demo la da a los 1,8 s): antes, si el
    /// canal llegaba a mitad del arrastre, la capa de toques se recreaba y el gesto se perdía (fallaba a veces).
    @MainActor
    func testArrastrarElVideoAbajoMinimiza() throws {
        let app = abrirCanal()
        let video = elementoUI(app, IDUI.videoTeatro)
        XCTAssertTrue(video.waitForExistence(timeout: 10))
        let conCanal = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "Reproductor: DAZN 1")).firstMatch
        XCTAssertTrue(conCanal.waitForExistence(timeout: 15), "El canal no llega al escenario")
        Thread.sleep(forTimeInterval: 2.5)
        arrastrar(video, desde: CGVector(dx: 0.5, dy: 0.4), hasta: CGVector(dx: 0.5, dy: 2.6))
        XCTAssertTrue(elementoUI(app, IDUI.miniPausa).waitForExistence(timeout: 10), "Arrastrar hacia abajo no minimiza")
    }

    /// Con las animaciones: el vídeo vuela al mini con el muelle y el mini queda en su sitio; un arrastre corto
    /// (sin llegar al umbral) lo deja en el teatro.
    @MainActor
    func testArrastrarElVideoAbajoVuelaAlMiniConAnimacion() throws {
        let app = abrirCanal(reducido: false)
        let video = elementoUI(app, IDUI.videoTeatro)
        let conCanal = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "Reproductor: DAZN 1")).firstMatch
        XCTAssertTrue(conCanal.waitForExistence(timeout: 15), "El canal no llega al escenario")
        Thread.sleep(forTimeInterval: 2.5)
        arrastrar(video, desde: CGVector(dx: 0.5, dy: 0.4), hasta: CGVector(dx: 0.5, dy: 0.5))
        Thread.sleep(forTimeInterval: 1)
        XCTAssertFalse(elementoUI(app, IDUI.miniPausa).exists, "Un arrastre corto no debe minimizar")
        XCTAssertTrue(elementoUI(app, IDUI.videoTeatro).isHittable, "El vídeo no vuelve a su sitio")
        arrastrar(video, desde: CGVector(dx: 0.5, dy: 0.4), hasta: CGVector(dx: 0.5, dy: 2.6))
        XCTAssertTrue(elementoUI(app, IDUI.miniPausa).waitForExistence(timeout: 10), "Arrastrar hacia abajo no vuela al mini")
        XCTAssertTrue(esperarQueDesaparezca(elementoUI(app, IDUI.teatro), plazo: 5), "El teatro sigue tras aterrizar")
        captura(app, "mini-tras-arrastrar")
    }

    /// §3.7: volver deslizando desde el borde izquierdo con algo sonando deja el mini.
    @MainActor
    func testBordeIzquierdoSaleConElMiniSonando() throws {
        let app = abrirCanal()
        let conCanal = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "Reproductor: DAZN 1")).firstMatch
        XCTAssertTrue(conCanal.waitForExistence(timeout: 15), "El canal no llega al escenario")
        let teatro = elementoUI(app, IDUI.teatro)
        let inicio = teatro.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.6))
        inicio.press(forDuration: 0.05, thenDragTo: teatro.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.6)))
        XCTAssertTrue(elementoUI(app, IDUI.miniPausa).waitForExistence(timeout: 10), "El borde izquierdo no deja el mini")
    }

    @MainActor
    func testPausaYDetener() throws {
        let app = abrirCanal()
        minimizar(app)
        let pausa = elementoUI(app, IDUI.miniPausa)
        XCTAssertTrue(pausa.waitForExistence(timeout: 5))
        let antes = pausa.label
        pausa.tap()
        XCTAssertNotEqual(elementoUI(app, IDUI.miniPausa).label, antes, "La pausa del mini no cambia")
        elementoUI(app, IDUI.miniDetener).tap()
        XCTAssertTrue(esperarQueDesaparezca(elementoUI(app, IDUI.miniPausa), plazo: 8), "Detener no quita el mini")
    }

    @MainActor
    func testDeslizarALadoDescartaConDeshacer() throws {
        let app = abrirCanal()
        minimizar(app)
        let texto = app.buttons["Volver al vídeo: DAZN 1"].firstMatch
        arrastrar(texto, desde: CGVector(dx: 0.2, dy: 0.5), hasta: CGVector(dx: 1.6, dy: 0.5))
        XCTAssertTrue(esperarQueDesaparezca(elementoUI(app, IDUI.miniPausa), plazo: 8), "Deslizar a un lado no quita el mini")
        let deshacer = app.buttons["Deshacer"].firstMatch
        XCTAssertTrue(deshacer.waitForExistence(timeout: 5), "Sin «Deshacer»")
        XCTAssertTrue(conTextoUI(app, "Reproducción detenida").exists)
        captura(app, "mini-toast-deshacer")
        deshacer.tap()
        XCTAssertTrue(elementoUI(app, IDUI.miniPausa).waitForExistence(timeout: 10), "«Deshacer» no vuelve a poner el canal")
    }
}
