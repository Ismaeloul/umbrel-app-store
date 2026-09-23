import XCTest

/// Flujos con el servidor simulado ya emparejado (`-AceNeoEmparejado`) y el
/// motor de vídeo simulado: abrir un partido → reproducir → mini-reproductor
/// → volver, y borrar un favorito → deshacer.
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

    @MainActor
    private func elemento(_ app: XCUIApplication, _ identificador: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identificador).firstMatch
    }

    @MainActor
    func testAbrirPartidoReproducirMiniReproductorYVolver() throws {
        let app = lanzar()

        // Agenda → partido.
        let partido = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "Equipo Local"))
            .firstMatch
        XCTAssertTrue(partido.waitForExistence(timeout: 60), "No aparece la agenda")
        partido.tap()

        // Centro de partido: cabecera, fuentes y arranque automático por la verificada.
        XCTAssertTrue(elemento(app, "cabecera-partido").waitForExistence(timeout: 20), "No abre el centro de partido")
        XCTAssertTrue(elemento(app, "selector-fuentes").waitForExistence(timeout: 10))
        let reproductor = elemento(app, "reproductor-integrado")
        XCTAssertTrue(reproductor.waitForExistence(timeout: 20), "No arranca la fuente verificada")
        let verificada = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "Verificada"))
            .firstMatch
        XCTAssertTrue(verificada.waitForExistence(timeout: 10), "Las fuentes enseñan su estado")

        // Volver a la agenda sin detener: aparece el mini-reproductor.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let mini = elemento(app, "mini-reproductor")
        XCTAssertTrue(mini.waitForExistence(timeout: 10), "No aparece el mini-reproductor")

        // Pausa y reanuda desde el mini.
        let pausa = elemento(app, "mini-reproducir")
        XCTAssertTrue(pausa.exists)
        pausa.tap()
        pausa.tap()

        // Del mini al reproductor a pantalla completa y vuelta.
        mini.tap()
        let completo = elemento(app, "reproductor-completo")
        XCTAssertTrue(completo.waitForExistence(timeout: 10), "No abre el reproductor completo")
        let cerrar = elemento(app, "boton-cerrar-completa")
        if !cerrar.waitForExistence(timeout: 3) { completo.tap() }
        XCTAssertTrue(cerrar.waitForExistence(timeout: 5))
        cerrar.tap()
        XCTAssertTrue(mini.waitForExistence(timeout: 10), "Al cerrar vuelve el mini")

        // Detener desde el mini lo quita.
        elemento(app, "mini-detener").tap()
        let desaparece = NSPredicate(format: "exists == false")
        expectation(for: desaparece, evaluatedWith: mini)
        waitForExpectations(timeout: 10)
    }

    @MainActor
    func testBorrarUnFavoritoYDeshacer() throws {
        let app = lanzar()
        let pestana = app.tabBars.buttons["Biblioteca"]
        XCTAssertTrue(pestana.waitForExistence(timeout: 60))
        pestana.tap()

        let favorito = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Canal Favorito")).firstMatch
        XCTAssertTrue(favorito.waitForExistence(timeout: 20), "No aparece el favorito")
        favorito.swipeLeft()
        // Un deslizamiento largo puede borrar del tirón; si no, aparece el botón.
        let borrar = app.buttons["Borrar"]
        if borrar.waitForExistence(timeout: 3) { borrar.tap() }

        let desaparece = NSPredicate(format: "exists == false")
        expectation(for: desaparece, evaluatedWith: favorito)
        waitForExpectations(timeout: 10)

        let deshacer = elemento(app, "aviso-accion")
        XCTAssertTrue(deshacer.waitForExistence(timeout: 5), "No se ofrece deshacer")
        deshacer.tap()

        let vuelve = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Canal Favorito")).firstMatch
        XCTAssertTrue(vuelve.waitForExistence(timeout: 10), "Deshacer no lo devuelve")
    }
}
