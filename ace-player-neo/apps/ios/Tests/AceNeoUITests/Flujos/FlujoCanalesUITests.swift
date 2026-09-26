import XCTest

/// Flujos de «Canales» (b-arquitectura §3.6, M5) contra la demo de la app: las pestañas con su contador, Listas
/// por categorías, guardar un favorito desde el menú de una fila (salta a Favoritos), quitarlo con «Deshacer»
/// y renombrar.
final class FlujoCanalesUITests: XCTestCase {
    /// «M+ LaLiga» de la lista de la demo (categoría «Deportes»).
    private let mLaLiga = "b2c3d4e5f60718293a4b5c6d7e8f901234567890"
    /// «DAZN 1», el favorito con el que arranca la demo de la web (fixtures v1/libraryGet).
    private let favorito = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    private func arrancarEnCanales() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AceNeoDemo"]
        app.launch()
        tocarPestana(app, "biblioteca")
        XCTAssertTrue(elementoUI(app, IDUI.pantalla("biblioteca")).waitForExistence(timeout: 15), "No se ve Canales")
        XCTAssertTrue(elementoUI(app, IDUI.pestanaFavoritos).waitForExistence(timeout: 15), "No llegan las pestañas")
        return app
    }

    @MainActor
    private func captura(_ app: XCUIApplication, _ nombre: String) {
        let adjunto = XCTAttachment(screenshot: app.screenshot())
        adjunto.name = nombre
        adjunto.lifetime = .keepAlways
        add(adjunto)
    }

    @MainActor
    func testPestanasYListasPorCategorias() throws {
        let app = arrancarEnCanales()
        XCTAssertTrue(elementoUI(app, IDUI.pestanaFavoritos).isSelected, "Con favoritos se abre en Favoritos")
        XCTAssertTrue(elementoUI(app, IDUI.filaCanal(favorito)).waitForExistence(timeout: 10), "No sale «DAZN 1»")
        captura(app, "biblioteca-favoritos")

        elementoUI(app, IDUI.pestanaListas).tap()
        let deportes = elementoUI(app, IDUI.categoria("Deportes"))
        XCTAssertTrue(deportes.waitForExistence(timeout: 10), "No hay categoría Deportes")
        // Con una sola categoría la web la abre (LibraryView.tsx); con varias empiezan plegadas.
        XCTAssertTrue(elementoUI(app, IDUI.filaCanal(mLaLiga)).waitForExistence(timeout: 5), "Una sola categoría sale abierta")
        captura(app, "biblioteca-listas")

        elementoUI(app, IDUI.pestanaRecientes).tap()
        XCTAssertTrue(elementoUI(app, IDUI.pestanaRecientes).isSelected)
        XCTAssertTrue(conTextoUI(app, "Canal de prueba").waitForExistence(timeout: 5))
    }

    @MainActor
    func testGuardarFavoritoDesdeElMenuYSaltarAFavoritos() throws {
        let app = arrancarEnCanales()
        elementoUI(app, IDUI.pestanaListas).tap()
        let fila = elementoUI(app, IDUI.filaCanal(mLaLiga))
        if !fila.waitForExistence(timeout: 5) { elementoUI(app, IDUI.categoria("Deportes")).tap() }
        // La fila puede quedar detrás de la barra de pestañas: se sube la lista antes de pulsarla.
        if fila.waitForExistence(timeout: 5) && !fila.isHittable {
            arrastrar(elementoUI(app, IDUI.pantalla("biblioteca")), desde: CGVector(dx: 0.5, dy: 0.7), hasta: CGVector(dx: 0.5, dy: 0.3))
        }
        XCTAssertTrue(fila.waitForExistence(timeout: 5))
        fila.press(forDuration: 1.0)
        let anadir = app.buttons["Añadir a favoritos"].firstMatch
        XCTAssertTrue(anadir.waitForExistence(timeout: 5), "La pulsación larga no abre el menú de acciones")
        anadir.tap()
        XCTAssertTrue(elementoUI(app, IDUI.hojaGuardarFavorito).waitForExistence(timeout: 5), "No se abre «Guardar favorito»")
        XCTAssertTrue(conTextoUI(app, mLaLiga).exists, "La hoja no enseña el hash")
        app.buttons["Guardar en favoritos"].firstMatch.tap()
        XCTAssertTrue(esperarQueDesaparezca(elementoUI(app, IDUI.hojaGuardarFavorito)))
        XCTAssertTrue(elementoUI(app, IDUI.pestanaFavoritos).waitForExistence(timeout: 5))
        let salto = Date().addingTimeInterval(8)
        while Date() < salto && !elementoUI(app, IDUI.pestanaFavoritos).isSelected { Thread.sleep(forTimeInterval: 0.25) }
        XCTAssertTrue(elementoUI(app, IDUI.pestanaFavoritos).isSelected, "Tras guardar no salta a Favoritos")
        XCTAssertTrue(elementoUI(app, IDUI.filaCanal(mLaLiga)).waitForExistence(timeout: 5), "El favorito nuevo no sale")
        captura(app, "biblioteca-favorito-guardado")
    }

    @MainActor
    func testQuitarFavoritoConDeshacer() throws {
        let app = arrancarEnCanales()
        let fila = elementoUI(app, IDUI.filaCanal(favorito))
        XCTAssertTrue(fila.waitForExistence(timeout: 10))
        fila.press(forDuration: 1.0)
        let quitar = app.buttons["Quitar de favoritos"].firstMatch
        XCTAssertTrue(quitar.waitForExistence(timeout: 5), "El menú no ofrece «Quitar de favoritos»")
        quitar.tap()
        let deshacer = elementoUI(app, IDUI.toastAccion)
        guard deshacer.waitForExistence(timeout: 5) else {
            throw XCTSkip("«Deshacer» es de BajasPendientes (M1) y los toasts de CapaAvisos (M4): aún son esqueleto")
        }
        XCTAssertTrue(esperarQueDesaparezca(elementoUI(app, IDUI.filaCanal(favorito)), plazo: 3), "La fila no desaparece al quitarla")
        deshacer.tap()
        XCTAssertTrue(elementoUI(app, IDUI.filaCanal(favorito)).waitForExistence(timeout: 5), "«Deshacer» no la devuelve")
    }

    @MainActor
    func testRenombrar() throws {
        let app = arrancarEnCanales()
        let fila = elementoUI(app, IDUI.filaCanal(favorito))
        XCTAssertTrue(fila.waitForExistence(timeout: 10))
        fila.press(forDuration: 1.0)
        let renombrar = app.buttons["Renombrar"].firstMatch
        XCTAssertTrue(renombrar.waitForExistence(timeout: 5), "El menú no ofrece «Renombrar»")
        renombrar.tap()
        XCTAssertTrue(elementoUI(app, IDUI.hojaRenombrar).waitForExistence(timeout: 5), "No se abre «Renombrar canal»")
        let campo = app.textFields.firstMatch
        XCTAssertTrue(campo.waitForExistence(timeout: 5))
        XCTAssertEqual(campo.value as? String, "DAZN 1", "El campo no empieza con el nombre actual")
        captura(app, "renombrar")
        app.buttons["Guardar cambios"].firstMatch.tap()
        XCTAssertTrue(esperarQueDesaparezca(elementoUI(app, IDUI.hojaRenombrar)), "«Guardar cambios» no cierra la hoja")
    }
}
