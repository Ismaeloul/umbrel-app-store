import XCTest

/// Flujos del teatro (b-arquitectura §3.7, M6) con la demo (`-AceNeoDemo`) y el motor simulado. Se entra por
/// `-AceNeoEscena` (partido o canal suelto) para no depender de la agenda. Lo que necesita fuentes de la sesión
/// (elegir un cartel, deslizar a otra fuente) se salta si la sesión de fuentes aún no las da (M3).
final class FlujoTeatroUITests: XCTestCase {
    /// «DAZN 1», el favorito de la demo de la web (fixtures v1/libraryGet).
    private let canal = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"

    /// Hoy a las 18:45 en Madrid (la demo ancla sus partidos de hoy a la hora de arranque).
    private func relojDemo() -> String {
        var calendario = Calendar(identifier: .gregorian)
        calendario.timeZone = TimeZone(identifier: "Europe/Madrid") ?? .current
        let hoy = calendario.dateComponents([.year, .month, .day], from: Date())
        return String(format: "%04d-%02d-%02dT18:45:00+02:00", hoy.year ?? 2026, hoy.month ?? 1, hoy.day ?? 1)
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    private func abrir(_ vista: String, tema: String = "oscuro") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-AceNeoDemo", "-AceNeoMovimientoReducido", "-AceNeoApariencia", tema, "-AceNeoEscena", vista,
            "-AceNeoReloj", relojDemo(),
        ]
        app.launch()
        XCTAssertTrue(elementoUI(app, IDUI.videoTeatro).waitForExistence(timeout: 20), "No se abre el teatro de \(vista)")
        return app
    }

    @MainActor
    private func captura(_ app: XCUIApplication, _ nombre: String) {
        Thread.sleep(forTimeInterval: 1)
        let adjunto = XCTAttachment(screenshot: app.screenshot())
        adjunto.name = nombre
        adjunto.lifetime = .keepAlways
        add(adjunto)
    }

    /// Los controles vuelven si se habían escondido (un toque en el vídeo los alterna).
    @MainActor
    private func controles(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        let boton = elementoUI(app, id)
        if !boton.waitForExistence(timeout: 3) || !boton.isHittable {
            elementoUI(app, IDUI.videoTeatro).tap()
        }
        return boton
    }

    /// Partido de la demo: cabecera, cápsula del marcador tapada que se destapa, pestañas y datos técnicos.
    @MainActor
    func testAbrirPartidoDemo() throws {
        for tema in ["oscuro", "claro"] {
            let app = abrir("partido/demo-4", tema: tema)
            XCTAssertTrue(elementoUI(app, IDUI.cabeceraPartido).waitForExistence(timeout: 15), "Sin cabecera del partido")
            XCTAssertTrue(conTextoUI(app, "Real Sociedad").exists, "La cabecera no dice los equipos")
            XCTAssertTrue(elementoUI(app, IDUI.pestanaFuentes).exists, "Sin pestaña Fuentes")
            XCTAssertTrue(elementoUI(app, IDUI.capsulaMarcador).waitForExistence(timeout: 10), "Sin cápsula del marcador")
            captura(app, "teatro-partido-\(tema)")
            // La demo de la fase 0 pone el partido a una hora fija de HOY: el marcador solo se pide cerca de esa
            // hora (`scoresWanted`), así que tapado y destapado se prueban cuando lo hay.
            let marcador = app.buttons["Ver marcador"]
            if marcador.waitForExistence(timeout: 5) {
                marcador.tap()
                XCTAssertTrue(
                    app.buttons["Tapar el marcador (tu emisión va por detrás)"].waitForExistence(timeout: 5), "No se destapa")
            }
            elementoUI(app, IDUI.pestanaPartido).tap()
            XCTAssertTrue(conTextoUI(app, "M+ LaLiga").waitForExistence(timeout: 5), "Sin la pestaña Partido (Dónde se emite)")
            captura(app, "teatro-partido-pestana-partido-\(tema)")
            elementoUI(app, IDUI.pestanaDatos).tap()
            XCTAssertTrue(elementoUI(app, IDUI.panelDatosTecnicos).waitForExistence(timeout: 5), "Sin datos técnicos")
            app.terminate()
        }
    }

    /// Canal suelto: arranca solo, controles, favorito, «Canal» con su ficha y datos técnicos.
    @MainActor
    func testCanalSueltoArrancaYEnsenaSusPestanas() throws {
        for tema in ["oscuro", "claro"] {
            let app = abrir("partido/canal/\(canal)", tema: tema)
            XCTAssertTrue(elementoUI(app, IDUI.cabeceraCanal).waitForExistence(timeout: 15), "Sin cabecera del canal")
            XCTAssertTrue(conTextoUI(app, "DAZN 1").exists, "La cabecera no dice el canal")
            XCTAssertTrue(conTextoUI(app, "En tus favoritos").exists, "No dice de dónde viene")
            XCTAssertTrue(controles(app, IDUI.botonPausa).waitForExistence(timeout: 15), "Sin pausa grande")
            XCTAssertTrue(conTextoUI(app, "Solo esta").waitForExistence(timeout: 5), "La ficha no dice «Solo esta»")
            captura(app, "teatro-canal-\(tema)")
            elementoUI(app, IDUI.pestanaDatos).tap()
            XCTAssertTrue(elementoUI(app, IDUI.panelDatosTecnicos).waitForExistence(timeout: 5), "Sin datos técnicos")
            captura(app, "teatro-canal-datos-\(tema)")
            app.terminate()
        }
    }

    /// Reportar desde el inspector abre la hoja con «No arranca» y «Reportar y comprobar» la cierra.
    @MainActor
    func testReportar() throws {
        let app = abrir("partido/canal/\(canal)")
        let reportar = app.buttons["Reportar"].firstMatch
        XCTAssertTrue(reportar.waitForExistence(timeout: 15), "Sin «Reportar» en el inspector")
        reportar.tap()
        XCTAssertTrue(elementoUI(app, IDUI.hojaReportar).waitForExistence(timeout: 5), "No se abre «Reportar fuente»")
        XCTAssertTrue(conTextoUI(app, "No arranca").exists)
        captura(app, "teatro-hoja-reportar")
        app.buttons["Reportar y comprobar"].tap()
        XCTAssertTrue(esperarQueDesaparezca(elementoUI(app, IDUI.hojaReportar), plazo: 8), "La hoja no se cierra")
    }

    /// Doble toque en el vídeo: pantalla completa (inmersivo) y otro doble toque vuelve.
    @MainActor
    func testDobleToquePantallaCompletaYVuelta() throws {
        let app = abrir("partido/canal/\(canal)")
        XCTAssertTrue(controles(app, IDUI.botonPausa).waitForExistence(timeout: 15))
        let video = elementoUI(app, IDUI.videoTeatro)
        video.doubleTap()
        let salir = app.buttons["Salir de pantalla completa"].firstMatch
        if !salir.waitForExistence(timeout: 5) { elementoUI(app, IDUI.videoTeatro).tap() }
        XCTAssertTrue(salir.waitForExistence(timeout: 5), "El doble toque no pone la pantalla completa")
        captura(app, "teatro-pantalla-completa")
        elementoUI(app, IDUI.videoTeatro).firstMatch.doubleTap()
        XCTAssertTrue(esperarQueDesaparezca(salir, plazo: 8), "El segundo doble toque no quita la pantalla completa")
    }

    /// Deslizar el vídeo a un lado cambia de fuente (necesita dos fuentes visibles en la sesión).
    @MainActor
    func testDeslizarDeLadoCambiaDeFuente() throws {
        let app = abrir("partido/demo-1")
        let segundo = elementoUI(app, IDUI.cartelFuente(2))
        try XCTSkipUnless(segundo.waitForExistence(timeout: 20), "La sesión de fuentes aún no da carteles (M3)")
        let video = elementoUI(app, IDUI.videoTeatro)
        arrastrar(video, desde: CGVector(dx: 0.8, dy: 0.5), hasta: CGVector(dx: 0.1, dy: 0.5))
        XCTAssertTrue(conTextoUI(app, "Fuente 2, ").waitForExistence(timeout: 10), "No pasa a la fuente 2")
    }

    /// Elegir un cartel lo pone «En pantalla».
    @MainActor
    func testElegirFuente() throws {
        let app = abrir("partido/demo-1")
        let primero = elementoUI(app, IDUI.cartelFuente(1))
        try XCTSkipUnless(primero.waitForExistence(timeout: 20), "La sesión de fuentes aún no da carteles (M3)")
        primero.tap()
        XCTAssertTrue(conTextoUI(app, "En pantalla").waitForExistence(timeout: 15), "El cartel no queda en pantalla")
        captura(app, "teatro-partido-fuentes")
    }
}
