import UIKit
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
