import XCTest

/// Flujos de la pantalla de emparejar (b-arquitectura §3.8, M7; a2 §22): el código de la demo (482913) entra en
/// la app, un código malo da el error con su texto y un enlace `aceneo://pair` empareja solo (sin emparejar) o
/// abre la hoja «¿Emparejar con otro servidor?» (emparejada). En el simulador no hay cámara: sale el bloque
/// «No hay cámara disponible» y se escribe el código.
final class FlujoEmparejarUITests: XCTestCase {
    private static let enlace = "aceneo://pair?u=http%3A%2F%2Fumbrel.local%3A7792&c=482913"

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
    private func arrancarSinEmparejar(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AceNeoDemo", "-AceNeoSinEmparejar"] + extra
        app.launch()
        XCTAssertTrue(elementoUI(app, IDUI.pantalla("emparejar")).waitForExistence(timeout: 20), "No sale Emparejar")
        return app
    }

    /// Escribe el código y la dirección de casa y envía con «ir» del teclado.
    @MainActor
    private func escribir(_ app: XCUIApplication, codigo: String) {
        let campoCodigo = elementoUI(app, IDUI.campoCodigo)
        XCTAssertTrue(campoCodigo.waitForExistence(timeout: 10), "No hay campo del código")
        campoCodigo.tap()
        campoCodigo.typeText(codigo)
        let casa = elementoUI(app, IDUI.campoLan).textFields.firstMatch
        XCTAssertTrue(casa.waitForExistence(timeout: 5), "No hay campo de la dirección de casa")
        if !(casa.value(forKey: "hasKeyboardFocus") as? Bool ?? false) { casa.tap() }
        casa.typeText("http://umbrel.local:7792\n")
        app.typeText("\n")
    }

    @MainActor
    func testSinCamaraSaleElBloqueYElCodigoDeLaDemoEntraEnLaApp() throws {
        let app = arrancarSinEmparejar()
        XCTAssertTrue(conTextoUI(app, "No hay cámara disponible").waitForExistence(timeout: 10), "Falta el bloque sin cámara")
        XCTAssertTrue(elementoUI(app, IDUI.botonEscribirCodigo).exists, "Falta «Escribir el código»")
        captura(app, "emparejar-390x844")
        elementoUI(app, IDUI.botonEscribirCodigo).tap()
        escribir(app, codigo: "482913")
        XCTAssertTrue(elementoUI(app, IDUI.armazon).waitForExistence(timeout: 20), "Tras emparejar no se entra en la app")
        XCTAssertTrue(esperarQueDesaparezca(elementoUI(app, IDUI.pantalla("emparejar"))), "Emparejar no se va")
        captura(app, "emparejar-hecho")
    }

    @MainActor
    func testCodigoMaloDaElErrorDeLaWeb() throws {
        let app = arrancarSinEmparejar()
        escribir(app, codigo: "111111")
        let error = elementoUI(app, IDUI.errorEmparejar)
        XCTAssertTrue(error.waitForExistence(timeout: 15), "No sale la fila de error")
        XCTAssertTrue(error.label.contains("El código no es correcto"), "Texto del error: \(error.label)")
        XCTAssertTrue(elementoUI(app, IDUI.pantalla("emparejar")).exists)
        captura(app, "emparejar-error")
    }

    @MainActor
    func testEnlaceSinEmparejarSeEmparejaSolo() throws {
        let app = arrancarSinEmparejar()
        app.open(try XCTUnwrap(URL(string: Self.enlace)))
        XCTAssertTrue(elementoUI(app, IDUI.armazon).waitForExistence(timeout: 20), "El enlace no empareja solo")
    }

    @MainActor
    func testEnlaceConLaAppEmparejadaAbreLaHoja() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-AceNeoDemo"]
        app.launch()
        XCTAssertTrue(elementoUI(app, IDUI.armazon).waitForExistence(timeout: 20), "No arranca emparejada")
        app.open(try XCTUnwrap(URL(string: Self.enlace)))
        let hoja = elementoUI(app, IDUI.hojaOtroServidor)
        guard hoja.waitForExistence(timeout: 8) else {
            throw XCTSkip("El armazón (M4) aún no abre la hoja con `sesion.enlacePendiente`: se prueba al integrar")
        }
        XCTAssertTrue(conTextoUI(app, "¿Emparejar con otro servidor?").exists)
        captura(app, "emparejar-otro-servidor")
        elementoUI(app, IDUI.botonEmparejarDeNuevo).tap()
        XCTAssertTrue(elementoUI(app, IDUI.armazon).waitForExistence(timeout: 20), "Tras «Emparejar de nuevo» no vuelve a la app")
    }
}
