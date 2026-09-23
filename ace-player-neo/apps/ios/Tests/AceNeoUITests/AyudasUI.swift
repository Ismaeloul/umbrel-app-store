import XCTest

/// El botón de cerrar de la pantalla completa, a mano para tocarlo.
///
/// Los controles se esconden solos a los 3,2 s, un toque en el vídeo los
/// alterna y, al abrirse, la pantalla completa pide girar a horizontal (el
/// árbol de accesibilidad cambia mientras gira). Un solo toque «a ciegas»
/// podía esconderlos justo cuando aparecían; aquí se comprueba y se vuelve a
/// tocar (lejos de los botones del centro) hasta que el de cerrar se puede
/// pulsar. Devuelve nil si en `plazo` segundos no aparece.
@MainActor
func botonCerrarCompleta(_ app: XCUIApplication, plazo: TimeInterval = 20) -> XCUIElement? {
    let completo = app.descendants(matching: .any).matching(identifier: "reproductor-completo").firstMatch
    let cerrar = app.descendants(matching: .any).matching(identifier: "boton-cerrar-completa").firstMatch
    let limite = Date().addingTimeInterval(plazo)
    while Date() < limite {
        if cerrar.waitForExistence(timeout: 1.5), cerrar.isHittable { return cerrar }
        if completo.exists {
            completo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.28)).tap()
        }
    }
    return nil
}
