import XCTest

/// Capturas de TODAS las pantallas, en claro y en oscuro, con el servidor
/// simulado (datos fijos: siempre salen igual). Se guardan en el resultado de
/// los tests y la CI las saca del `.xcresult` al artefacto `AceNeo-capturas`
/// con su nombre (`claro-02-agenda.png`…).
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
    private func lanzar(_ apariencia: String, emparejada: Bool) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments =
            ["-AceNeoServidorSimulado", "-AceNeoApariencia", apariencia] + (emparejada ? ["-AceNeoEmparejado"] : [])
        app.launch()
        return app
    }

    @MainActor
    private func recorrer(apariencia modo: String) throws {
        // Emparejar (primera vez).
        var app = lanzar(modo, emparejada: false)
        XCTAssertTrue(app.textFields["campo-codigo"].waitForExistence(timeout: 60), "No sale la pantalla de emparejar")
        captura(app, "\(modo)-01-emparejar")
        app.terminate()

        // Emparejada: agenda «Para ti» con la tira de días.
        app = lanzar(modo, emparejada: true)
        let partido = conTextoUI(app, "Equipo Local")
        XCTAssertTrue(partido.waitForExistence(timeout: 60), "No aparece la agenda")
        continueAfterFailure = true
        if let fallo = comprobarTiraDeDias(app) { XCTFail("La tira de días no está bien: \(fallo)") }
        continueAfterFailure = false
        captura(app, "\(modo)-02-agenda-para-ti")

        // «Todos».
        let todos = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Todos")).firstMatch
        if todos.waitForExistence(timeout: 5) {
            todos.tap()
            captura(app, "\(modo)-03-agenda-todos")
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Para ti")).firstMatch.tap()
        }

        // Tus gustos (la hoja de la agenda).
        let gustos = elementoUI(app, "boton-editar-gustos")
        if gustos.waitForExistence(timeout: 5) {
            gustos.tap()
            XCTAssertTrue(elementoUI(app, "formulario-gustos").waitForExistence(timeout: 10), "No abre tus gustos")
            captura(app, "\(modo)-04-tus-gustos")
            app.buttons["Cancelar"].tap()
            _ = esperarQueDesaparezca(elementoUI(app, "formulario-gustos"))
        }

        // Centro de partido con la verificada sonando.
        partido.tap()
        XCTAssertTrue(elementoUI(app, "reproductor-integrado").waitForExistence(timeout: 20), "No arranca la verificada")
        XCTAssertTrue(conTextoUI(app, "Verificada").waitForExistence(timeout: 20), "Sin estado de las fuentes")
        captura(app, "\(modo)-05-centro-de-partido")

        // Atrás sin parar: mini-reproductor sobre la agenda.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let mini = elementoUI(app, "mini-reproductor")
        XCTAssertTrue(mini.waitForExistence(timeout: 10), "No aparece el mini-reproductor")
        captura(app, "\(modo)-06-mini-reproductor")

        // El reproductor grande (desde el mini).
        mini.tap()
        let grande = elementoUI(app, "reproductor-grande")
        XCTAssertTrue(grande.waitForExistence(timeout: 10), "No abre el reproductor grande")
        captura(app, "\(modo)-07-reproductor-grande")
        elementoUI(app, "boton-minimizar").tap()
        XCTAssertTrue(mini.waitForExistence(timeout: 10), "Al minimizar no vuelve el mini")

        // Biblioteca: favoritos (con lo que emiten), recientes y listas agrupadas.
        app.tabBars.buttons["Biblioteca"].tap()
        XCTAssertTrue(conTextoUI(app, "Canal Favorito").waitForExistence(timeout: 20), "Biblioteca vacía")
        captura(app, "\(modo)-08-biblioteca-favoritos")
        let recientes = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Recientes")).firstMatch
        if recientes.waitForExistence(timeout: 5) {
            recientes.tap()
            captura(app, "\(modo)-09-biblioteca-recientes")
        }
        let listas = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Listas")).firstMatch
        if listas.waitForExistence(timeout: 5) {
            listas.tap()
            let deportes = elementoUI(app, "categoria-Deportes")
            if deportes.waitForExistence(timeout: 5) { deportes.tap() }
            captura(app, "\(modo)-10-biblioteca-listas")
        }

        // Buscar en el motor.
        app.tabBars.buttons["Buscar"].tap()
        let buscador = app.searchFields.firstMatch
        XCTAssertTrue(buscador.waitForExistence(timeout: 10), "Sin buscador")
        buscador.tap()
        buscador.typeText("dazn\n")
        XCTAssertTrue(conTextoUI(app, "DAZN 1 HD").waitForExistence(timeout: 15), "Sin resultados")
        captura(app, "\(modo)-11-buscar")

        // Ajustes con «Dónde se está reproduciendo» (este iPhone y el ordenador).
        app.tabBars.buttons["Ajustes"].tap()
        XCTAssertTrue(app.navigationBars["Ajustes"].waitForExistence(timeout: 10), "No abre Ajustes")
        XCTAssertTrue(elementoUI(app, "visor-este-dispositivo").waitForExistence(timeout: 20), "Sin «Este dispositivo»")
        captura(app, "\(modo)-12-ajustes")
        elementoUI(app, "mini-detener").tap()
        app.terminate()
    }
}
