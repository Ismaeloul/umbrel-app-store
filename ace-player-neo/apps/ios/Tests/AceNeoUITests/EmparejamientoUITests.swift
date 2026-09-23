import XCTest

/// Flujo de emparejamiento contra el servidor simulado de la app
/// (`-AceNeoServidorSimulado`: sin red, sin Llavero y sin tocar lo guardado).
final class EmparejamientoUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    private func lanzar() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AceNeoServidorSimulado"]
        app.launch()
        return app
    }

    @MainActor
    func testArrancaEnLaPantallaDeEmparejar() throws {
        let app = lanzar()
        let codigo = app.textFields["campo-codigo"]
        XCTAssertTrue(codigo.waitForExistence(timeout: 60), "No aparece la pantalla de emparejamiento")
        XCTAssertTrue(app.textFields["campo-lan"].exists)
        XCTAssertTrue(app.textFields["campo-tailscale"].exists)
        XCTAssertTrue(app.buttons["boton-escanear"].exists)
        let emparejar = app.buttons["boton-emparejar"]
        XCTAssertTrue(emparejar.exists)
        XCTAssertFalse(emparejar.isEnabled, "Sin dirección ni código no se puede emparejar")
    }

    @MainActor
    func testEmparejarConElCodigoLlevaALaAgenda() throws {
        let app = lanzar()
        let lan = app.textFields["campo-lan"]
        XCTAssertTrue(lan.waitForExistence(timeout: 60))
        lan.tap()
        lan.typeText("umbrel.local:7792")

        let codigo = app.textFields["campo-codigo"]
        codigo.tap()
        codigo.typeText("482913")

        let emparejar = app.buttons["boton-emparejar"]
        XCTAssertTrue(emparejar.isEnabled)
        emparejar.tap()

        let partido = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "Equipo Local"))
            .firstMatch
        XCTAssertTrue(partido.waitForExistence(timeout: 30), "No aparece la agenda tras emparejar")
        XCTAssertTrue(app.navigationBars["Agenda"].exists)
        // La agenda justo tras emparejar (con la transición desde la pantalla de emparejar).
        Thread.sleep(forTimeInterval: 1.5)
        let adjunto = XCTAttachment(screenshot: app.screenshot())
        adjunto.name = "emparejar-02-agenda-tras-emparejar"
        adjunto.lifetime = .keepAlways
        add(adjunto)
    }

    @MainActor
    func testUnCodigoIncorrectoSeExplicaEnEspanol() throws {
        let app = lanzar()
        let lan = app.textFields["campo-lan"]
        XCTAssertTrue(lan.waitForExistence(timeout: 60))
        lan.tap()
        lan.typeText("umbrel.local:7792")
        let codigo = app.textFields["campo-codigo"]
        codigo.tap()
        codigo.typeText("111111")
        app.buttons["boton-emparejar"].tap()

        let error = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "El código no es correcto"))
            .firstMatch
        XCTAssertTrue(error.waitForExistence(timeout: 20), "No se explica el error del código")
        XCTAssertTrue(app.textFields["campo-codigo"].exists, "Tiene que seguir en la pantalla de emparejar")
    }
}
