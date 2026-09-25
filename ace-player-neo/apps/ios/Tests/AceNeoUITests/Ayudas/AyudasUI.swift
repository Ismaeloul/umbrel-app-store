import UIKit
import XCTest

/// Un elemento por su identificador de accesibilidad, sea del tipo que sea.
@MainActor
func elementoUI(_ app: XCUIApplication, _ identificador: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identificador).firstMatch
}

/// Un elemento cuya etiqueta contiene un texto.
@MainActor
func conTextoUI(_ app: XCUIApplication, _ texto: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", texto)).firstMatch
}

/// Espera a que un elemento desaparezca.
@MainActor
func esperarQueDesaparezca(_ elemento: XCUIElement, plazo: TimeInterval = 10) -> Bool {
    let limite = Date().addingTimeInterval(plazo)
    while Date() < limite {
        if !elemento.exists { return true }
        Thread.sleep(forTimeInterval: 0.25)
    }
    return !elemento.exists
}

/// Arrastra con el dedo desde un punto relativo del elemento hasta otro
/// (`dy` en altos del elemento; negativo, hacia arriba). Más fiable que
/// `swipeUp()`/`swipeDown()`, cuyo recorrido depende del tamaño del elemento.
@MainActor
func arrastrar(_ elemento: XCUIElement, desde: CGVector, hasta: CGVector) {
    let inicio = elemento.coordinate(withNormalizedOffset: desde)
    let fin = elemento.coordinate(withNormalizedOffset: hasta)
    inicio.press(forDuration: 0.05, thenDragTo: fin)
}

/// Toca una pestaña de la barra de la app (la de la web, no un `TabView`) por su `IDUI`:
/// `agenda`, `biblioteca`, `buscar` o `ajustes` (el `rawValue` de `Pestana`).
@MainActor
func tocarPestana(_ app: XCUIApplication, _ id: String) {
    let boton = elementoUI(app, IDUI.pestana(id))
    XCTAssertTrue(boton.waitForExistence(timeout: 10), "No aparece la pestaña \(id)")
    boton.tap()
}

/// Los días de la tira de la agenda.
@MainActor
func diasDeLaAgenda(_ app: XCUIApplication) -> XCUIElementQuery {
    app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "dia-"))
}

/// La tira de días NO está vacía: hay días, todos se pueden pulsar y el
/// elegido se pinta de verdad (en el iPhone real la tira salía como una banda
/// blanca vacía aunque sus botones «existían»). Devuelve el motivo si falla.
@MainActor
func comprobarTiraDeDias(_ app: XCUIApplication, plazo: TimeInterval = 15) -> String? {
    let dias = diasDeLaAgenda(app)
    let limite = Date().addingTimeInterval(plazo)
    var motivo = "no hay días"
    while Date() < limite {
        let total = dias.count
        if total > 0 {
            let visibles = (0..<total).map { dias.element(boundBy: $0) }.filter { $0.frame.minX < app.frame.maxX }
            let elegido = dias.matching(NSPredicate(format: "selected == true")).firstMatch
            if visibles.isEmpty {
                motivo = "ningún día a la vista"
            } else if let fuera = visibles.first(where: { !$0.isHittable }) {
                motivo = "el día \(fuera.identifier) no se puede pulsar (marco: \(fuera.frame))"
            } else if !elegido.exists {
                motivo = "ningún día elegido"
            } else if !sePinta(app, elegido) {
                motivo = "el día elegido no se pinta (marco: \(elegido.frame))"
            } else {
                return nil
            }
        }
        Thread.sleep(forTimeInterval: 0.5)
    }
    return motivo
}

/// ¿Se PINTA de verdad el elemento? XCUITest da por «hittable» un botón que
/// está en su sitio y responde al toque aunque no se vea (así pasó con la tira
/// de días en el E2E). Se compara el color de un punto del elemento (por
/// defecto, dentro de su borde izquierdo, en el relleno y no en el texto) con
/// el del borde derecho de la misma franja, que es fondo: casi iguales, no se ve.
@MainActor
func sePinta(_ app: XCUIApplication, _ elemento: XCUIElement, margen: CGFloat = 5) -> Bool {
    guard elemento.exists, let imagen = app.screenshot().image.cgImage, app.frame.width > 0 else { return false }
    let escala = CGFloat(imagen.width) / app.frame.width
    let centro = CGPoint(x: (elemento.frame.minX + margen) * escala, y: elemento.frame.midY * escala)
    let fondo = CGPoint(x: CGFloat(imagen.width) - 6 * escala, y: centro.y)
    guard let delante = colorDe(imagen, en: centro), let detras = colorDe(imagen, en: fondo) else { return true }
    let diferencia = abs(delante.0 - detras.0) + abs(delante.1 - detras.1) + abs(delante.2 - detras.2)
    return diferencia > 60
}

/// Color (0…255) de un píxel de la imagen, con el origen arriba a la izquierda.
private func colorDe(_ imagen: CGImage, en punto: CGPoint) -> (Int, Int, Int)? {
    guard punto.x >= 0, punto.y >= 0, punto.x < CGFloat(imagen.width), punto.y < CGFloat(imagen.height) else {
        return nil
    }
    var pixel = [UInt8](repeating: 0, count: 4)
    let pintado = pixel.withUnsafeMutableBytes { bytes -> Bool in
        guard
            let contexto = CGContext(
                data: bytes.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return false }
        // El contexto tiene el origen abajo: se desplaza la imagen para que el píxel caiga en (0, 0).
        contexto.draw(
            imagen,
            in: CGRect(
                x: -punto.x.rounded(.down), y: -(CGFloat(imagen.height) - 1 - punto.y.rounded(.down)),
                width: CGFloat(imagen.width), height: CGFloat(imagen.height)))
        return true
    }
    return pintado ? (Int(pixel[0]), Int(pixel[1]), Int(pixel[2])) : nil
}
