import XCTest

/// Capturas de TODAS las pantallas de Palco, en claro y en oscuro, con el
/// servidor simulado (datos fijos: siempre salen igual). Se guardan en el
/// resultado de los tests y la CI las saca del `.xcresult` al artefacto
/// `AceNeo-capturas` con su nombre (`claro-02-agenda-portada.png`…).
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
        // Deja terminar las animaciones (muelles, cristal, fundidos) antes de la foto.
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

    /// Espera a que el vídeo del escenario diga «Reproduciendo».
    @MainActor
    private func esperarReproduciendo(_ app: XCUIApplication, plazo: TimeInterval = 20) -> Bool {
        let video = elementoUI(app, "video-grande")
        let limite = Date().addingTimeInterval(plazo)
        while Date() < limite {
            if video.exists, video.label.contains("Reproduciendo") { return true }
            Thread.sleep(forTimeInterval: 0.4)
        }
        return video.exists && video.label.contains("Reproduciendo")
    }

    @MainActor
    private func recorrer(apariencia modo: String) throws {
        // Emparejar (primera vez).
        var app = lanzar(modo, emparejada: false)
        XCTAssertTrue(app.textFields["campo-codigo"].waitForExistence(timeout: 60), "No sale la pantalla de emparejar")
        captura(app, "\(modo)-01-emparejar")
        app.terminate()

        // Emparejada: agenda con la portada, «Para ti» y la tira de días.
        app = lanzar(modo, emparejada: true)
        let partido = conTextoUI(app, "Equipo Local")
        XCTAssertTrue(partido.waitForExistence(timeout: 60), "No aparece la agenda")
        continueAfterFailure = true
        if let fallo = comprobarTiraDeDias(app) { XCTFail("La tira de días no está bien: \(fallo)") }
        continueAfterFailure = false
        captura(app, "\(modo)-02-agenda-portada")

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

        // El escenario con la verificada sonando.
        partido.tap()
        XCTAssertTrue(elementoUI(app, "reproductor-grande").waitForExistence(timeout: 20), "No abre el escenario")
        XCTAssertTrue(esperarReproduciendo(app), "No arranca la verificada")
        XCTAssertTrue(conTextoUI(app, "Verificada").waitForExistence(timeout: 20), "Sin estado de las fuentes")
        captura(app, "\(modo)-05-escenario")

        // La hoja de fuentes (desde la cápsula «Señal»).
        let senal = elementoUI(app, "capsula-senal")
        if senal.waitForExistence(timeout: 5) {
            senal.tap()
            XCTAssertTrue(elementoUI(app, "hoja-fuentes").waitForExistence(timeout: 10), "No abre la hoja de fuentes")
            captura(app, "\(modo)-06-hoja-de-fuentes")
            app.buttons["Cerrar"].firstMatch.tap()
            _ = esperarQueDesaparezca(elementoUI(app, "hoja-fuentes"))
        }

        // Minimizar sin parar: el mini sobre la agenda.
        elementoUI(app, "boton-minimizar").tap()
        let mini = elementoUI(app, "mini-reproductor")
        XCTAssertTrue(mini.waitForExistence(timeout: 10), "No aparece el mini-reproductor")
        captura(app, "\(modo)-07-mini")

        // Canales: emitiendo ahora, favoritos, recientes y las listas agrupadas.
        app.tabBars.buttons["Canales"].tap()
        XCTAssertTrue(conTextoUI(app, "Canal Favorito").waitForExistence(timeout: 20), "Canales vacío")
        captura(app, "\(modo)-08-canales")
        let deportes = elementoUI(app, "categoria-Deportes")
        let lista = elementoUI(app, "lista-biblioteca")
        var visible = deportes.waitForExistence(timeout: 2) && deportes.isHittable
        for _ in 0..<6 where !visible {
            lista.swipeUp()
            visible = deportes.waitForExistence(timeout: 2) && deportes.isHittable
        }
        if visible {
            deportes.tap()
            captura(app, "\(modo)-09-canales-listas")
        }

        // Buscar en tus canales y en el motor.
        app.tabBars.buttons["Buscar"].tap()
        let buscador = app.searchFields.firstMatch
        XCTAssertTrue(buscador.waitForExistence(timeout: 10), "Sin buscador")
        buscador.tap()
        buscador.typeText("dazn\n")
        XCTAssertTrue(conTextoUI(app, "DAZN 1 HD").waitForExistence(timeout: 15), "Sin resultados")
        XCTAssertTrue(conTextoUI(app, "En tu biblioteca").exists, "Buscar no enseña lo de tu biblioteca")
        XCTAssertTrue(conTextoUI(app, "DAZN LaLiga FHD").exists, "Buscar no encuentra en tu biblioteca")
        captura(app, "\(modo)-10-buscar")

        // Ajustes con «Dónde se está reproduciendo» (este iPhone y el ordenador) y Apariencia.
        app.tabBars.buttons["Ajustes"].tap()
        XCTAssertTrue(app.navigationBars["Ajustes"].waitForExistence(timeout: 10), "No abre Ajustes")
        XCTAssertTrue(elementoUI(app, "visor-este-dispositivo").waitForExistence(timeout: 20), "Sin «Este dispositivo»")
        captura(app, "\(modo)-11-ajustes")
        elementoUI(app, "mini-detener").tap()
        let apariencia = elementoUI(app, "selector-apariencia")
        if apariencia.waitForExistence(timeout: 5) {
            if !apariencia.isHittable { app.swipeUp() }
            captura(app, "\(modo)-12-ajustes-apariencia")
        }

        // Ajustes → Listas.
        let listasAjustes = elementoUI(app, "enlace-listas")
        if listasAjustes.waitForExistence(timeout: 5) {
            if !listasAjustes.isHittable { app.swipeUp() }
            listasAjustes.tap()
            XCTAssertTrue(app.navigationBars["Listas"].waitForExistence(timeout: 10), "No abre las listas")
            captura(app, "\(modo)-13-ajustes-listas")
        }
        app.terminate()
    }
}
