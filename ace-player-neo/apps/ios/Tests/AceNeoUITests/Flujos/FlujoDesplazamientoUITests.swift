import XCTest

/// Desplazar la Agenda y Canales (M4 y M5), lo que Isma vio en su iPhone con la previa:
///
/// - en Canales la lista no subía ni bajaba hasta mover antes el dedo de lado;
/// - en la Agenda, empezar sobre un partido movía el carril en vez de la página;
/// - el desplazamiento iba a tirones: las dos pruebas de rendimiento miden los tirones al arrastrar y al frenar
///   (`XCTOSSignpostMetric.scrollingAndDecelerationMetric`; en el simulador solo da la duración) y los fotogramas
///   que llegan tarde en el hilo principal con el medidor de la app (`-AceNeoMedirTirones`). La CI saca las
///   métricas en «Resumen de los tests» y los tirones van como adjunto `tirones-*` en las capturas.
final class FlujoDesplazamientoUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    private func arrancar(_ argumentos: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AceNeoDemo"] + argumentos
        app.launch()
        XCTAssertTrue(elementoUI(app, IDUI.pantalla("agenda")).waitForExistence(timeout: 20), "No se ve la agenda")
        return app
    }

    @MainActor
    private func arrancarEnCanales(_ argumentos: [String] = []) -> XCUIApplication {
        let app = arrancar(["-AceNeoListaLarga"] + argumentos)
        tocarPestana(app, "biblioteca")
        XCTAssertTrue(elementoUI(app, IDUI.pantalla("biblioteca")).waitForExistence(timeout: 15), "No se ve Canales")
        XCTAssertTrue(elementoUI(app, IDUI.pestanaFavoritos).waitForExistence(timeout: 15), "No llegan las pestañas")
        return app
    }

    /// La primera tarjeta de partido que se ve entera en la pantalla.
    @MainActor
    private func tarjetaALaVista(_ app: XCUIApplication) -> XCUIElement? {
        let tarjetas = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "tarjeta-partido-"))
        let alto = app.frame.height
        for i in 0..<tarjetas.count {
            let t = tarjetas.element(boundBy: i)
            if t.frame.minY > 80 && t.frame.maxY < alto - 120 && t.frame.minX >= 0 { return t }
        }
        return nil
    }

    /// Un arrastre de verdad (no un golpe): del punto a 280 pt más arriba, con 12 pt de lado como un dedo.
    @MainActor
    private func subirDesde(_ punto: XCUICoordinate) {
        punto.press(forDuration: 0.05, thenDragTo: punto.withOffset(CGVector(dx: 12, dy: -280)))
    }

    @MainActor
    func testAgendaSubeAunqueElDedoEmpieceSobreUnPartido() throws {
        let app = arrancar()
        let pantalla = elementoUI(app, IDUI.pantalla("agenda"))
        // Con el héroe entero las tarjetas quedan abajo: primero se sube un poco desde el héroe.
        if tarjetaALaVista(app) == nil {
            arrastrar(pantalla, desde: CGVector(dx: 0.5, dy: 0.35), hasta: CGVector(dx: 0.5, dy: 0.1))
        }
        guard let tarjeta = tarjetaALaVista(app) else { return XCTFail("No hay ninguna tarjeta a la vista") }
        let antes = tarjeta.frame
        subirDesde(tarjeta.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)))
        let despues = tarjeta.frame
        XCTAssertLessThan(despues.minY, antes.minY - 120, "La página no sube empezando sobre un partido (\(antes) → \(despues))")
        XCTAssertLessThan(abs(despues.minX - antes.minX), 20, "El carril se movió de lado (\(antes) → \(despues))")
    }

    @MainActor
    func testCanalesSubeALaPrimeraSobreUnaFila() throws {
        let app = arrancarEnCanales()
        let fila = elementoUI(app, IDUI.filaCanal("a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"))
        XCTAssertTrue(fila.waitForExistence(timeout: 10), "No sale «DAZN 1»")
        let antes = fila.frame
        let punto = fila.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        punto.press(forDuration: 0.05, thenDragTo: punto.withOffset(CGVector(dx: 0, dy: -280)))
        XCTAssertLessThan(fila.frame.minY, antes.minY - 120, "Canales no sube en vertical a la primera (\(antes) → \(fila.frame))")
        XCTAssertTrue(elementoUI(app, IDUI.pestanaFavoritos).isSelected, "Subir no cambia de pestaña")
    }

    @MainActor
    func testRendimientoDesplazarAgenda() throws {
        let app = arrancar(["-AceNeoMedirTirones"])
        let lista = elementoUI(app, IDUI.pantalla("agenda"))
        contarTirones(app, lista, nombre: "tirones-agenda")
        medirDesplazamiento(lista)
    }

    @MainActor
    func testRendimientoDesplazarCanales() throws {
        let app = arrancarEnCanales(["-AceNeoMedirTirones"])
        let lista = elementoUI(app, IDUI.pantalla("biblioteca"))
        contarTirones(app, lista, nombre: "tirones-canales")
        medirDesplazamiento(lista)
    }

    /// Lo que marca el medidor de la app: fotogramas, tirones, décimas de ms de retraso y ms transcurridos.
    @MainActor
    private func leerMedidor(_ app: XCUIApplication) -> [Int] {
        let medidor = elementoUI(app, IDUI.medidorTirones)
        guard medidor.waitForExistence(timeout: 5), let valor = medidor.value as? String else { return [0, 0, 0, 0] }
        let numeros = valor.split(separator: " ").compactMap { (trozo: Substring) -> Int? in Int(trozo) }
        return numeros.count == 4 ? numeros : [0, 0, 0, 0]
    }

    /// Diez golpes (arriba y abajo) y lo que se retrasaron los fotogramas mientras tanto, como adjunto.
    @MainActor
    private func contarTirones(_ app: XCUIApplication, _ lista: XCUIElement, nombre: String) {
        let antes = leerMedidor(app)
        for _ in 0..<5 {
            lista.swipeUp(velocity: .fast)
            lista.swipeDown(velocity: .fast)
        }
        let despues = leerMedidor(app)
        let fotogramas = despues[0] - antes[0]
        let tirones = despues[1] - antes[1]
        let ms = Double(despues[2] - antes[2]) / 10
        let segundos = Double(despues[3] - antes[3]) / 1000
        let razon = segundos > 0 ? ms / segundos : 0
        let texto = "\(nombre): fotogramas=\(fotogramas) tirones=\(tirones) retraso=\(ms) ms en \(segundos) s → \(razon) ms/s"
        let adjunto = XCTAttachment(string: texto)
        adjunto.name = nombre
        adjunto.lifetime = .keepAlways
        add(adjunto)
        XCTAssertGreaterThan(fotogramas, 0, "El medidor de tirones no cuenta fotogramas (\(texto))")
    }

    /// Cinco golpes hacia arriba medidos (arrastre y frenada) y, sin medir, vuelta arriba.
    @MainActor
    private func medirDesplazamiento(_ lista: XCUIElement) {
        let opciones = XCTMeasureOptions()
        opciones.invocationOptions = [.manuallyStop]
        opciones.iterationCount = 5
        measure(metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric], options: opciones) {
            lista.swipeUp(velocity: .fast)
            stopMeasuring()
            lista.swipeDown(velocity: .fast)
        }
    }
}
