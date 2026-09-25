import XCTest

/// Capturas del banco de Palco (b-arquitectura §4.1.4, §3.1): cada bloque en claro y en oscuro, con y sin
/// transparencia reducida, más las hojas, el menú contextual, el `Menu`, «tocar la barra de estado sube» y los
/// canarios que solo se ven en pantalla (C2, C5, C13, C15).
/// Las capturas salen como adjuntos (`laboratorio-<bloque>-<tema>[-reducida].png`) y la CI las exporta.
final class LaboratorioUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = true
    }

    @MainActor
    private func abrir(bloque: Int? = nil, tema: String, reducida: Bool = false, desplazar: Int? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        var argumentos = ["-AceNeoLaboratorio", "-AceNeoApariencia", tema, "-AceNeoMovimientoReducido"]
        if let bloque { argumentos += ["-AceNeoLaboratorioSeccion", String(bloque)] }
        if reducida { argumentos.append("-AceNeoTransparenciaReducida") }
        if let desplazar { argumentos += ["-AceNeoDesplazar", String(desplazar)] }
        app.launchArguments = argumentos
        app.launch()
        XCTAssertTrue(app.staticTexts["Laboratorio"].waitForExistence(timeout: 20), "No abre el banco")
        return app
    }

    @MainActor
    private func capturar(_ nombre: String) {
        Thread.sleep(forTimeInterval: 1.2)
        let adjunto = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        adjunto.name = nombre
        adjunto.lifetime = .keepAlways
        add(adjunto)
    }

    /// Cada bloque arriba del todo (y el 1 y el 2, que son largos, también desplazados).
    @MainActor
    func testCapturasDeCadaBloque() {
        for tema in ["claro", "oscuro"] {
            for bloque in 1...8 {
                let app = abrir(bloque: bloque, tema: tema)
                capturar("laboratorio-\(bloque)-\(tema)")
                if bloque <= 3 {
                    app.terminate()
                    _ = abrir(bloque: bloque, tema: tema, desplazar: 700)
                    capturar("laboratorio-\(bloque)-\(tema)-y700")
                }
            }
        }
    }

    /// El cristal con transparencia reducida: el sólido exacto de la web.
    @MainActor
    func testCristalConTransparenciaReducida() {
        for tema in ["claro", "oscuro"] {
            _ = abrir(bloque: 3, tema: tema, reducida: true)
            capturar("laboratorio-3-\(tema)-reducida")
            _ = abrir(bloque: 3, tema: tema, reducida: true, desplazar: 700)
            capturar("laboratorio-3-\(tema)-reducida-y700")
        }
    }

    /// Hojas nativas de la puerta de la app (`CentroHojas`: medida y grande), menú contextual con vista previa y
    /// `Menu` fijo.
    @MainActor
    func testHojasYMenus() {
        for tema in ["claro", "oscuro"] {
            var app = abrir(bloque: 4, tema: tema)
            app.buttons["Hoja medida"].tap()
            XCTAssertTrue(app.staticTexts["Reproducir otro hash"].waitForExistence(timeout: 5))
            capturar("laboratorio-hoja-medida-\(tema)")
            app.buttons["Cancelar"].tap()
            XCTAssertTrue(esperarQueDesaparezca(app.staticTexts["Reproducir otro hash"]), "«Cancelar» no cierra la hoja")
            app.terminate()

            app = abrir(bloque: 4, tema: tema)
            app.buttons["Hoja grande"].tap()
            XCTAssertTrue(app.staticTexts["Atajos de ejemplo"].waitForExistence(timeout: 5))
            capturar("laboratorio-hoja-grande-\(tema)")
            app.terminate()

            app = abrir(bloque: 4, tema: tema)
            app.staticTexts["Clic derecho o pulsación larga aquí"].press(forDuration: 1.2)
            XCTAssertTrue(app.buttons["Guardar en favoritos"].waitForExistence(timeout: 5), "No sale el menú contextual")
            capturar("laboratorio-menu-contextual-\(tema)")
            app.terminate()

            app = abrir(bloque: 4, tema: tema)
            app.buttons["Más opciones"].tap()
            capturar("laboratorio-menu-\(tema)")
            app.terminate()
        }
    }

    /// Háptica por el pulso central (canario C5): la cuenta de pulsos de la raíz sube desde el banco, desde una
    /// hoja abierta y en horizontal con la hoja abierta. En el simulador no vibra; lo que se siente, en el iPhone.
    @MainActor
    func testHapticaConHoja() {
        let app = abrir(bloque: 6, tema: "claro")
        app.buttons["exito"].tap()
        XCTAssertTrue(conTextoUI(app, "Pulsos: 1 · exito").waitForExistence(timeout: 3), "El pulso no llega a la raíz")
        app.buttons["Abrir una hoja y vibrar desde ella"].tap()
        XCTAssertTrue(app.staticTexts["Háptica con hoja"].waitForExistence(timeout: 5))
        tocarLaQueSeVe(app, "rigida")
        XCTAssertTrue(conTextoUI(app, "Pulsos: 2 · rigida").waitForExistence(timeout: 3), "Con hoja no llega el pulso")
        capturar("laboratorio-haptica-hoja")
        XCUIDevice.shared.orientation = .landscapeLeft
        Thread.sleep(forTimeInterval: 1.5)
        tocarLaQueSeVe(app, "fuerte")
        XCTAssertTrue(conTextoUI(app, "Pulsos: 3 · fuerte").waitForExistence(timeout: 3), "En horizontal no llega")
        capturar("laboratorio-haptica-horizontal")
        XCUIDevice.shared.orientation = .portrait
    }

    /// El botón de ese rótulo que se puede tocar (el de la hoja: el del banco queda debajo).
    @MainActor
    private func tocarLaQueSeVe(_ app: XCUIApplication, _ rotulo: String) {
        let botones = app.buttons.matching(NSPredicate(format: "label == %@", rotulo)).allElementsBoundByIndex
        guard let boton = botones.last(where: { $0.isHittable }) else {
            XCTFail("No se ve ningún botón «\(rotulo)»")
            return
        }
        boton.tap()
    }

    /// La barra de estado sigue a `EstadoVentana` y al tema de `PreferenciasLocales` (canarios C2 y C13): el
    /// banco publica y `HostingRaiz` (con `Observations`) pide al sistema el estilo, la barra oculta y el tema.
    @MainActor
    func testLaBarraDeEstadoSigueAEstadoVentana() {
        let app = abrir(bloque: 5, tema: "claro")
        Thread.sleep(forTimeInterval: 1)
        let normal = LecturaBarraEstado.ahora()
        capturar("laboratorio-barra-normal")
        app.buttons["Barra clara"].tap()
        Thread.sleep(forTimeInterval: 1)
        let clara = LecturaBarraEstado.ahora()
        capturar("laboratorio-barra-clara")
        app.buttons["Barra clara"].tap()
        app.buttons["Inmersivo"].tap()
        Thread.sleep(forTimeInterval: 1)
        let oculta = LecturaBarraEstado.ahora()
        capturar("laboratorio-barra-oculta")
        app.buttons["Inmersivo"].tap()
        app.buttons["Oscuro"].tap()
        Thread.sleep(forTimeInterval: 1)
        let oscura = LecturaBarraEstado.ahora()
        capturar("laboratorio-barra-tema-oscuro")
        app.buttons["Sistema"].tap()
        let resumen = "normal \(normal) · clara \(clara) · oculta \(oculta) · oscura \(oscura)"
        XCTAssertGreaterThan(normal.fondo, 0.8, "Tema claro: el fondo no es claro (\(resumen))")
        XCTAssertGreaterThan(normal.tinta, 0.005, "Tema claro: no se lee la hora oscura (\(resumen))")
        XCTAssertLessThan(clara.tinta, normal.tinta / 4, "«Barra clara» no cambia el estilo (\(resumen))")
        XCTAssertLessThan(oculta.tinta, normal.tinta / 4, "«Inmersivo» no oculta la barra (\(resumen))")
        XCTAssertLessThan(oscura.fondo, 0.2, "El tema oscuro no llega a la ventana (\(resumen))")
        XCTAssertGreaterThan(oscura.tinta, 0.005, "Tema oscuro: no se lee la hora clara (\(resumen))")
    }

    /// Los marcos `.global` de `.piezaVuelo` siguen al desplazamiento (canario C15): el que publica la tarjeta 2
    /// casa con el que ve XCUITest antes y después de arrastrar el banco.
    @MainActor
    func testMarcosGlobalesSiguenAlDesplazamiento() {
        let app = abrir(bloque: 8, tema: "claro")
        let tarjeta = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Tarjeta 2")).firstMatch
        XCTAssertTrue(tarjeta.waitForExistence(timeout: 5), "No está la tarjeta 2")
        let antes = leerMarco(app, lectura: 1)
        XCTAssertEqual(antes, Double(tarjeta.frame.minY), accuracy: 1, "El marco publicado no es el de la pantalla")
        let inicio = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
        let fin = inicio.withOffset(CGVector(dx: 0, dy: -150))
        inicio.press(forDuration: 0.1, thenDragTo: fin, withVelocity: .slow, thenHoldForDuration: 0.5)
        Thread.sleep(forTimeInterval: 1)
        let despues = leerMarco(app, lectura: 2)
        capturar("laboratorio-marcos")
        XCTAssertLessThan(despues, antes - 60, "El banco no se ha desplazado (antes \(antes), después \(despues))")
        XCTAssertEqual(despues, Double(tarjeta.frame.minY), accuracy: 1, "Tras desplazar, el marco se queda viejo")
    }

    /// Toca «Leer marcos» y devuelve la y publicada de la tarjeta 2 (la lectura `n`).
    @MainActor
    private func leerMarco(_ app: XCUIApplication, lectura: Int) -> Double {
        app.buttons["Leer marcos"].tap()
        let texto = conTextoUI(app, "Lectura \(lectura) · y=")
        guard texto.waitForExistence(timeout: 3) else {
            XCTFail("No hay lectura \(lectura) del marco")
            return -1
        }
        let partes = texto.label.components(separatedBy: " · ")
        let valor = partes.first(where: { $0.hasPrefix("y=") })?.dropFirst(2) ?? ""
        return Double(String(valor)) ?? -1
    }

    /// El pan horizontal responde en la tarjeta y cede al carril (canario C3); la rueda y la paleta (C9).
    @MainActor
    func testGestosYCifras() {
        let app = abrir(bloque: 7, tema: "claro")
        app.buttons["Gol"].tap()
        app.buttons["Destapar"].tap()
        capturar("laboratorio-cifras")
        let tarjeta = app.staticTexts["Desliza esta tarjeta a los lados"]
        XCTAssertTrue(tarjeta.waitForExistence(timeout: 5))
        tarjeta.swipeLeft()
        XCTAssertTrue(conTextoUI(app, "soltado dx=-").waitForExistence(timeout: 3), "El pan horizontal no ha llegado")
        capturar("laboratorio-gestos")
    }

    /// Tocar la barra de estado sube el banco (el único ScrollView con `scrollsToTop`; a2 §24, §27.5).
    @MainActor
    func testTocarLaBarraDeEstadoSube() {
        let app = abrir(bloque: 5, tema: "claro")
        for _ in 0..<4 { app.swipeUp() }
        capturar("laboratorio-barra-abajo")
        XCTAssertFalse(app.staticTexts["Laboratorio"].isHittable, "La lista no ha bajado")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0)).withOffset(CGVector(dx: 0, dy: 12)).tap()
        Thread.sleep(forTimeInterval: 1.5)
        capturar("laboratorio-barra-arriba")
        XCTAssertTrue(app.staticTexts["Laboratorio"].isHittable, "Tocar la barra de estado no ha subido la lista")
    }
}
