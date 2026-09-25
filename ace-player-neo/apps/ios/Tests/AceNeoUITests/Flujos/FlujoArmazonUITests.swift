import XCTest

/// Flujos del armazón (b-arquitectura §3.5, M4). La fase 0.3b (I0) deja la primera: la app arranca con
/// la demo en la agenda y la barra de pestañas cambia de pestaña (con las pantallas en stub). M4 añade
/// el resto (conservar el scroll, tocar la activa sube, borde izquierdo, hoja, toast, giro).
final class FlujoArmazonUITests: XCTestCase {
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

    /// La pantalla visible es la de `id` y ninguna otra pestaña se ve.
    @MainActor
    private func comprobarPantalla(_ app: XCUIApplication, _ id: String) {
        let pantalla = elementoUI(app, IDUI.pantalla(id))
        XCTAssertTrue(pantalla.waitForExistence(timeout: 10), "No se ve la pantalla \(id)")
        for otra in ["agenda", "biblioteca", "buscar", "ajustes"] where otra != id {
            XCTAssertFalse(elementoUI(app, IDUI.pantalla(otra)).exists, "Se ve \(otra) estando en \(id)")
        }
        XCTAssertTrue(elementoUI(app, IDUI.pestana(id)).isSelected, "La pestaña \(id) no está marcada")
    }

    @MainActor
    func testArrancaYCambiaDePestana() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-AceNeoDemo"]
        app.launch()

        XCTAssertTrue(elementoUI(app, IDUI.barraPestanas).waitForExistence(timeout: 20), "No hay barra de pestañas")
        comprobarPantalla(app, "agenda")
        captura(app, "armazon-agenda")

        for id in ["biblioteca", "buscar", "ajustes", "agenda"] {
            tocarPestana(app, id)
            comprobarPantalla(app, id)
            captura(app, "armazon-\(id)")
        }
    }
}
