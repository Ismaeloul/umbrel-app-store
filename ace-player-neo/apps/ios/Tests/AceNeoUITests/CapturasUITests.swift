import XCTest

/// Capturas de las pantallas principales, en claro y en oscuro, con el
/// servidor simulado (datos fijos: siempre salen igual). Se guardan en el
/// resultado de los tests y la CI las saca del `.xcresult` al artefacto
/// `AceNeo-capturas` con su nombre (`claro-02-agenda.png`…).
final class CapturasUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testCapturasEnClaro() throws {
        try recorrer(apariencia: "claro")
    }

    @MainActor
    func testCapturasEnOscuro() throws {
        try recorrer(apariencia: "oscuro")
    }

    @MainActor
    private func captura(_ app: XCUIApplication, _ nombre: String) {
        // Deja terminar las animaciones (muelles, cristal, zoom) antes de la foto.
        Thread.sleep(forTimeInterval: 1.2)
        let adjunto = XCTAttachment(screenshot: app.screenshot())
        adjunto.name = nombre
        adjunto.lifetime = .keepAlways
        add(adjunto)
    }

    @MainActor
    private func elemento(_ app: XCUIApplication, _ identificador: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identificador).firstMatch
    }

    @MainActor
    private func conTexto(_ app: XCUIApplication, _ texto: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", texto)).firstMatch
    }

    @MainActor
    private func lanzar(_ apariencia: String, emparejada: Bool) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments =
            ["-AceNeoServidorSimulado", "-AceNeoApariencia", apariencia] + (emparejada ? ["-AceNeoEmparejado"] : [])
        app.launch()
        return app
    }

    @MainActor
    private func recorrer(apariencia: String) throws {
        let modo = apariencia
        // Emparejar (primera vez).
        var app = lanzar(modo, emparejada: false)
        XCTAssertTrue(app.textFields["campo-codigo"].waitForExistence(timeout: 60), "No sale la pantalla de emparejar")
        captura(app, "\(modo)-01-emparejar")
        app.terminate()

        // Emparejada: agenda.
        app = lanzar(modo, emparejada: true)
        let partido = conTexto(app, "Equipo Local")
        XCTAssertTrue(partido.waitForExistence(timeout: 60), "No aparece la agenda")
        captura(app, "\(modo)-02-agenda")

        // Centro de partido con la verificada sonando.
        partido.tap()
        XCTAssertTrue(elemento(app, "reproductor-integrado").waitForExistence(timeout: 20), "No arranca la verificada")
        XCTAssertTrue(conTexto(app, "Verificada").waitForExistence(timeout: 10), "Sin estado de las fuentes")
        captura(app, "\(modo)-03-centro-de-partido")

        // Atrás sin parar: mini-reproductor sobre la agenda.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let mini = elemento(app, "mini-reproductor")
        XCTAssertTrue(mini.waitForExistence(timeout: 10), "No aparece el mini-reproductor")
        captura(app, "\(modo)-04-mini-reproductor")

        // Pantalla completa con los controles a la vista.
        mini.tap()
        let completo = elemento(app, "reproductor-completo")
        XCTAssertTrue(completo.waitForExistence(timeout: 10), "No abre la pantalla completa")
        XCTAssertNotNil(botonCerrarCompleta(app), "Sin controles en la pantalla completa")
        captura(app, "\(modo)-05-reproductor-completo")
        let cerrar = try XCTUnwrap(botonCerrarCompleta(app), "El botón de cerrar se ha escondido")
        cerrar.tap()
        XCTAssertTrue(mini.waitForExistence(timeout: 10), "Al cerrar no vuelve el mini")
        elemento(app, "mini-detener").tap()

        // Biblioteca.
        app.tabBars.buttons["Biblioteca"].tap()
        XCTAssertTrue(conTexto(app, "Canal Favorito").waitForExistence(timeout: 20), "Biblioteca vacía")
        captura(app, "\(modo)-06-biblioteca")

        // Buscar en el motor.
        app.tabBars.buttons["Buscar"].tap()
        let buscador = app.searchFields.firstMatch
        XCTAssertTrue(buscador.waitForExistence(timeout: 10), "Sin buscador")
        buscador.tap()
        buscador.typeText("dazn\n")
        XCTAssertTrue(conTexto(app, "DAZN 1 HD").waitForExistence(timeout: 15), "Sin resultados")
        captura(app, "\(modo)-07-buscar")

        // Ajustes.
        app.tabBars.buttons["Ajustes"].tap()
        XCTAssertTrue(app.navigationBars["Ajustes"].waitForExistence(timeout: 10), "No abre Ajustes")
        captura(app, "\(modo)-08-ajustes")
        app.terminate()
    }
}
