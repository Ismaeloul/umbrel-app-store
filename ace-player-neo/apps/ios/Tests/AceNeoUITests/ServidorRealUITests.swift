import XCTest

/// La app DE VERDAD (Llavero, red y AVPlayer) contra el backend DE VERDAD de la pila E2E que la CI levanta en el
/// runner (`scripts/pila-e2e.mjs`: motor AceStream falso + backend del monorepo + ffmpeg para el remux). Es la
/// prueba de integración de I1 (b-arquitectura §4.3) y recorre, en este orden y con la misma app:
///
/// 1. Emparejar tecleando la dirección de casa y un código recién creado desde «la web» (`POST /api/v1/pairing`);
/// 2. la agenda de demostración del backend (`FOOTBALL_DEMO_ONLY`) carga con sus tarjetas;
/// 3. abrir un partido → el comprobador verifica las fuentes del motor falso → arranque → el backend prepara el
///    HLS con ffmpeg → AVPlayer llega a reproducir (fase `reproduciendo` con imagen) y se sostiene;
/// 4. minimizar y Ajustes › Salud (los servicios del backend de verdad) y › Dispositivos («Este iPhone» y el
///    otro aparato que se empareja por la API);
/// 5. «Olvidar este iPhone» con segundo toque → vuelve a Emparejar sin aviso y el backend lo da por revocado.
///
/// Fuera de la CI (sin `ACE_E2E_PUERTO`) se salta. En la CI corre con los UITests completos o con
/// `solo_uitests=ServidorRealUITests` (ios.yml arranca la pila si el filtro lo nombra).
final class ServidorRealUITests: XCTestCase {
    /// El partido de la agenda de demostración con fuentes en el motor falso (apps/web/e2e/support/catalogo.ts):
    /// Real Madrid – Manchester City (M+ Liga de Campeones, 3 fuentes), y de reserva los otros tres.
    private static let partidos = ["demo-5", "demo-1", "demo-4", "demo-3"]

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testEmparejarAgendaReproducirSaludDispositivosYOlvidar() async throws {
        guard let servidor = ServidorDePruebas.desdeEntorno() else {
            throw XCTSkip("Sin backend de pruebas (ACE_E2E_PUERTO): solo corre en la CI, con scripts/pila-e2e.mjs")
        }
        let app = XCUIApplication()
        app.launchArguments = ["-AceNeoEmpezarDeCero"]
        app.launch()

        try await emparejar(app, servidor)
        try await agendaCarga(app)
        try await reproducir(app)
        try await saludYDispositivos(app, servidor)
        try await olvidar(app, servidor)
    }

    // MARK: 1. Emparejar

    @MainActor
    private func emparejar(_ app: XCUIApplication, _ servidor: ServidorDePruebas) async throws {
        XCTAssertTrue(elementoUI(app, IDUI.pantalla("emparejar")).waitForExistence(timeout: 60), "No arranca en Emparejar")
        let codigo = try await servidor.crearCodigo()
        // En el simulador no hay cámara: el bloque «No hay cámara disponible» y «Escribir el código».
        let escribir = elementoUI(app, IDUI.botonEscribirCodigo)
        if escribir.waitForExistence(timeout: 5), escribir.isHittable { escribir.tap() }
        let campoCodigo = elementoUI(app, IDUI.campoCodigo)
        XCTAssertTrue(campoCodigo.waitForExistence(timeout: 10), "No hay campo del código")
        campoCodigo.tap()
        campoCodigo.typeText(codigo.codigo)
        let casa = elementoUI(app, IDUI.campoLan).textFields.firstMatch
        XCTAssertTrue(casa.waitForExistence(timeout: 5), "No hay campo de la dirección de casa")
        if !(casa.value(forKey: "hasKeyboardFocus") as? Bool ?? false) { casa.tap() }
        casa.typeText(servidor.direccionConEsquema)
        captura(app, "e2e-01-emparejar")
        enviar(app)

        let dentro = await esperar(45) { elementoUI(app, IDUI.armazon).exists }
        XCTAssertTrue(dentro, "No entra en la app tras emparejar con el backend real. \(estado(app))")
        XCTAssertTrue(esperarQueDesaparezca(elementoUI(app, IDUI.pantalla("emparejar"))), "Emparejar no se va")
        let vivos = try await servidor.dispositivos().filter { !$0.revocado && $0.plataforma == "ios" }
        XCTAssertFalse(vivos.isEmpty, "El backend no tiene ningún iPhone emparejado tras el canje")
    }

    /// «Emparejar»; si el botón no se deja tocar (teclado encima), «ir» del teclado.
    @MainActor
    private func enviar(_ app: XCUIApplication) {
        let boton = elementoUI(app, IDUI.botonEmparejar)
        if boton.exists, boton.isHittable, boton.isEnabled {
            boton.tap()
        } else {
            app.typeText("\n")
        }
    }

    // MARK: 2. Agenda

    @MainActor
    private func agendaCarga(_ app: XCUIApplication) async throws {
        XCTAssertTrue(elementoUI(app, IDUI.pantalla("agenda")).waitForExistence(timeout: 30), "No se ve la agenda")
        let tarjetas = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "tarjeta-partido-"))
        let cargada = await esperar(60) { tarjetas.count > 0 }
        captura(app, "e2e-02-agenda")
        XCTAssertTrue(cargada, "La agenda del backend no enseña ninguna tarjeta de partido. \(estado(app))")
        XCTAssertTrue(elementoUI(app, IDUI.tiraDias).exists, "Falta la tira de días con la agenda real")
    }

    // MARK: 3. Reproducir

    @MainActor
    private func reproducir(_ app: XCUIApplication) async throws {
        let tarjeta = try XCTUnwrap(buscarTarjeta(app), "La agenda del backend no enseña los partidos con fuentes")
        tarjeta.tap()
        let video = elementoUI(app, IDUI.videoTeatro)
        XCTAssertTrue(video.waitForExistence(timeout: 20), "No abre el teatro del partido")
        XCTAssertTrue(elementoUI(app, IDUI.cabeceraPartido).waitForExistence(timeout: 20), "El teatro no enseña el partido")

        // Arranque solo: la primera fuente verificada por el comprobador. Si no arranca, se elige a mano la primera.
        var suena = await esperar(90) { self.suena(video) }
        if !suena {
            captura(app, "e2e-03-sin-arranque-solo")
            let primera = elementoUI(app, IDUI.cartelFuente(1))
            if primera.waitForExistence(timeout: 30) {
                primera.tap()
                suena = await esperar(90) { self.suena(video) }
            }
        }
        captura(app, "e2e-03-teatro")
        XCTAssertTrue(suena, "AVPlayer no llega a reproducir el HLS del backend. \(estado(app))")
        // Sigue con imagen unos segundos: no es solo el colchón inicial.
        try await Task.sleep(for: .seconds(6))
        let valor = fase(video)
        XCTAssertTrue(valor.contains("imagen") && !valor.contains("error") && !valor.contains("idle"),
                      "La reproducción no se sostiene. \(estado(app))")
        captura(app, "e2e-03-reproduciendo-video-real")
    }

    /// La tarjeta de un partido con fuentes, desplazando la agenda si hace falta.
    @MainActor
    private func buscarTarjeta(_ app: XCUIApplication) -> XCUIElement? {
        let todos = elementoUI(app, IDUI.filtroTodos)
        if todos.exists, todos.isHittable, !todos.isSelected { todos.tap() }
        let pantalla = elementoUI(app, IDUI.pantalla("agenda"))
        for _ in 0..<10 {
            for id in Self.partidos {
                let tarjeta = elementoUI(app, IDUI.tarjetaPartido(id))
                if tarjeta.exists, tarjeta.isHittable, tarjeta.frame.midY < app.frame.maxY - 140 { return tarjeta }
            }
            arrastrar(pantalla, desde: CGVector(dx: 0.5, dy: 0.75), hasta: CGVector(dx: 0.5, dy: 0.4))
        }
        return nil
    }

    /// La fase del reproductor que el escenario publica en Debug (`data-phase` de la web): «reproduciendo imagen».
    @MainActor
    private func fase(_ video: XCUIElement) -> String {
        guard video.exists else { return "" }
        return (video.value as? String) ?? ""
    }

    @MainActor
    private func suena(_ video: XCUIElement) -> Bool {
        fase(video).hasPrefix("reproduciendo imagen")
    }

    // MARK: 4. Salud y Dispositivos

    @MainActor
    private func saludYDispositivos(_ app: XCUIApplication, _ servidor: ServidorDePruebas) async throws {
        // Otro aparato emparejado desde la API: la lista trae más que «Este iPhone».
        let otro = try await servidor.emparejarOtro(nombre: "iPad de pruebas")
        minimizar(app)
        tocarPestana(app, "ajustes")
        XCTAssertTrue(elementoUI(app, IDUI.pantalla("ajustes")).waitForExistence(timeout: 15), "No sale Ajustes")

        tocarChip(app, "salud")
        let conSalud = await esperar(30) { conTextoUI(app, "Motor principal").exists && conTextoUI(app, "Segundo motor").exists }
        captura(app, "e2e-04-salud")
        XCTAssertTrue(conSalud, "Salud no enseña los servicios del backend. \(estado(app))")
        XCTAssertTrue(conTextoUI(app, "Backend").exists, "Falta la tarjeta del backend en Salud")
        XCTAssertFalse(conTextoUI(app, "No se pudo leer la salud").exists, "Salud no se pudo leer")

        tocarChip(app, "dispositivos")
        let este = elementoUI(app, IDUI.filaEsteIPhone)
        let fila = elementoUI(app, IDUI.filaDispositivo(otro))
        let conLista = await esperar(30) { este.exists && fila.exists }
        captura(app, "e2e-05-dispositivos")
        XCTAssertTrue(conLista, "Dispositivos no enseña «Este iPhone» y el iPad emparejado. \(estado(app))")
        XCTAssertTrue(conTextoUI(app, "iPad de pruebas").exists, "Falta el nombre del otro aparato")
        XCTAssertTrue(elementoUI(app, IDUI.botonOlvidarEsteIPhone).exists, "Falta «Olvidar este iPhone»")
    }

    @MainActor
    private func minimizar(_ app: XCUIApplication) {
        let boton = elementoUI(app, IDUI.botonMinimizar)
        if !boton.waitForExistence(timeout: 5) || !boton.isHittable { elementoUI(app, IDUI.videoTeatro).tap() }
        XCTAssertTrue(boton.waitForExistence(timeout: 5), "Sin ⌄ Minimizar")
        boton.tap()
        XCTAssertTrue(elementoUI(app, IDUI.mini).waitForExistence(timeout: 10), "Al minimizar no sale el mini")
    }

    /// Toca un chip del índice de Ajustes (desplazando la fila si hace falta).
    @MainActor
    private func tocarChip(_ app: XCUIApplication, _ seccion: String) {
        let chip = elementoUI(app, IDUI.chip(seccion))
        XCTAssertTrue(chip.waitForExistence(timeout: 10), "No hay chip \(seccion)")
        let indice = elementoUI(app, IDUI.indiceAjustes)
        var intentos = 0
        while chip.frame.maxX > app.frame.maxX - 8 && intentos < 8 {
            arrastrar(indice, desde: CGVector(dx: 0.8, dy: 0.5), hasta: CGVector(dx: 0.3, dy: 0.5))
            intentos += 1
        }
        chip.tap()
        XCTAssertTrue(elementoUI(app, IDUI.seccion(seccion)).waitForExistence(timeout: 10), "No hay tarjeta \(seccion)")
        Thread.sleep(forTimeInterval: 0.8)
    }

    // MARK: 5. Olvidar este iPhone

    @MainActor
    private func olvidar(_ app: XCUIApplication, _ servidor: ServidorDePruebas) async throws {
        let antes = try await servidor.dispositivos().filter { !$0.revocado && $0.plataforma == "ios" }.map(\.id)
        let boton = elementoUI(app, IDUI.botonOlvidarEsteIPhone)
        boton.tap()
        XCTAssertTrue(conTextoUI(app, "¿Olvidar? Pulsa otra vez").waitForExistence(timeout: 3), "No se arma")
        captura(app, "e2e-06-olvidar-armado")
        boton.tap()
        let fuera = elementoUI(app, IDUI.pantalla("emparejar")).waitForExistence(timeout: 20)
        captura(app, "e2e-07-vuelta-a-emparejar")
        XCTAssertTrue(fuera, "«Olvidar este iPhone» no vuelve a Emparejar. \(estado(app))")
        XCTAssertFalse(elementoUI(app, IDUI.avisoAcceso).exists, "Tras olvidar no hay aviso (a2 §23.3)")
        XCTAssertFalse(elementoUI(app, IDUI.mini).exists, "Tras olvidar sigue el mini")
        let despues = try await servidor.dispositivos().filter { !$0.revocado && $0.plataforma == "ios" }.map(\.id)
        XCTAssertLessThan(despues.count, antes.count, "El backend sigue dando por emparejado este iPhone")
    }

    // MARK: Ayudas

    @MainActor
    private func captura(_ app: XCUIApplication, _ nombre: String) {
        let adjunto = XCTAttachment(screenshot: app.screenshot())
        adjunto.name = nombre
        adjunto.lifetime = .keepAlways
        add(adjunto)
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
        let video = elementoUI(app, IDUI.videoTeatro)
        let capsula = elementoUI(app, IDUI.capsulaEstado)
        let panel = elementoUI(app, IDUI.panelMensajeVideo)
        let error = elementoUI(app, IDUI.errorEmparejar)
        let aviso = elementoUI(app, IDUI.avisoAcceso)
        return [
            video.exists ? "vídeo: «\(video.label)» fase «\(fase(video))»" : "sin vídeo",
            capsula.exists ? "cápsula: «\(capsula.label)»" : "",
            panel.exists ? "panel: «\(panel.label)»" : "",
            error.exists ? "error al emparejar: «\(error.label)»" : "",
            aviso.exists ? "aviso: «\(aviso.label)»" : "",
        ].filter { !$0.isEmpty }.joined(separator: "; ")
    }
}
