import XCTest

/// Flujos de la agenda (b-arquitectura §3.6, M5) contra la demo de la app (`-AceNeoDemo`): la tira de días y
/// el cambio de día (tocando y deslizando), «Para ti / Todos», destapar el marcador, tirar para actualizar,
/// la hoja de gustos desde el lápiz y la tarjeta que abre el teatro.
final class FlujoAgendaUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Hoy y mañana en Madrid (`YYYY-MM-DD`), como los pone la demo.
    private func dia(_ masDias: Int) -> String {
        var calendario = Calendar(identifier: .gregorian)
        calendario.timeZone = TimeZone(identifier: "Europe/Madrid") ?? .current
        let fecha = calendario.date(byAdding: .day, value: masDias, to: Date()) ?? Date()
        let c = calendario.dateComponents([.year, .month, .day], from: fecha)
        return String(format: "%04d-%02d-%02d", c.year ?? 2026, c.month ?? 1, c.day ?? 1)
    }

    @MainActor
    private func arrancar() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AceNeoDemo"]
        app.launch()
        XCTAssertTrue(elementoUI(app, IDUI.pantalla("agenda")).waitForExistence(timeout: 20), "No se ve la agenda")
        XCTAssertTrue(elementoUI(app, IDUI.dia(dia(0))).waitForExistence(timeout: 20), "No llega la tira de días")
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
    func testTiraDeDiasYDiaSiguiente() throws {
        let app = arrancar()
        let hoy = elementoUI(app, IDUI.dia(dia(0)))
        XCTAssertTrue(hoy.isSelected, "Al abrir, el día elegido es hoy")
        XCTAssertTrue(elementoUI(app, IDUI.heroe).waitForExistence(timeout: 10), "No hay héroe")
        captura(app, "agenda-hoy")

        elementoUI(app, IDUI.dia(dia(1))).tap()
        let tarjetaManana = elementoUI(app, IDUI.tarjetaPartido("demo-6"))
        XCTAssertTrue(tarjetaManana.waitForExistence(timeout: 10), "Mañana no enseña su partido")
        XCTAssertTrue(elementoUI(app, IDUI.dia(dia(1))).isSelected)

        // Deslizar a la derecha sobre la lista vuelve al día anterior. Mañana tiene dos partidos de LaLiga en un
        // carril que se desplaza de lado, así que se desliza sobre la cabecera del bloque («LaLiga · 2»), que no se
        // mueve. Su elemento es el de la cabecera (el marco de la tarjeta lleva la sombra y empieza por encima
        // del bloque: desde ahí el dedo caía fuera del panel, CI 36232007098). Antes se sube la página.
        let pantalla = elementoUI(app, IDUI.pantalla("agenda"))
        arrastrar(pantalla, desde: CGVector(dx: 0.5, dy: 0.75), hasta: CGVector(dx: 0.5, dy: 0.35))
        XCTAssertTrue(tarjetaManana.isHittable, "La tarjeta de mañana no queda a la vista")
        let rotulo = app.staticTexts.matching(NSPredicate(format: "label == %@", "LaLiga, 2 partidos")).firstMatch
        XCTAssertTrue(rotulo.waitForExistence(timeout: 5), "No se ve la cabecera del bloque de LaLiga")
        let cabecera = rotulo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        cabecera.press(forDuration: 0.05, thenDragTo: cabecera.withOffset(CGVector(dx: 260, dy: 0)))
        XCTAssertTrue(elementoUI(app, IDUI.tarjetaPartido("demo-12")).waitForExistence(timeout: 10), "Deslizar no vuelve a hoy")
        XCTAssertTrue(elementoUI(app, IDUI.dia(dia(0))).isSelected)
        captura(app, "agenda-deslizada")
    }

    @MainActor
    func testFiltroParaTiYTodos() throws {
        let app = arrancar()
        let paraTi = elementoUI(app, IDUI.filtroParaTi)
        XCTAssertTrue(paraTi.waitForExistence(timeout: 10))
        // El filtro queda bajo la barra de pestañas con el héroe entero (como en la web): se sube la agenda.
        if !paraTi.isHittable {
            arrastrar(elementoUI(app, IDUI.pantalla("agenda")), desde: CGVector(dx: 0.5, dy: 0.75), hasta: CGVector(dx: 0.5, dy: 0.45))
        }
        XCTAssertTrue(paraTi.isSelected, "Con gustos y sin tocar, «Para ti»")
        let reserva = elementoUI(app, IDUI.tarjetaPartido("demo-2"))
        XCTAssertFalse(reserva.exists, "Barcelona SC – Emelec (amistoso) no es de «Para ti»")

        elementoUI(app, IDUI.filtroTodos).tap()
        XCTAssertTrue(elementoUI(app, IDUI.filtroTodos).isSelected)
        let visible = reserva.waitForExistence(timeout: 5) || app.desplazarHasta(reserva)
        XCTAssertTrue(visible || elementoUI(app, IDUI.tarjetaPartido("demo-2")).exists, "«Todos» enseña el amistoso")
        captura(app, "agenda-todos")

        elementoUI(app, IDUI.filtroParaTi).tap()
        XCTAssertTrue(esperarQueDesaparezca(elementoUI(app, IDUI.tarjetaPartido("demo-2"))), "«Para ti» vuelve a filtrar")
    }

    @MainActor
    func testDestaparMarcador() throws {
        let app = arrancar()
        let capsula = elementoUI(app, IDUI.capsulaMarcador)
        guard capsula.waitForExistence(timeout: 12) else {
            throw XCTSkip("La demo provisional (ServidorSimulado) no trae `start`: no se piden marcadores (llega con la demo de M2)")
        }
        XCTAssertTrue(capsula.label.hasPrefix("Ver marcador"), capsula.label)
        capsula.tap()
        XCTAssertTrue(elementoUI(app, IDUI.capsulaMarcador).label.hasPrefix("Tapar el marcador"), "No se destapa")
        captura(app, "agenda-marcador-destapado")
        elementoUI(app, IDUI.capsulaMarcador).tap()
        XCTAssertTrue(elementoUI(app, IDUI.capsulaMarcador).label.hasPrefix("Ver marcador"), "No se vuelve a tapar")
    }

    @MainActor
    func testTirarParaActualizar() throws {
        let app = arrancar()
        let pantalla = elementoUI(app, IDUI.pantalla("agenda"))
        arrastrar(pantalla, desde: CGVector(dx: 0.5, dy: 0.3), hasta: CGVector(dx: 0.5, dy: 0.8))
        XCTAssertTrue(elementoUI(app, IDUI.heroe).waitForExistence(timeout: 15), "Tras actualizar sigue la agenda")
        XCTAssertTrue(elementoUI(app, IDUI.dia(dia(0))).waitForExistence(timeout: 10))
    }

    @MainActor
    func testGustosDesdeElLapiz() throws {
        let app = arrancar()
        let lapiz = elementoUI(app, IDUI.botonEditarGustos)
        XCTAssertTrue(lapiz.waitForExistence(timeout: 10))
        lapiz.tap()
        XCTAssertTrue(elementoUI(app, IDUI.hojaGustos).waitForExistence(timeout: 10), "No se abre «¿Qué fútbol te mueve?»")
        XCTAssertTrue(conTextoUI(app, "¿Qué fútbol te mueve?").exists)
        XCTAssertTrue(conTextoUI(app, "Tus ligas").exists)
        captura(app, "preferencias")
        app.buttons["Cancelar"].firstMatch.tap()
        XCTAssertTrue(esperarQueDesaparezca(elementoUI(app, IDUI.hojaGustos)), "«Cancelar» no cierra la hoja")
    }

    @MainActor
    func testTarjetaAbreElTeatro() throws {
        let app = arrancar()
        elementoUI(app, IDUI.filtroTodos).tap()
        let tarjeta = elementoUI(app, IDUI.tarjetaPartido("demo-1"))
        XCTAssertTrue(tarjeta.waitForExistence(timeout: 10), "No hay tarjeta de demo-1")
        XCTAssertTrue(tarjeta.label.contains("canal para"), tarjeta.label)
        tarjeta.tap()
        XCTAssertTrue(elementoUI(app, IDUI.teatro).waitForExistence(timeout: 10), "La tarjeta no abre el partido")
    }
}

private extension XCUIApplication {
    /// Desplaza la lista hacia abajo hasta que el elemento exista (o se rinde).
    @MainActor
    func desplazarHasta(_ elemento: XCUIElement) -> Bool {
        for _ in 0..<4 where !elemento.exists { swipeUp() }
        return elemento.exists
    }
}
