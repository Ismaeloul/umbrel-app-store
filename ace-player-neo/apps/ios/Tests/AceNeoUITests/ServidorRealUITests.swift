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
    private static let locales = ["Real Madrid", "FC Barcelona", "Real Sociedad", "España"]

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
        try exigir(elementoUI(app, IDUI.pantalla("emparejar")).waitForExistence(timeout: 60), "No arranca en Emparejar")
        let codigo = try await servidor.crearCodigo()
        // En el simulador no hay cámara: el bloque «No hay cámara disponible» y «Escribir el código».
        let escribir = elementoUI(app, IDUI.botonEscribirCodigo)
        if escribir.waitForExistence(timeout: 5), escribir.isHittable { escribir.tap() }
        let campoCodigo = elementoUI(app, IDUI.campoCodigo)
        try exigir(campoCodigo.waitForExistence(timeout: 10), "No hay campo del código")
        campoCodigo.tap()
        campoCodigo.typeText(codigo.codigo)
        let casa = elementoUI(app, IDUI.campoLan).textFields.firstMatch
        try exigir(casa.waitForExistence(timeout: 5), "No hay campo de la dirección de casa")
        if !(casa.value(forKey: "hasKeyboardFocus") as? Bool ?? false) { casa.tap() }
        casa.typeText(servidor.direccionConEsquema)
        captura(app, "e2e-01-emparejar")
        enviar(app)

        let dentro = await esperar(45) { elementoUI(app, IDUI.armazon).exists }
        if !dentro { captura(app, "e2e-01-sin-entrar") }
        try exigir(dentro, "No entra en la app tras emparejar con el backend real. \(estado(app))")
        try exigir(esperarQueDesaparezca(elementoUI(app, IDUI.pantalla("emparejar"))), "Emparejar no se va")
        let vivos = try await servidor.dispositivos().filter { !$0.revocado && $0.plataforma == "ios" }
        try exigir(!(vivos.isEmpty), "El backend no tiene ningún iPhone emparejado tras el canje")
    }

    /// Como en el teclado: «siguiente» en la dirección de casa pasa a la de Tailscale (TarjetaCodigo) y su «ir»
    /// empareja. El botón «Emparejar» queda debajo del teclado, así que no se toca. Si al final no se ha ido el
    /// foco (teclado cerrado), se toca el botón.
    @MainActor
    private func enviar(_ app: XCUIApplication) {
        app.typeText("\n")
        let tailscale = elementoUI(app, IDUI.campoTailscale).textFields.firstMatch
        var enfocado = false
        for _ in 0..<12 where !enfocado {
            enfocado = tailscale.exists && (tailscale.value(forKey: "hasKeyboardFocus") as? Bool ?? false)
            if !enfocado { Thread.sleep(forTimeInterval: 0.25) }
        }
        if enfocado {
            app.typeText("\n")
            return
        }
        let boton = elementoUI(app, IDUI.botonEmparejar)
        if boton.exists, boton.isHittable, boton.isEnabled { boton.tap() }
    }

    // MARK: 2. Agenda

    @MainActor
    private func agendaCarga(_ app: XCUIApplication) async throws {
        try exigir(elementoUI(app, IDUI.pantalla("agenda")).waitForExistence(timeout: 30), "No se ve la agenda")
        let tarjetas = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "tarjeta-partido-"))
        let cargada = await esperar(60) { tarjetas.count > 0 }
        captura(app, "e2e-02-agenda")
        try exigir(cargada, "La agenda del backend no enseña ninguna tarjeta de partido. \(estado(app))")
        try exigir(elementoUI(app, IDUI.tiraDias).exists, "Falta la tira de días con la agenda real")
    }

    // MARK: 3. Reproducir

    @MainActor
    private func reproducir(_ app: XCUIApplication) async throws {
        let tarjeta = try XCTUnwrap(buscarTarjeta(app), "La agenda del backend no enseña los partidos con fuentes")
        tarjeta.tap()
        let video = elementoUI(app, IDUI.videoTeatro)
        try exigir(video.waitForExistence(timeout: 20), "No abre el teatro del partido")
        try exigir(elementoUI(app, IDUI.cabeceraPartido).waitForExistence(timeout: 20), "El teatro no enseña el partido")

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
        try exigir(suena, "AVPlayer no llega a reproducir el HLS del backend. \(estado(app))")
        // Sigue con imagen unos segundos: no es solo el colchón inicial.
        try await Task.sleep(for: .seconds(6))
        let valor = fase(video)
        try exigir(valor.contains("imagen") && !valor.contains("error") && !valor.contains("idle"),
                      "La reproducción no se sostiene. \(estado(app))")
        captura(app, "e2e-03-reproduciendo-video-real")
    }

    /// La tarjeta de un partido con fuentes, desplazando la agenda si hace falta.
    @MainActor
    private func buscarTarjeta(_ app: XCUIApplication) -> XCUIElement? {
        let todos = elementoUI(app, IDUI.filtroTodos)
        if todos.exists, todos.isHittable, !todos.isSelected { todos.tap() }
        let pantalla = elementoUI(app, IDUI.pantalla("agenda"))
        if let heroe = botonDelHeroe(app) { return heroe }
        for _ in 0..<10 {
            for id in Self.partidos {
                let tarjeta = elementoUI(app, IDUI.tarjetaPartido(id))
                if tarjeta.exists, tarjeta.isHittable, tarjeta.frame.midY < app.frame.maxY - 140 { return tarjeta }
            }
            arrastrar(pantalla, desde: CGVector(dx: 0.5, dy: 0.75), hasta: CGVector(dx: 0.5, dy: 0.4))
        }
        return nil
    }

    /// El partido destacado va en el héroe y no en una tarjeta: su «Ver…» (navega al partido, a3 §4), si es uno
    /// de los que tienen fuentes en el motor falso.
    @MainActor
    private func botonDelHeroe(_ app: XCUIApplication) -> XCUIElement? {
        let heroe = elementoUI(app, IDUI.heroe)
        guard heroe.exists, Self.locales.contains(where: { heroe.label.contains($0) }) else { return nil }
        let boton = elementoUI(app, IDUI.botonVerAhora)
        return boton.exists && boton.isHittable ? boton : nil
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
        try await minimizar(app)
        tocarPestana(app, "ajustes")
        try exigir(elementoUI(app, IDUI.pantalla("ajustes")).waitForExistence(timeout: 15), "No sale Ajustes")

        try tocarChip(app, "salud")
        let conSalud = await esperar(30) { conTextoUI(app, "Motor principal").exists && conTextoUI(app, "Segundo motor").exists }
        captura(app, "e2e-04-salud")
        try exigir(conSalud, "Salud no enseña los servicios del backend. \(estado(app))")
        try exigir(conTextoUI(app, "Backend").exists, "Falta la tarjeta del backend en Salud")
        try exigir(!(conTextoUI(app, "No se pudo leer la salud").exists), "Salud no se pudo leer")

        try tocarChip(app, "dispositivos")
        let este = elementoUI(app, IDUI.filaEsteIPhone)
        let fila = elementoUI(app, IDUI.filaDispositivo(otro))
        let conLista = await esperar(30) { este.exists && fila.exists }
        captura(app, "e2e-05-dispositivos")
        try exigir(conLista, "Dispositivos no enseña «Este iPhone» y el iPad emparejado. \(estado(app))")
        try exigir(conTextoUI(app, "iPad de pruebas").exists, "Falta el nombre del otro aparato")
        try exigir(elementoUI(app, IDUI.botonOlvidarEsteIPhone).exists, "Falta «Olvidar este iPhone»")
    }

    /// ⌄ Minimizar. Los controles se esconden a los 3,2 s de reproducir (PresentacionReproductor) y, escondidos, el
    /// primer toque solo los enseña (a4 §5.1). Cada consulta de XCUITest tarda cerca de un segundo con el vídeo en
    /// marcha, así que se toca por coordenada y, si el mini no ha salido, se vuelve a tocar enseguida (dentro del
    /// plazo en que ya se ven). El árbol de accesibilidad da el botón por visible aunque esté escondido.
    @MainActor
    private func minimizar(_ app: XCUIApplication) async throws {
        let boton = elementoUI(app, IDUI.botonMinimizar)
        let mini = elementoUI(app, IDUI.mini)
        try exigir(boton.waitForExistence(timeout: 5), "Sin ⌄ Minimizar. \(estado(app))")
        let punto = boton.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        for _ in 0..<3 {
            punto.tap()
            Thread.sleep(forTimeInterval: 0.3)
            if mini.exists { break }
            punto.tap()
            if await esperar(3, { mini.exists }) { break }
        }
        let sale = mini.waitForExistence(timeout: 10)
        captura(app, "e2e-04-mini")
        try exigir(sale, "Al minimizar no sale el mini. \(estado(app))")
    }

    /// Sube Ajustes hasta que el elemento quede entre la barra de estado y el mini (que tapa lo de abajo).
    @MainActor
    private func traerALaVista(_ app: XCUIApplication, _ elemento: XCUIElement) {
        let pantalla = elementoUI(app, IDUI.pantalla("ajustes"))
        let mini = elementoUI(app, IDUI.mini)
        for _ in 0..<10 {
            let limite = mini.exists ? mini.frame.minY - 12 : app.frame.maxY - 140
            guard elemento.exists, elemento.frame.maxY > limite else { return }
            arrastrar(pantalla, desde: CGVector(dx: 0.5, dy: 0.6), hasta: CGVector(dx: 0.5, dy: 0.4))
        }
    }

    /// Toca un chip del índice de Ajustes (desplazando la fila si hace falta).
    @MainActor
    private func tocarChip(_ app: XCUIApplication, _ seccion: String) throws {
        let chip = elementoUI(app, IDUI.chip(seccion))
        try exigir(chip.waitForExistence(timeout: 10), "No hay chip \(seccion)")
        let indice = elementoUI(app, IDUI.indiceAjustes)
        var intentos = 0
        while chip.frame.maxX > app.frame.maxX - 8 && intentos < 8 {
            arrastrar(indice, desde: CGVector(dx: 0.8, dy: 0.5), hasta: CGVector(dx: 0.3, dy: 0.5))
            intentos += 1
        }
        chip.tap()
        try exigir(elementoUI(app, IDUI.seccion(seccion)).waitForExistence(timeout: 10), "No hay tarjeta \(seccion)")
        Thread.sleep(forTimeInterval: 0.8)
    }

    // MARK: 5. Olvidar este iPhone

    @MainActor
    private func olvidar(_ app: XCUIApplication, _ servidor: ServidorDePruebas) async throws {
        let antes = try await servidor.dispositivos().filter { !$0.revocado && $0.plataforma == "ios" }.map(\.id)
        let boton = elementoUI(app, IDUI.botonOlvidarEsteIPhone)
        traerALaVista(app, boton)
        boton.tap()
        try exigir(conTextoUI(app, "¿Olvidar? Pulsa otra vez").waitForExistence(timeout: 3), "No se arma")
        captura(app, "e2e-06-olvidar-armado")
        boton.tap()
        let fuera = elementoUI(app, IDUI.pantalla("emparejar")).waitForExistence(timeout: 20)
        captura(app, "e2e-07-vuelta-a-emparejar")
        try exigir(fuera, "«Olvidar este iPhone» no vuelve a Emparejar. \(estado(app))")
        try exigir(!(elementoUI(app, IDUI.avisoAcceso).exists), "Tras olvidar no hay aviso (a2 §23.3)")
        try exigir(!(elementoUI(app, IDUI.mini).exists), "Tras olvidar sigue el mini")
        let despues = try await servidor.dispositivos().filter { !$0.revocado && $0.plataforma == "ios" }.map(\.id)
        try exigir(despues.count < antes.count, "El backend sigue dando por emparejado este iPhone")
    }

    // MARK: Ayudas

    /// Un fallo que corta la prueba. En una prueba `async`, `continueAfterFailure = false` no la para: un
    /// XCTAssert fallido seguiría con los pasos siguientes y el log se llenaría de fallos en cadena.
    private struct FalloE2E: Error, CustomStringConvertible {
        let description: String
    }

    @MainActor
    private func exigir(_ condicion: Bool, _ mensaje: @autoclosure () -> String) throws {
        guard !condicion else { return }
        throw FalloE2E(description: mensaje())
    }

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
