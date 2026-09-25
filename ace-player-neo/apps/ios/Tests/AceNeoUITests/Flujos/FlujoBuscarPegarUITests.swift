import UIKit
import XCTest

/// Flujos de «Buscar» y «Reproducir otro hash» (b-arquitectura §3.6, M5) contra la demo: buscar «dazn» en el
/// motor, «Enlace detectado» con un Content ID y pegar un hash (a mano y del portapapeles).
final class FlujoBuscarPegarUITests: XCTestCase {
    private let hash = "a1b2c3d4e5f60718293a4b5c6d7e8f90abcdef12"
    /// «DAZN 1 HD», el resultado del motor de la demo.
    private let resultadoDazn = "d4e5f60718293a4b5c6d7e8f9012345678901a2b"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    private func arrancarEn(_ pestana: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AceNeoDemo"]
        app.launch()
        tocarPestana(app, pestana)
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
    private func escribirEnBuscar(_ app: XCUIApplication, _ texto: String) {
        let campo = elementoUI(app, IDUI.campoBuscar)
        XCTAssertTrue(campo.waitForExistence(timeout: 15), "No hay campo de búsqueda")
        XCTAssertFalse(app.keyboards.firstMatch.exists, "Entrar en Buscar no debe subir el teclado")
        campo.tap()
        campo.typeText(texto)
    }

    @MainActor
    func testBuscarDaznEnElMotor() throws {
        let app = arrancarEn("buscar")
        XCTAssertTrue(conTextoUI(app, "Busca canales publicados en el motor AceStream.").waitForExistence(timeout: 10), "Falta la pista")
        escribirEnBuscar(app, "dazn")
        XCTAssertTrue(elementoUI(app, IDUI.resultado(resultadoDazn)).waitForExistence(timeout: 10), "No llega el resultado del motor")
        XCTAssertTrue(conTextoUI(app, "En tu biblioteca").exists, "Falta «En tu biblioteca» (DAZN está en la lista)")
        captura(app, "buscar")
    }

    @MainActor
    func testEnlaceDetectado() throws {
        let app = arrancarEn("buscar")
        escribirEnBuscar(app, "acestream://\(hash)")
        XCTAssertTrue(elementoUI(app, IDUI.enlaceDetectado).waitForExistence(timeout: 5), "No se detecta el enlace")
        XCTAssertTrue(conTextoUI(app, "Es un Content ID de AceStream").exists)
        XCTAssertFalse(conTextoUI(app, "En el motor AceStream").exists, "Con enlace no se pregunta al motor")
        captura(app, "buscar-enlace")
        app.buttons["Reproducir"].firstMatch.tap()
        XCTAssertTrue(elementoUI(app, IDUI.teatro).waitForExistence(timeout: 10), "«Reproducir» no abre el canal")
    }

    @MainActor
    func testPegarUnHash() throws {
        let app = arrancarEn("biblioteca")
        let boton = app.buttons["Pegar un Content ID o enlace acestream://"].firstMatch
        XCTAssertTrue(boton.waitForExistence(timeout: 15), "No está «Pegar hash» en la cabecera")
        boton.tap()
        XCTAssertTrue(elementoUI(app, IDUI.hojaPegar).waitForExistence(timeout: 5), "No se abre «Reproducir otro hash»")
        let reproducir = app.buttons["Reproducir hash"].firstMatch
        XCTAssertFalse(reproducir.isEnabled, "Sin hash válido, «Reproducir hash» va deshabilitado")
        app.typeText("no vale")
        XCTAssertTrue(conTextoUI(app, "Introduce un Content ID o enlace AceStream válido").waitForExistence(timeout: 5))
        app.buttons["Borrar Content ID"].firstMatch.tap()
        app.typeText(hash)
        XCTAssertTrue(conTextoUI(app, "Hash detectado:").waitForExistence(timeout: 5))
        XCTAssertTrue(reproducir.isEnabled)
        captura(app, "pegar")
        reproducir.tap()
        XCTAssertTrue(elementoUI(app, IDUI.teatro).waitForExistence(timeout: 10), "«Reproducir hash» no abre el canal")
    }

    @MainActor
    func testPegarDelPortapapeles() throws {
        UIPasteboard.general.string = "http://umbrel.local:7792/ace/getstream?id=\(hash)"
        let app = arrancarEn("buscar")
        let boton = app.buttons["Pegar un Content ID o enlace acestream://"].firstMatch
        XCTAssertTrue(boton.waitForExistence(timeout: 15))
        boton.tap()
        XCTAssertTrue(elementoUI(app, IDUI.hojaPegar).waitForExistence(timeout: 5))
        elementoUI(app, IDUI.botonPegarPortapapeles).tap()
        // iOS pregunta la primera vez: «Permitir pegar» (pregunta A-5 de la arquitectura).
        let sistema = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for texto in ["Permitir pegar", "Allow Paste"] {
            let permitir = sistema.buttons[texto]
            if permitir.waitForExistence(timeout: 2) {
                permitir.tap()
                break
            }
        }
        XCTAssertTrue(conTextoUI(app, "Hash detectado:").waitForExistence(timeout: 5), "El portapapeles no rellena el campo")
    }
}
