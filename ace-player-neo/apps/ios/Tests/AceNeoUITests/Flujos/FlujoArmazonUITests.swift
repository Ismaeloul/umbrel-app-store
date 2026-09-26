import UIKit
import XCTest

/// Flujos del armazón (b-arquitectura §3.5, M4), con la demo: cambiar de pestaña, borde izquierdo para salir del
/// partido, hoja que se cierra arrastrando, toast con «Deshacer», giro a 844×390 con la barra superior, tocar la
/// pestaña activa sube (solo la que se ve), cada pestaña conserva su scroll, y la ida tarjeta → teatro y su vuelta.
final class FlujoArmazonUITests: XCTestCase {
    override func setUp() async throws {
        continueAfterFailure = false
        await MainActor.run { XCUIDevice.shared.orientation = .portrait }
    }

    override func tearDown() async throws {
        await MainActor.run { XCUIDevice.shared.orientation = .portrait }
    }

    @MainActor
    private func captura(_ app: XCUIApplication, _ nombre: String) {
        let adjunto: XCTAttachment
        if app.frame.width > app.frame.height || XCUIDevice.shared.orientation.isLandscape {
            adjunto = XCTAttachment(image: capturaHorizontal())
        } else {
            adjunto = XCTAttachment(screenshot: app.screenshot())
        }
        adjunto.name = nombre
        adjunto.lifetime = .keepAlways
        add(adjunto)
    }

    /// En horizontal, `app.screenshot()` recorta la foto de la pantalla (vertical, la del panel) con el marco
    /// horizontal de la app: salía girada, cortada y con media imagen en negro. Se toma la pantalla entera y se
    /// deja en horizontal para que se lea como la ve la persona (para compararla con `agenda-844x390-*.png`).
    ///
    /// La foto de `XCUIScreen` trae los píxeles en vertical y el giro solo en `imageOrientation` (su `size` ya
    /// dice horizontal): el PNG del adjunto no mira esa marca y salía de 1170×2532 con todo tumbado. Primero se
    /// repinta respetando la marca; si aun así quedan los píxeles en vertical, se giran a mano.
    @MainActor
    private func capturaHorizontal() -> UIImage {
        let pintada = repintada(XCUIScreen.main.screenshot().image)
        guard pintada.size.width < pintada.size.height else { return pintada }
        // Girado a la izquierda (botón de inicio a la derecha), lo de arriba de la app queda en el borde derecho
        // del panel: se gira 90° a la izquierda. Girado a la derecha, al revés.
        return girada(pintada, izquierda: XCUIDevice.shared.orientation != .landscapeRight)
    }

    /// Los píxeles tal y como se ven (con `imageOrientation` aplicada), marca `.up`.
    @MainActor
    private func repintada(_ imagen: UIImage) -> UIImage {
        let formato = UIGraphicsImageRendererFormat()
        formato.scale = imagen.scale
        return UIGraphicsImageRenderer(size: imagen.size, format: formato).image { _ in
            imagen.draw(in: CGRect(origin: .zero, size: imagen.size))
        }
    }

    @MainActor
    private func girada(_ imagen: UIImage, izquierda: Bool) -> UIImage {
        let ancho = imagen.size.width
        let alto = imagen.size.height
        let formato = UIGraphicsImageRendererFormat()
        formato.scale = imagen.scale
        let lienzo = UIGraphicsImageRenderer(size: CGSize(width: alto, height: ancho), format: formato)
        return lienzo.image { contexto in
            let cg = contexto.cgContext
            if izquierda {
                cg.translateBy(x: 0, y: ancho)
                cg.rotate(by: -CGFloat.pi / 2)
            } else {
                cg.translateBy(x: alto, y: 0)
                cg.rotate(by: CGFloat.pi / 2)
            }
            imagen.draw(in: CGRect(x: 0, y: 0, width: ancho, height: alto))
        }
    }

    @MainActor
    private func abrir(_ argumentos: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AceNeoDemo"] + argumentos
        app.launch()
        esperarVertical(app)
        return app
    }

    /// Tras una prueba en horizontal el giro de vuelta puede no haber acabado: se espera a la ventana vertical.
    @MainActor
    private func esperarVertical(_ app: XCUIApplication) {
        let limite = Date().addingTimeInterval(5)
        while Date() < limite && app.frame.width > app.frame.height { Thread.sleep(forTimeInterval: 0.2) }
    }

    /// La pantalla visible es la de `id` y ninguna otra pestaña se ve.
    @MainActor
    private func comprobarPantalla(_ app: XCUIApplication, _ id: String) {
        let pantalla = elementoUI(app, IDUI.pantalla(id))
        XCTAssertTrue(pantalla.waitForExistence(timeout: 10), "No se ve la pantalla \(id)")
        // Las pestañas visitadas siguen montadas (vivas, a2 §12): XCUITest las encuentra aunque estén ocultas y fuera
        // de VoiceOver (SwiftUI las deja en sus elementos de automatización). Lo que cuenta es que no se puedan tocar.
        for otra in ["agenda", "biblioteca", "buscar", "ajustes"] where otra != id {
            let oculta = elementoUI(app, IDUI.pantalla(otra))
            XCTAssertFalse(oculta.exists && oculta.isHittable, "Se ve \(otra) estando en \(id)")
        }
        XCTAssertTrue(elementoUI(app, IDUI.pestana(id)).isSelected, "La pestaña \(id) no está marcada")
    }

    @MainActor
    func testArrancaYCambiaDePestana() throws {
        let app = abrir()
        XCTAssertTrue(elementoUI(app, IDUI.barraPestanas).waitForExistence(timeout: 20), "No hay barra de pestañas")
        comprobarPantalla(app, "agenda")
        captura(app, "armazon-agenda")

        for id in ["biblioteca", "buscar", "ajustes", "agenda"] {
            tocarPestana(app, id)
            comprobarPantalla(app, id)
            captura(app, "armazon-\(id)")
        }
    }

    /// La barra en oscuro y con transparencia reducida (a2 §1.1 y §14), para mirarla frente a las capturas de la web.
    @MainActor
    func testBarraEnOscuroYOpaca() throws {
        let oscuro = abrir(["-AceNeoApariencia", "oscuro"])
        XCTAssertTrue(elementoUI(oscuro, IDUI.barraPestanas).waitForExistence(timeout: 20))
        tocarPestana(oscuro, "biblioteca")
        Thread.sleep(forTimeInterval: 0.8)
        captura(oscuro, "armazon-canales-oscuro")
        oscuro.terminate()
        let opaca = abrir(["-AceNeoTransparenciaReducida"])
        XCTAssertTrue(elementoUI(opaca, IDUI.barraPestanas).waitForExistence(timeout: 20))
        captura(opaca, "armazon-agenda-claro-transparencia-reducida")
    }

    /// a2 §2.4: deslizar desde el borde izquierdo saca del partido y deja ver la pestaña de debajo.
    @MainActor
    func testBordeIzquierdoSaleDelPartido() throws {
        let app = abrir(["-AceNeoVista", "partido/demo-1"])
        let teatro = elementoUI(app, IDUI.teatro)
        XCTAssertTrue(teatro.waitForExistence(timeout: 20), "No se abre el partido con -AceNeoVista")
        XCTAssertFalse(elementoUI(app, IDUI.barraPestanas).exists, "En el partido no hay barra de pestañas")
        captura(app, "armazon-partido")

        let inicio = app.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.5))
        let fin = app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5))
        inicio.press(forDuration: 0.05, thenDragTo: fin, withVelocity: .fast, thenHoldForDuration: 0)

        XCTAssertTrue(esperarQueDesaparezca(teatro, plazo: 5), "El borde izquierdo no saca del partido")
        comprobarPantalla(app, "agenda")
        XCTAssertTrue(elementoUI(app, IDUI.barraPestanas).waitForExistence(timeout: 5), "No vuelve la barra")
        captura(app, "armazon-tras-borde")
    }

    /// Un borde corto no sale: el partido vuelve a su sitio.
    @MainActor
    func testBordeCortoNoSale() throws {
        let app = abrir(["-AceNeoVista", "partido/demo-1"])
        let teatro = elementoUI(app, IDUI.teatro)
        XCTAssertTrue(teatro.waitForExistence(timeout: 20), "No se abre el partido con -AceNeoVista")
        let inicio = app.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.5))
        let fin = app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5))
        inicio.press(forDuration: 0.05, thenDragTo: fin, withVelocity: .slow, thenHoldForDuration: 0.3)
        Thread.sleep(forTimeInterval: 1)
        XCTAssertTrue(teatro.exists, "Un arrastre corto y lento no debe salir del partido")
    }

    /// a2 §8.3: el toast con acción; «Deshacer» lo cierra antes de su tiempo (el de prueba dura 30 s).
    @MainActor
    func testToastConDeshacer() throws {
        let app = abrir(["-AceNeoAvisoDeshacer"])
        let toast = elementoUI(app, IDUI.toast)
        XCTAssertTrue(toast.waitForExistence(timeout: 20), "No sale el toast con «Deshacer»")
        XCTAssertTrue(conTextoUI(app, "Reproducción detenida").exists, "El toast no dice «Reproducción detenida»")
        let barra = elementoUI(app, IDUI.barraPestanas)
        XCTAssertTrue(barra.waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 0.8)  // entrada del toast (muelle estándar, 520 ms)
        captura(app, "armazon-toast")
        // Los marcos de accesibilidad incluyen la sombra (`--shadow-2`, 60 de desenfoque): se comparan los centros.
        // Toast de dos líneas (68) a safeB + 94 y barra de 64 a safeB + 10: centros separados 34 + 8 + 32 + 10 = 84.
        XCTAssertLessThan(toast.frame.midY + 60, barra.frame.midY,
                          "El toast debe ir por encima de la barra (toast \(toast.frame), barra \(barra.frame))")
        // «Deshacer» va a la izquierda del ✕ «Cerrar aviso» (a2 §8.3).
        let deshacer = elementoUI(app, IDUI.toastAccion)
        let cerrar = elementoUI(app, IDUI.toastCerrar)
        XCTAssertTrue(deshacer.exists && cerrar.exists, "Faltan «Deshacer» o «Cerrar aviso»")
        XCTAssertLessThan(deshacer.frame.midX, cerrar.frame.midX, "«Deshacer» va a la izquierda del ✕")
        deshacer.tap()
        XCTAssertTrue(esperarQueDesaparezca(toast, plazo: 3), "«Deshacer» no cierra el toast")
    }

    /// a2 §16: a 844×390 la barra de abajo se va y aparece la barra superior; al volver, al revés.
    @MainActor
    func testGiroEnsenaLaBarraSuperior() throws {
        let app = abrir()
        XCTAssertTrue(elementoUI(app, IDUI.barraPestanas).waitForExistence(timeout: 20))
        XCUIDevice.shared.orientation = .landscapeLeft
        let superior = elementoUI(app, IDUI.barraSuperior)
        XCTAssertTrue(superior.waitForExistence(timeout: 10), "En horizontal no aparece la barra superior")
        XCTAssertTrue(esperarQueDesaparezca(elementoUI(app, IDUI.barraPestanas), plazo: 5), "Sigue la barra de abajo")
        XCTAssertLessThan(superior.frame.minY, 1, "La barra superior va pegada arriba")
        captura(app, "armazon-horizontal")
        tocarPestana(app, "ajustes")
        comprobarPantalla(app, "ajustes")
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(elementoUI(app, IDUI.barraPestanas).waitForExistence(timeout: 10), "No vuelve la barra de abajo")
        comprobarPantalla(app, "ajustes")
    }

    /// a2 §9.4 y decisión 5: la hoja nativa se cierra arrastrando el asa (en horizontal, «?» abre la ayuda).
    @MainActor
    func testHojaConAsaSeCierraArrastrando() throws {
        let app = abrir()
        XCTAssertTrue(elementoUI(app, IDUI.barraPestanas).waitForExistence(timeout: 20))
        XCUIDevice.shared.orientation = .landscapeLeft
        let ayuda = app.buttons["Atajos de teclado"]
        XCTAssertTrue(ayuda.waitForExistence(timeout: 10), "No está «Atajos de teclado» en la barra superior")
        ayuda.tap()
        let hoja = elementoUI(app, IDUI.hojaAyuda)
        XCTAssertTrue(hoja.waitForExistence(timeout: 10), "No se abre la hoja de ayuda")
        captura(app, "armazon-hoja")
        let arriba = CGVector(dx: 0.5, dy: max(0.02, (hoja.frame.minY - 10) / app.frame.height))
        let abajo = CGVector(dx: 0.5, dy: 0.98)
        app.coordinate(withNormalizedOffset: arriba)
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: abajo), withVelocity: .fast,
                   thenHoldForDuration: 0)
        XCTAssertTrue(esperarQueDesaparezca(hoja, plazo: 5), "La hoja no se cierra arrastrando el asa")
    }

    /// El titular de una pantalla (la cabecera «Agenda», «Ajustes»…), buscado dentro de ella: las pestañas ocultas
    /// siguen montadas y tienen el suyo.
    @MainActor
    private func titular(_ app: XCUIApplication, _ id: String, _ texto: String) -> XCUIElement {
        let pantalla = elementoUI(app, IDUI.pantalla(id))
        XCTAssertTrue(pantalla.waitForExistence(timeout: 20), "No se ve la pantalla \(id)")
        let titulo = pantalla.staticTexts[texto].firstMatch
        XCTAssertTrue(titulo.waitForExistence(timeout: 10), "No está el titular «\(texto)»")
        return titulo
    }

    /// Baja la pantalla visible dos arrastres largos (encima de la barra de pestañas).
    @MainActor
    private func bajar(_ app: XCUIApplication, _ id: String) {
        let pantalla = elementoUI(app, IDUI.pantalla(id))
        for _ in 0..<2 {
            arrastrar(pantalla, desde: CGVector(dx: 0.5, dy: 0.72), hasta: CGVector(dx: 0.5, dy: 0.22))
        }
        Thread.sleep(forTimeInterval: 1)  // la inercia del desplazamiento
    }

    /// Espera a que el titular llegue a `y` (±2) o se rinde.
    @MainActor
    private func esperarTitular(_ titulo: XCUIElement, en y: CGFloat, plazo: TimeInterval = 3) -> Bool {
        let limite = Date().addingTimeInterval(plazo)
        while Date() < limite {
            if abs(titulo.frame.minY - y) <= 2 { return true }
            Thread.sleep(forTimeInterval: 0.2)
        }
        return abs(titulo.frame.minY - y) <= 2
    }

    /// Decisión 3: tocar la pestaña activa sube su vista arriba.
    @MainActor
    func testTocarLaPestanaActivaSube() throws {
        let app = abrir()
        XCTAssertTrue(elementoUI(app, IDUI.barraPestanas).waitForExistence(timeout: 20))
        tocarPestana(app, "ajustes")
        let titulo = titular(app, "ajustes", "Ajustes")
        let arriba = titulo.frame.minY
        bajar(app, "ajustes")
        XCTAssertLessThan(titulo.frame.minY, arriba - 200, "Ajustes no ha bajado (titular en \(titulo.frame.minY))")
        tocarPestana(app, "ajustes")
        XCTAssertTrue(esperarTitular(titulo, en: arriba), "No sube arriba al tocar la activa (\(titulo.frame.minY))")
    }

    /// a2 §12: cada pestaña conserva su scroll al ir y volver.
    @MainActor
    func testCambiarDePestanaConservaElScroll() throws {
        let app = abrir()
        XCTAssertTrue(elementoUI(app, IDUI.barraPestanas).waitForExistence(timeout: 20))
        tocarPestana(app, "ajustes")
        let titulo = titular(app, "ajustes", "Ajustes")
        let arriba = titulo.frame.minY
        bajar(app, "ajustes")
        let bajado = titulo.frame.minY
        XCTAssertLessThan(bajado, arriba - 200, "Ajustes no ha bajado")
        tocarPestana(app, "agenda")
        comprobarPantalla(app, "agenda")
        tocarPestana(app, "ajustes")
        comprobarPantalla(app, "ajustes")
        Thread.sleep(forTimeInterval: 0.6)  // entrada de la pestaña (340 ms)
        XCTAssertEqual(titulo.frame.minY, bajado, accuracy: 2, "Al volver a Ajustes no se conserva el scroll")
    }

    /// Tocar la pestaña activa sube SOLO la que se ve: la Agenda oculta conserva su scroll (a2 §12).
    @MainActor
    func testTocarLaActivaNoSubeLaOculta() throws {
        let app = abrir()
        XCTAssertTrue(elementoUI(app, IDUI.barraPestanas).waitForExistence(timeout: 20))
        let titulo = titular(app, "agenda", "Agenda")
        let arriba = titulo.frame.minY
        bajar(app, "agenda")
        let bajado = titulo.frame.minY
        XCTAssertLessThan(bajado, arriba - 200, "La agenda no ha bajado")
        tocarPestana(app, "biblioteca")
        comprobarPantalla(app, "biblioteca")
        tocarPestana(app, "biblioteca")  // la activa: sube Canales, no la Agenda de debajo
        Thread.sleep(forTimeInterval: 0.8)
        tocarPestana(app, "agenda")
        comprobarPantalla(app, "agenda")
        Thread.sleep(forTimeInterval: 0.6)
        XCTAssertEqual(titulo.frame.minY, bajado, accuracy: 2, "La agenda oculta ha subido sin que nadie lo pidiera")
    }
}
