import XCTest

/// Flujos del armazón (b-arquitectura §3.5, M4), con la demo y las pantallas de otros módulos aún en stub:
/// cambiar de pestaña, borde izquierdo para salir del partido, hoja que se cierra arrastrando, toast con «Deshacer»,
/// giro a 844×390 con la barra superior, y tocar la pestaña activa / conservar el scroll (se saltan mientras la
/// pantalla sea un stub sin nada que desplazar).
final class FlujoArmazonUITests: XCTestCase {
    override func setUp() async throws {
        continueAfterFailure = false
        await MainActor.run { XCUIDevice.shared.orientation = .portrait }
    }

    override func tearDown() async throws {
        await MainActor.run { XCUIDevice.shared.orientation = .portrait }
    }

    @MainActor
    private func captura(_ app: XCUIApplication, _ nombre: String) {
        let adjunto = XCTAttachment(screenshot: app.screenshot())
        adjunto.name = nombre
        adjunto.lifetime = .keepAlways
        add(adjunto)
    }

    @MainActor
    private func abrir(_ argumentos: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AceNeoDemo"] + argumentos
        app.launch()
        esperarVertical(app)
        return app
    }

    /// Tras una prueba en horizontal el giro de vuelta puede no haber acabado: se espera a la ventana vertical.
    @MainActor
    private func esperarVertical(_ app: XCUIApplication) {
        let limite = Date().addingTimeInterval(5)
        while Date() < limite && app.frame.width > app.frame.height { Thread.sleep(forTimeInterval: 0.2) }
    }

    /// La pantalla visible es la de `id` y ninguna otra pestaña se ve.
    @MainActor
    private func comprobarPantalla(_ app: XCUIApplication, _ id: String) {
        let pantalla = elementoUI(app, IDUI.pantalla(id))
        XCTAssertTrue(pantalla.waitForExistence(timeout: 10), "No se ve la pantalla \(id)")
        // Las pestañas visitadas siguen montadas (vivas, a2 §12): XCUITest las encuentra aunque estén ocultas y fuera
        // de VoiceOver (SwiftUI las deja en sus elementos de automatización). Lo que cuenta es que no se puedan tocar.
        for otra in ["agenda", "biblioteca", "buscar", "ajustes"] where otra != id {
            let oculta = elementoUI(app, IDUI.pantalla(otra))
            XCTAssertFalse(oculta.exists && oculta.isHittable, "Se ve \(otra) estando en \(id)")
        }
        XCTAssertTrue(elementoUI(app, IDUI.pestana(id)).isSelected, "La pestaña \(id) no está marcada")
    }

    @MainActor
    func testArrancaYCambiaDePestana() throws {
        let app = abrir()
        XCTAssertTrue(elementoUI(app, IDUI.barraPestanas).waitForExistence(timeout: 20), "No hay barra de pestañas")
        comprobarPantalla(app, "agenda")
        captura(app, "armazon-agenda")

        for id in ["biblioteca", "buscar", "ajustes", "agenda"] {
            tocarPestana(app, id)
            comprobarPantalla(app, id)
            captura(app, "armazon-\(id)")
        }
    }

    /// a2 §2.4: deslizar desde el borde izquierdo saca del partido y deja ver la pestaña de debajo.
    @MainActor
    func testBordeIzquierdoSaleDelPartido() throws {
        let app = abrir(["-AceNeoVista", "partido/demo-1"])
        let teatro = elementoUI(app, IDUI.teatro)
        XCTAssertTrue(teatro.waitForExistence(timeout: 20), "No se abre el partido con -AceNeoVista")
        XCTAssertFalse(elementoUI(app, IDUI.barraPestanas).exists, "En el partido no hay barra de pestañas")
        captura(app, "armazon-partido")

        let inicio = app.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.5))
        let fin = app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5))
        inicio.press(forDuration: 0.05, thenDragTo: fin, withVelocity: .fast, thenHoldForDuration: 0)

        XCTAssertTrue(esperarQueDesaparezca(teatro, plazo: 5), "El borde izquierdo no saca del partido")
        comprobarPantalla(app, "agenda")
        XCTAssertTrue(elementoUI(app, IDUI.barraPestanas).waitForExistence(timeout: 5), "No vuelve la barra")
        captura(app, "armazon-tras-borde")
    }

    /// Un borde corto no sale: el partido vuelve a su sitio.
    @MainActor
    func testBordeCortoNoSale() throws {
        let app = abrir(["-AceNeoVista", "partido/demo-1"])
        let teatro = elementoUI(app, IDUI.teatro)
        XCTAssertTrue(teatro.waitForExistence(timeout: 20), "No se abre el partido con -AceNeoVista")
        let inicio = app.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.5))
        let fin = app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5))
        inicio.press(forDuration: 0.05, thenDragTo: fin, withVelocity: .slow, thenHoldForDuration: 0.3)
        Thread.sleep(forTimeInterval: 1)
        XCTAssertTrue(teatro.exists, "Un arrastre corto y lento no debe salir del partido")
    }

    /// a2 §8.3: el toast con acción; «Deshacer» lo cierra antes de su tiempo (6 s).
    @MainActor
    func testToastConDeshacer() throws {
        let app = abrir(["-AceNeoAvisoDeshacer"])
        let toast = conTextoUI(app, "Reproducción detenida")
        XCTAssertTrue(toast.waitForExistence(timeout: 20), "No sale el toast con «Deshacer»")
        let barra = elementoUI(app, IDUI.barraPestanas)
        XCTAssertTrue(barra.exists)
        Thread.sleep(forTimeInterval: 0.8)  // entrada del toast (muelle estándar, 520 ms)
        captura(app, "armazon-toast")
        XCTAssertLessThan(toast.frame.maxY, barra.frame.minY + 1,
                          "El toast debe ir por encima de la barra (toast \(toast.frame), barra \(barra.frame))")
        // «Deshacer» va a la izquierda del ✕ de 44 (a2 §8.3): se toca con el dedo en su sitio.
        let punto = CGVector(dx: (toast.frame.maxX - 6 - 44 - 45) / app.frame.width, dy: toast.frame.midY / app.frame.height)
        app.coordinate(withNormalizedOffset: punto).tap()
        XCTAssertTrue(esperarQueDesaparezca(toast, plazo: 3), "«Deshacer» no cierra el toast")
    }

    /// a2 §16: a 844×390 la barra de abajo se va y aparece la barra superior; al volver, al revés.
    @MainActor
    func testGiroEnsenaLaBarraSuperior() throws {
        let app = abrir()
        XCTAssertTrue(elementoUI(app, IDUI.barraPestanas).waitForExistence(timeout: 20))
        XCUIDevice.shared.orientation = .landscapeLeft
        let superior = elementoUI(app, IDUI.barraSuperior)
        XCTAssertTrue(superior.waitForExistence(timeout: 10), "En horizontal no aparece la barra superior")
        XCTAssertTrue(esperarQueDesaparezca(elementoUI(app, IDUI.barraPestanas), plazo: 5), "Sigue la barra de abajo")
        XCTAssertLessThan(superior.frame.minY, 1, "La barra superior va pegada arriba")
        captura(app, "armazon-horizontal")
        tocarPestana(app, "ajustes")
        comprobarPantalla(app, "ajustes")
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(elementoUI(app, IDUI.barraPestanas).waitForExistence(timeout: 10), "No vuelve la barra de abajo")
        comprobarPantalla(app, "ajustes")
    }

    /// a2 §9.4 y decisión 5: la hoja nativa se cierra arrastrando el asa (en horizontal, «?» abre la ayuda).
    @MainActor
    func testHojaConAsaSeCierraArrastrando() throws {
        let app = abrir()
        XCTAssertTrue(elementoUI(app, IDUI.barraPestanas).waitForExistence(timeout: 20))
        XCUIDevice.shared.orientation = .landscapeLeft
        let ayuda = app.buttons["Atajos de teclado"]
        XCTAssertTrue(ayuda.waitForExistence(timeout: 10), "No está «Atajos de teclado» en la barra superior")
        ayuda.tap()
        let hoja = elementoUI(app, IDUI.hojaAyuda)
        XCTAssertTrue(hoja.waitForExistence(timeout: 10), "No se abre la hoja de ayuda")
        captura(app, "armazon-hoja")
        let arriba = CGVector(dx: 0.5, dy: max(0.02, (hoja.frame.minY - 10) / app.frame.height))
        let abajo = CGVector(dx: 0.5, dy: 0.98)
        app.coordinate(withNormalizedOffset: arriba)
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: abajo), withVelocity: .fast,
                   thenHoldForDuration: 0)
        XCTAssertTrue(esperarQueDesaparezca(hoja, plazo: 5), "La hoja no se cierra arrastrando el asa")
    }

    /// Decisión 3: tocar la pestaña activa sube su vista arriba.
    @MainActor
    func testTocarLaPestanaActivaSube() throws {
        let app = abrir()
        tocarPestana(app, "ajustes")
        let lista = app.scrollViews.firstMatch
        guard lista.waitForExistence(timeout: 5) else { throw XCTSkip("Ajustes aún es un stub sin nada que desplazar") }
        let titulo = app.staticTexts["Ajustes"].firstMatch
        lista.swipeUp()
        lista.swipeUp()
        tocarPestana(app, "ajustes")
        XCTAssertTrue(titulo.waitForExistence(timeout: 3) && titulo.isHittable, "No sube arriba al tocar la activa")
    }

    /// a2 §12: cada pestaña conserva su scroll al ir y volver.
    @MainActor
    func testCambiarDePestanaConservaElScroll() throws {
        let app = abrir()
        tocarPestana(app, "ajustes")
        let lista = app.scrollViews.firstMatch
        guard lista.waitForExistence(timeout: 5) else { throw XCTSkip("Ajustes aún es un stub sin nada que desplazar") }
        lista.swipeUp()
        let titulo = app.staticTexts["Ajustes"].firstMatch
        let tapadoAntes = !(titulo.exists && titulo.isHittable)
        tocarPestana(app, "agenda")
        tocarPestana(app, "ajustes")
        let tapadoDespues = !(titulo.exists && titulo.isHittable)
        XCTAssertEqual(tapadoAntes, tapadoDespues, "Al volver a Ajustes no se conserva el scroll")
    }
}
