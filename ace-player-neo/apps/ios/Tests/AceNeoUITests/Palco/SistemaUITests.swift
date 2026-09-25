import XCTest

/// La galería «Sistema» (a1 §11) por tramos de 700 pt, en claro y en oscuro (y el principio con transparencia
/// reducida), para compararla con la galería de la web al mismo desplazamiento (c0-laboratorio.md). Adjuntos:
/// `sistema-<tema>[-reducida]-y<desplazamiento>.png`.
final class SistemaUITests: XCTestCase {
    private static let tramos = Array(stride(from: 0, through: 8400, by: 700))

    override func setUpWithError() throws {
        continueAfterFailure = true
    }

    @MainActor
    private func capturar(tema: String, desplazar: Int, reducida: Bool = false) {
        let app = XCUIApplication()
        var argumentos = ["-AceNeoSistema", "-AceNeoDemo", "-AceNeoApariencia", tema, "-AceNeoMovimientoReducido",
                          "-AceNeoDesplazar", String(desplazar)]
        if reducida { argumentos.append("-AceNeoTransparenciaReducida") }
        app.launchArguments = argumentos
        app.launch()
        XCTAssertTrue(app.staticTexts["Sistema"].waitForExistence(timeout: 20), "No abre la galería")
        Thread.sleep(forTimeInterval: 1.5)
        let adjunto = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        adjunto.name = "sistema-\(tema)\(reducida ? "-reducida" : "")-y\(desplazar)"
        adjunto.lifetime = .keepAlways
        add(adjunto)
        app.terminate()
    }

    @MainActor
    func testGaleriaClara() {
        for y in SistemaUITests.tramos { capturar(tema: "claro", desplazar: y) }
    }

    @MainActor
    func testGaleriaOscura() {
        for y in SistemaUITests.tramos { capturar(tema: "oscuro", desplazar: y) }
    }

    @MainActor
    func testGaleriaConTransparenciaReducida() {
        for y in [0, 3500, 4900] {
            capturar(tema: "claro", desplazar: y, reducida: true)
            capturar(tema: "oscuro", desplazar: y, reducida: true)
        }
    }

    /// Toda primitiva se ve (una comprobación mínima de que la galería entera se pinta sin romper).
    @MainActor
    func testSeccionesDeLaGaleria() {
        let app = XCUIApplication()
        app.launchArguments = ["-AceNeoSistema", "-AceNeoMovimientoReducido"]
        app.launch()
        for titulo in ["Tema y transparencia", "Color", "Tipografía y cifras", "Botones", "Iconos"] {
            let texto = app.staticTexts[titulo]
            for _ in 0..<30 where !texto.exists || !texto.isHittable { app.swipeUp() }
            XCTAssertTrue(texto.exists, "Falta la sección «\(titulo)»")
        }
    }
}
