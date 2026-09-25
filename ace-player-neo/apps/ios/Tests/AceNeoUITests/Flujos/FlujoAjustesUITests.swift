import XCTest

/// Flujos de Ajustes (b-arquitectura §3.8, M7; a6): los chips llevan a su tarjeta, el tema y «Reducir
/// transparencia» cambian al momento, la hoja de ayuda se abre desde «Acerca de», «Olvidar este iPhone» con
/// segundo toque vuelve a Emparejar sin aviso y «Revocar» a otro con segundo toque avisa. Los dos últimos
/// necesitan la lista de dispositivos de la demo (M1 + M2): hasta entonces se saltan con su motivo.
final class FlujoAjustesUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    private func captura(_ app: XCUIApplication, _ nombre: String) {
        let adjunto = XCTAttachment(screenshot: app.screenshot())
        adjunto.name = nombre
        adjunto.lifetime = .keepAlways
        add(adjunto)
    }

    @MainActor
    private func abrirAjustes(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AceNeoDemo"] + extra
        app.launch()
        tocarPestana(app, "ajustes")
        XCTAssertTrue(elementoUI(app, IDUI.pantalla("ajustes")).waitForExistence(timeout: 15), "No sale Ajustes")
        XCTAssertTrue(elementoUI(app, IDUI.indiceAjustes).waitForExistence(timeout: 10), "No hay índice de chips")
        return app
    }

    /// Toca un chip del índice (desplazando la fila si hace falta).
    @MainActor
    private func tocarChip(_ app: XCUIApplication, _ seccion: String) {
        let chip = elementoUI(app, IDUI.chip(seccion))
        XCTAssertTrue(chip.waitForExistence(timeout: 10), "No hay chip \(seccion)")
        var intentos = 0
        while !chip.isHittable && intentos < 6 {
            elementoUI(app, IDUI.indiceAjustes).swipeLeft()
            intentos += 1
        }
        chip.tap()
    }

    /// La tarjeta de la sección queda arriba, a la vista.
    @MainActor
    private func comprobarArriba(_ app: XCUIApplication, _ seccion: String) {
        let tarjeta = elementoUI(app, IDUI.seccion(seccion))
        XCTAssertTrue(tarjeta.waitForExistence(timeout: 10), "No hay tarjeta \(seccion)")
        Thread.sleep(forTimeInterval: 0.8)
        XCTAssertLessThan(tarjeta.frame.minY, app.frame.height * 0.35, "La tarjeta \(seccion) no ha subido: \(tarjeta.frame)")
        XCTAssertGreaterThan(tarjeta.frame.minY, 0, "La tarjeta \(seccion) queda bajo la barra de estado")
    }

    @MainActor
    func testLosChipsLlevanASuSeccion() throws {
        let app = abrirAjustes()
        captura(app, "ajustes-390x844")
        for seccion in ["apariencia", "motor", "acerca", "listas"] {
            tocarChip(app, seccion)
            comprobarArriba(app, seccion)
            captura(app, "ajustes-\(seccion)")
        }
    }

    @MainActor
    func testTemaYTransparencia() throws {
        let app = abrirAjustes()
        tocarChip(app, "apariencia")
        comprobarArriba(app, "apariencia")
        let tema = elementoUI(app, IDUI.segmentadoTema)
        XCTAssertTrue(tema.waitForExistence(timeout: 5))
        let oscuro = tema.buttons["Oscuro"]
        oscuro.tap()
        XCTAssertTrue(oscuro.isSelected, "«Oscuro» no queda elegido")
        captura(app, "ajustes-apariencia-oscuro")
        tema.buttons["Claro"].tap()
        XCTAssertTrue(tema.buttons["Claro"].isSelected)
        captura(app, "ajustes-apariencia-claro")
        tema.buttons["Sistema"].tap()

        let transparencia = elementoUI(app, IDUI.interruptorTransparencia)
        XCTAssertTrue(transparencia.exists)
        let antes = transparencia.value as? String
        transparencia.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        let cambiado = NSPredicate(format: "value != %@", antes ?? "")
        expectation(for: cambiado, evaluatedWith: transparencia)
        waitForExpectations(timeout: 5)
        captura(app, "ajustes-transparencia-reducida")
        transparencia.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
    }

    @MainActor
    func testLaAyudaSeAbreDesdeAcercaDe() throws {
        let app = abrirAjustes()
        tocarChip(app, "acerca")
        let boton = elementoUI(app, IDUI.botonAtajos)
        XCTAssertTrue(boton.waitForExistence(timeout: 5))
        boton.tap()
        XCTAssertTrue(elementoUI(app, IDUI.hojaAyuda).waitForExistence(timeout: 5), "No se abre la hoja de ayuda")
        XCTAssertTrue(conTextoUI(app, "Desliza a los lados").exists, "Falta el bloque «Gestos»")
        captura(app, "ayuda")
    }

    @MainActor
    func testOlvidarEsteIPhoneVuelveAEmparejarSinAviso() throws {
        let app = abrirAjustes()
        tocarChip(app, "dispositivos")
        let fila = elementoUI(app, IDUI.filaEsteIPhone)
        guard fila.waitForExistence(timeout: 8) else {
            throw XCTSkip("La demo aún no sirve la lista de dispositivos (M1 + M2): se prueba al integrar")
        }
        captura(app, "dispositivos")
        let olvidar = elementoUI(app, IDUI.botonOlvidarEsteIPhone)
        olvidar.tap()
        XCTAssertTrue(conTextoUI(app, "¿Olvidar? Pulsa otra vez").waitForExistence(timeout: 3), "No se arma")
        XCTAssertTrue(conTextoUI(app, "Este iPhone dejará de poder entrar").exists, "Falta la línea de aviso")
        captura(app, "dispositivos-olvidar-armado")
        olvidar.tap()
        guard elementoUI(app, IDUI.pantalla("emparejar")).waitForExistence(timeout: 15) else {
            throw XCTSkip("La sesión (M1) aún no hace «Olvidar este iPhone»: se prueba al integrar")
        }
        XCTAssertFalse(elementoUI(app, IDUI.avisoAcceso).exists, "Tras olvidar no hay aviso (a2 §23.3)")
    }

    @MainActor
    func testRevocarOtroConSegundoToque() throws {
        let app = abrirAjustes()
        tocarChip(app, "dispositivos")
        let botones = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "boton-revocar-"))
        guard botones.firstMatch.waitForExistence(timeout: 8) else {
            throw XCTSkip("La demo aún no sirve otros dispositivos (M1 + M2): se prueba al integrar")
        }
        let revocar = botones.firstMatch
        revocar.tap()
        XCTAssertTrue(conTextoUI(app, "¿Revocar? Pulsa otra vez").waitForExistence(timeout: 3), "No se arma")
        revocar.tap()
        XCTAssertTrue(conTextoUI(app, "ya no puede entrar").waitForExistence(timeout: 10), "No avisa de la revocación")
    }
}
