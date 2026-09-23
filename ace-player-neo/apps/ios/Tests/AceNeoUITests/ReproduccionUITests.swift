import XCTest

/// Flujos con el servidor simulado ya emparejado (`-AceNeoEmparejado`) y el
/// motor de vídeo simulado: la agenda con su tira de días, abrir un partido →
/// reproducir → mini-reproductor → reproductor grande (tocando y deslizando
/// hacia arriba) → minimizar deslizando hacia abajo, «Dónde se está
/// reproduciendo» y borrar un favorito → deshacer.
final class ReproduccionUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    private func lanzar() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AceNeoServidorSimulado", "-AceNeoEmparejado"]
        app.launch()
        return app
    }

    /// Captura que se guarda en el resultado de los tests (la CI la sube como artefacto).
    @MainActor
    private func captura(_ app: XCUIApplication, _ nombre: String) {
        let adjunto = XCTAttachment(screenshot: app.screenshot())
        adjunto.name = nombre
        adjunto.lifetime = .keepAlways
        add(adjunto)
    }

    @MainActor
    func testLaTiraDeDiasSeVeYSusDiasSePulsan() throws {
        let app = lanzar()
        XCTAssertTrue(conTextoUI(app, "Equipo Local").waitForExistence(timeout: 60), "No aparece la agenda")
        XCTAssertTrue(app.navigationBars["Agenda"].exists, "El título grande va arriba")
        if let fallo = comprobarTiraDeDias(app) {
            captura(app, "fallo-tira-de-dias")
            XCTFail("La tira de días no está bien: \(fallo)")
        }
        // La tira va DEBAJO del título (no una franja encima).
        let titulo = app.navigationBars["Agenda"]
        let primero = diasDeLaAgenda(app).firstMatch
        XCTAssertGreaterThanOrEqual(primero.frame.minY, titulo.frame.minY, "La tira no puede ir encima del título")

        // Otro día y vuelta: el elegido cambia.
        let dias = diasDeLaAgenda(app)
        XCTAssertGreaterThan(dias.count, 1)
        let segundo = dias.element(boundBy: 1)
        segundo.tap()
        let elegido = NSPredicate(format: "selected == true")
        expectation(for: elegido, evaluatedWith: segundo)
        waitForExpectations(timeout: 5)
        XCTAssertTrue(conTextoUI(app, "Local Mañana").waitForExistence(timeout: 5), "No enseña los partidos de ese día")
        dias.element(boundBy: 0).tap()
        expectation(for: elegido, evaluatedWith: dias.element(boundBy: 0))
        waitForExpectations(timeout: 5)
        captura(app, "01-agenda-tira-de-dias")

        // «Para ti» por defecto (hay gustos) y sin las reservas argentinas; «Todos» sí las trae.
        XCTAssertFalse(conTextoUI(app, "Central Córdoba").exists, "«Para ti» no debe traer lo que no es tuyo")
        let todos = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Todos")).firstMatch
        XCTAssertTrue(todos.waitForExistence(timeout: 5), "No hay «Para ti / Todos»")
        todos.tap()
        let reservas = conTextoUI(app, "Central Córdoba")
        var encontrada = reservas.waitForExistence(timeout: 5)
        let lista = elementoUI(app, "lista-agenda")
        for _ in 0..<4 where !encontrada {
            lista.swipeUp()
            encontrada = reservas.waitForExistence(timeout: 2)
        }
        XCTAssertTrue(encontrada, "«Todos» enseña todos los partidos")
    }

    @MainActor
    func testAbrirPartidoMiniReproductorGrandeYGestos() throws {
        let app = lanzar()

        // Agenda → partido.
        let partido = conTextoUI(app, "Equipo Local")
        XCTAssertTrue(partido.waitForExistence(timeout: 60), "No aparece la agenda")
        partido.tap()

        // Centro de partido: cabecera, fuentes y arranque automático por la verificada.
        XCTAssertTrue(elementoUI(app, "cabecera-partido").waitForExistence(timeout: 20), "No abre el centro de partido")
        XCTAssertTrue(elementoUI(app, "selector-fuentes").waitForExistence(timeout: 10), "No hay selector de fuentes")
        XCTAssertTrue(elementoUI(app, "reproductor-integrado").waitForExistence(timeout: 20), "No arranca la fuente verificada")
        XCTAssertTrue(conTextoUI(app, "Verificada").waitForExistence(timeout: 10), "Las fuentes enseñan su estado")
        captura(app, "02-centro-de-partido")

        // Volver a la agenda sin detener: aparece el mini-reproductor.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let mini = elementoUI(app, "mini-reproductor")
        XCTAssertTrue(mini.waitForExistence(timeout: 10), "No aparece el mini-reproductor")
        captura(app, "03-mini-reproductor")

        // Pausa y reanuda desde el mini.
        let pausa = elementoUI(app, "mini-reproducir")
        XCTAssertTrue(pausa.waitForExistence(timeout: 5), "El mini no tiene botón de pausa")
        pausa.tap()
        pausa.tap()

        // 1. Tocar el mini abre el reproductor grande.
        mini.tap()
        let grande = elementoUI(app, "reproductor-grande")
        XCTAssertTrue(grande.waitForExistence(timeout: 10), "Tocar el mini no abre el reproductor grande")
        XCTAssertTrue(elementoUI(app, "video-grande").waitForExistence(timeout: 5), "El grande no tiene el vídeo")
        XCTAssertTrue(elementoUI(app, "selector-fuentes").waitForExistence(timeout: 10), "El grande enseña las fuentes del partido")
        captura(app, "04-reproductor-grande")

        // 2. Deslizar hacia abajo lo minimiza al mini.
        let video = elementoUI(app, "video-grande")
        arrastrar(video, desde: CGVector(dx: 0.5, dy: 0.25), hasta: CGVector(dx: 0.5, dy: 3.2))
        XCTAssertTrue(esperarQueDesaparezca(grande), "Deslizar hacia abajo no minimiza el reproductor grande")
        XCTAssertTrue(mini.waitForExistence(timeout: 10), "Minimizado vuelve el mini (siempre se puede volver)")

        // 3. Deslizar el mini hacia arriba lo abre otra vez.
        arrastrar(mini, desde: CGVector(dx: 0.45, dy: 0.5), hasta: CGVector(dx: 0.45, dy: -6))
        XCTAssertTrue(grande.waitForExistence(timeout: 10), "Deslizar el mini hacia arriba no abre el reproductor grande")

        // 4. La flecha también lo minimiza.
        let minimizar = elementoUI(app, "boton-minimizar")
        XCTAssertTrue(minimizar.waitForExistence(timeout: 5))
        minimizar.tap()
        XCTAssertTrue(esperarQueDesaparezca(grande), "La flecha no minimiza")
        XCTAssertTrue(mini.waitForExistence(timeout: 10))

        // Detener desde el mini lo quita.
        elementoUI(app, "mini-detener").tap()
        XCTAssertTrue(esperarQueDesaparezca(mini), "Detener no quita el mini")
    }

    @MainActor
    func testDondeSeEstaReproduciendo() throws {
        let app = lanzar()
        let pestana = app.tabBars.buttons["Biblioteca"]
        XCTAssertTrue(pestana.waitForExistence(timeout: 60))
        pestana.tap()

        // Un favorito: suena y se abre el reproductor grande.
        let favorito = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Canal Favorito")).firstMatch
        XCTAssertTrue(favorito.waitForExistence(timeout: 20), "No aparece el favorito")
        favorito.tap()
        let grande = elementoUI(app, "reproductor-grande")
        XCTAssertTrue(grande.waitForExistence(timeout: 10), "Reproducir un canal abre el reproductor grande")
        elementoUI(app, "boton-minimizar").tap()
        XCTAssertTrue(elementoUI(app, "mini-reproductor").waitForExistence(timeout: 10))

        // Ajustes → «Dónde se está reproduciendo»: este iPhone y el ordenador del salón.
        app.tabBars.buttons["Ajustes"].tap()
        XCTAssertTrue(app.navigationBars["Ajustes"].waitForExistence(timeout: 10), "No abre Ajustes")
        let este = elementoUI(app, "visor-este-dispositivo")
        XCTAssertTrue(este.waitForExistence(timeout: 20), "No sale «Este dispositivo»")
        XCTAssertTrue(este.label.contains("este dispositivo"), este.label)
        XCTAssertTrue(conTextoUI(app, "Chrome · Windows").waitForExistence(timeout: 10), "No sale el ordenador")
        XCTAssertTrue(elementoUI(app, "sesion-s_simulada").exists, "Falta la sesión de este iPhone")
        captura(app, "05-donde-se-esta-reproduciendo")

        // Al parar, desaparece la sesión de este iPhone.
        elementoUI(app, "mini-detener").tap()
        XCTAssertTrue(esperarQueDesaparezca(este, plazo: 30), "Tras parar sigue saliendo este iPhone")
    }

    @MainActor
    func testBorrarUnFavoritoYDeshacer() throws {
        let app = lanzar()
        let pestana = app.tabBars.buttons["Biblioteca"]
        XCTAssertTrue(pestana.waitForExistence(timeout: 60))
        pestana.tap()

        let favorito = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Canal Favorito")).firstMatch
        XCTAssertTrue(favorito.waitForExistence(timeout: 20), "No aparece el favorito")
        captura(app, "06-biblioteca")
        favorito.swipeLeft()
        // Un deslizamiento largo puede borrar del tirón; si no, aparece el botón.
        let borrar = app.buttons["Borrar"]
        if borrar.waitForExistence(timeout: 3) { borrar.tap() }

        XCTAssertTrue(esperarQueDesaparezca(favorito), "No se borra")

        let deshacer = elementoUI(app, "aviso-accion")
        XCTAssertTrue(deshacer.waitForExistence(timeout: 5), "No se ofrece deshacer")
        captura(app, "07-deshacer")
        deshacer.tap()

        let vuelve = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Canal Favorito")).firstMatch
        XCTAssertTrue(vuelve.waitForExistence(timeout: 10), "Deshacer no lo devuelve")
    }

    @MainActor
    func testListasAgrupadasPorCategoria() throws {
        let app = lanzar()
        let pestana = app.tabBars.buttons["Biblioteca"]
        XCTAssertTrue(pestana.waitForExistence(timeout: 60))
        pestana.tap()
        let listas = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Listas")).firstMatch
        XCTAssertTrue(listas.waitForExistence(timeout: 20), "No hay selector de listas")
        listas.tap()

        let deportes = elementoUI(app, "categoria-Deportes")
        XCTAssertTrue(deportes.waitForExistence(timeout: 10), "Las listas no salen agrupadas por categoría")
        XCTAssertTrue(elementoUI(app, "categoria-Generalistas").exists)
        XCTAssertFalse(conTextoUI(app, "Eurosport 1 HD").exists, "Plegadas al entrar, como en la web")
        deportes.tap()
        XCTAssertTrue(conTextoUI(app, "Eurosport 1 HD").waitForExistence(timeout: 5), "Desplegar no enseña sus canales")
        captura(app, "08-listas-agrupadas")

        // El buscador filtra dentro y despliega lo que encuentra.
        let buscador = app.searchFields.firstMatch
        XCTAssertTrue(buscador.waitForExistence(timeout: 5))
        buscador.tap()
        buscador.typeText("antena")
        XCTAssertTrue(conTextoUI(app, "Antena 3 HD").waitForExistence(timeout: 5), "El buscador no encuentra dentro de las listas")
        XCTAssertFalse(conTextoUI(app, "Eurosport 1 HD").exists, "El buscador no filtra")
    }
}
