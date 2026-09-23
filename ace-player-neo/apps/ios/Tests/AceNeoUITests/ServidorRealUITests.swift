import XCTest

/// La app DE VERDAD (Llavero, red y AVPlayer) contra el backend DE VERDAD de
/// la pila E2E que la CI levanta en el runner (`scripts/pila-e2e.mjs`: motor
/// AceStream falso + backend del monorepo + ffmpeg para el remux). Recorre:
///
/// 1. emparejar tecleando la dirección y un código recién creado (como desde
///    la web) → agenda de demostración del backend;
/// 2. abrir un partido → el comprobador verifica las fuentes del motor falso →
///    arranque automático → el backend prepara el HLS fMP4 con ffmpeg →
///    AVPlayer lo reproduce en el simulador (primer fotograma real);
/// 3. revocar el dispositivo desde «la web» → la app vuelve a emparejar y
///    explica por qué;
/// 4. volver a emparejar con el enlace del QR (`aceneo://pair?u=…&c=…`).
///
/// Fuera de la CI (sin `ACE_E2E_PUERTO`) se salta.
final class ServidorRealUITests: XCTestCase {
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
    private func elemento(_ app: XCUIApplication, _ identificador: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identificador).firstMatch
    }

    @MainActor
    private func conTexto(_ app: XCUIApplication, _ texto: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", texto)).firstMatch
    }

    /// Espera sin bloquear a que se cumpla una condición (cada medio segundo).
    @MainActor
    private func esperar(_ plazo: TimeInterval, _ condicion: () -> Bool) async -> Bool {
        let limite = Date().addingTimeInterval(plazo)
        while Date() < limite {
            if condicion() { return true }
            try? await Task.sleep(for: .milliseconds(500))
        }
        return condicion()
    }

    /// Lo que dice la pantalla ahora mismo (para que un fallo se entienda en el log de la CI).
    @MainActor
    private func estado(_ app: XCUIApplication) -> String {
        let reproductor = elemento(app, "reproductor-integrado")
        let linea = elemento(app, "linea-estado")
        let error = elemento(app, "error-emparejar")
        return [
            reproductor.exists ? "reproductor: «\(reproductor.label)»" : "sin reproductor",
            linea.exists ? "línea de estado: «\(linea.label)»" : "sin línea de estado",
            error.exists ? "error al emparejar: «\(error.label)»" : "",
        ].filter { !$0.isEmpty }.joined(separator: "; ")
    }

    @MainActor
    private func teclear(_ campo: XCUIElement, _ texto: String) {
        campo.tap()
        if let actual = campo.value as? String, !actual.isEmpty, actual != campo.placeholderValue {
            campo.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: actual.count))
        }
        campo.typeText(texto)
    }

    @MainActor
    func testEmparejarReproducirDeVerdadRevocarYVolverPorElQR() async throws {
        guard let servidor = ServidorDePruebas.desdeEntorno() else {
            throw XCTSkip("Sin backend de pruebas (ACE_E2E_PUERTO): solo corre en la CI, con scripts/pila-e2e.mjs")
        }

        // 1. Emparejar tecleando, como la primera vez en casa.
        let app = XCUIApplication()
        app.launchArguments = ["-AceNeoEmpezarDeCero"]
        app.launch()
        let lan = app.textFields["campo-lan"]
        XCTAssertTrue(lan.waitForExistence(timeout: 60), "No arranca en la pantalla de emparejar")
        let codigo = try await servidor.crearCodigo()
        teclear(lan, servidor.direccionApp)
        teclear(app.textFields["campo-codigo"], codigo.codigo)
        captura(app, "e2e-01-emparejar")
        app.buttons["boton-emparejar"].tap()

        let agenda = app.navigationBars["Agenda"]
        let emparejada = await esperar(45) { agenda.exists }
        XCTAssertTrue(emparejada, "No llega a la agenda tras emparejar con el backend real. \(estado(app))")

        // La tira de días con la agenda real (varios días): el primero (hoy) se ve.
        // Si no, se sigue igualmente para probar el resto y el fallo queda anotado.
        let primerDia = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "dia-")).firstMatch
        let tiraVisible = await esperar(15) { primerDia.exists && primerDia.isHittable }
        if !tiraVisible { captura(app, "e2e-02-fallo-tira-de-dias") }
        continueAfterFailure = true
        XCTAssertTrue(
            tiraVisible,
            "La tira de días no enseña el primer día (existe: \(primerDia.exists), marco: \(primerDia.frame))")
        continueAfterFailure = false
        // Cambiar de día con la tira y volver a hoy.
        let dias = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "dia-"))
        if dias.count > 1, dias.element(boundBy: 1).isHittable {
            dias.element(boundBy: 1).tap()
            try await Task.sleep(for: .seconds(1.5))
            captura(app, "e2e-02-agenda-otro-dia")
            primerDia.tap()
            try await Task.sleep(for: .seconds(1.5))
        }

        // La agenda de demostración del backend: un partido con fuentes en el motor falso.
        var partido: XCUIElement?
        let lista = elemento(app, "lista-agenda")
        for _ in 0..<8 {
            for nombre in ["Real Madrid", "Real Sociedad", "Marruecos"] {
                let fila = conTexto(app, nombre)
                if fila.waitForExistence(timeout: 3), fila.isHittable {
                    partido = fila
                    break
                }
            }
            if partido != nil { break }
            if lista.exists { lista.swipeUp() } else { app.swipeUp() }
        }
        let fila = try XCTUnwrap(partido, "La agenda del backend no enseña los partidos de demostración")
        captura(app, "e2e-02-agenda")
        fila.tap()

        // 2. Centro de partido: fuentes del motor falso, comprobador y arranque automático.
        XCTAssertTrue(elemento(app, "cabecera-partido").waitForExistence(timeout: 30), "No abre el centro de partido")
        XCTAssertTrue(elemento(app, "selector-fuentes").waitForExistence(timeout: 60), "No hay fuentes")
        let reproductor = elemento(app, "reproductor-integrado")
        var suena = await esperar(90) {
            reproductor.exists && reproductor.label.contains("Reproduciendo")
        }
        if !suena {
            // Sin arranque automático (p. ej. el comprobador no terminó): se elige a mano la primera.
            let fuente = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "fuente-")).firstMatch
            if fuente.exists {
                fuente.tap()
                suena = await esperar(90) { reproductor.exists && reproductor.label.contains("Reproduciendo") }
            }
        }
        XCTAssertTrue(suena, "AVPlayer no llega a reproducir el HLS del backend. \(estado(app))")
        // Sigue sonando unos segundos (no es solo el colchón inicial).
        try await Task.sleep(for: .seconds(6))
        XCTAssertTrue(
            reproductor.label.contains("Reproduciendo"), "La reproducción no se sostiene. \(estado(app))")
        captura(app, "e2e-03-reproduciendo-video-real")

        // 3. Revocar desde «la web»: la app pierde el acceso y lo explica.
        let revocados = try await servidor.revocarTodos()
        // Uno (o dos si es el reintento de la CI y el primer intento no llegó a revocar).
        XCTAssertGreaterThanOrEqual(revocados, 1, "No había ningún iPhone emparejado")
        let aviso = conTexto(app, "retirado el acceso")
        let fuera = await esperar(60) { app.textFields["campo-codigo"].exists && aviso.exists }
        XCTAssertTrue(fuera, "Tras revocar no vuelve a la pantalla de emparejar con el aviso. \(estado(app))")
        captura(app, "e2e-04-acceso-retirado")

        // 4. Volver a emparejar con el enlace del QR (lo que abre la Cámara).
        let otro = try await servidor.crearCodigo()
        let enlace = try XCTUnwrap(URL(string: otro.enlace), "Enlace del QR no válido: \(otro.enlace)")
        app.open(enlace)
        let relleno = await esperar(20) {
            (app.textFields["campo-codigo"].value as? String) == otro.codigo
        }
        XCTAssertTrue(relleno, "El enlace del QR no rellena el código")
        app.buttons["boton-emparejar"].tap()
        let otraVez = await esperar(45) { app.navigationBars["Agenda"].exists }
        XCTAssertTrue(otraVez, "No vuelve a la agenda tras emparejar por el QR. \(estado(app))")
        captura(app, "e2e-05-emparejada-por-qr")
    }
}
