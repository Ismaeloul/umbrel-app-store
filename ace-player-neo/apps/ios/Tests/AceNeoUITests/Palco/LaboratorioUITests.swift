import XCTest

/// Capturas del banco de Palco (b-arquitectura §4.1.4, §3.1): cada bloque en claro y en oscuro, con y sin
/// transparencia reducida, más la hoja medida, el menú contextual, el `Menu` y «tocar la barra de estado sube».
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
            for bloque in 1...7 {
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

    /// Hoja nativa con el alto medido (UIKit y SwiftUI), menú contextual con vista previa y `Menu` fijo.
    @MainActor
    func testHojasYMenus() {
        for tema in ["claro", "oscuro"] {
            var app = abrir(bloque: 4, tema: tema)
            app.buttons["Hoja medida (UIKit)"].tap()
            XCTAssertTrue(app.staticTexts["Reproducir otro hash"].waitForExistence(timeout: 5))
            capturar("laboratorio-hoja-uikit-\(tema)")
            app.terminate()

            app = abrir(bloque: 4, tema: tema)
            app.buttons["Hoja .height(medido) (C6)"].tap()
            capturar("laboratorio-hoja-swiftui-\(tema)")
            app.terminate()

            app = abrir(bloque: 4, tema: tema)
            app.staticTexts["Clic derecho o pulsación larga aquí"].press(forDuration: 1.2)
            capturar("laboratorio-menu-contextual-\(tema)")
            app.terminate()

            app = abrir(bloque: 4, tema: tema)
            app.buttons["Más opciones"].tap()
            capturar("laboratorio-menu-\(tema)")
            app.terminate()
        }
    }

    /// Háptica desde una hoja abierta (en el simulador no vibra: se comprueba que no rompe nada).
    @MainActor
    func testHapticaConHoja() {
        let app = abrir(bloque: 6, tema: "claro")
        app.buttons["exito"].tap()
        app.buttons["Abrir una hoja y vibrar desde ella"].tap()
        XCTAssertTrue(app.staticTexts["Háptica con hoja"].waitForExistence(timeout: 5))
        // El de la hoja (el del banco queda debajo y no se puede tocar).
        let rigidos = app.buttons.matching(NSPredicate(format: "label == %@", "rigida")).allElementsBoundByIndex
        rigidos.first(where: { $0.isHittable })?.tap()
        capturar("laboratorio-haptica-hoja")
        XCUIDevice.shared.orientation = .landscapeLeft
        capturar("laboratorio-haptica-horizontal")
        XCUIDevice.shared.orientation = .portrait
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
