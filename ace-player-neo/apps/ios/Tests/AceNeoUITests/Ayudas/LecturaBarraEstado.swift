import CoreGraphics
import UIKit
import XCTest

/// Lo que se ve en la zona de la hora de la barra de estado (arriba a la izquierda: el 35 % del ancho y los
/// 44 pt de arriba) en una captura de la pantalla. Sirve para comprobar que `HostingRaiz` aplica lo que piden
/// `EstadoVentana` y `PreferenciasLocales` (canarios C2 y C13) sin leer nada del proceso de la app.
struct LecturaBarraEstado: CustomStringConvertible {
    /// Luminancia mediana (0 negro, 1 blanco): el fondo de la zona.
    var fondo: Double
    /// Fracción de píxeles que se apartan del fondo más de 0,3: la hora (0 si no se lee o no está).
    var tinta: Double

    var description: String { String(format: "fondo %.3f · tinta %.4f", fondo, tinta) }

    @MainActor
    static func ahora() -> LecturaBarraEstado {
        let imagen = XCUIScreen.main.screenshot().image
        guard let cg = imagen.cgImage else { return LecturaBarraEstado(fondo: 0, tinta: 0) }
        let ancho = Int(Double(cg.width) * 0.35)
        let alto = Int(Double(cg.height) * 44.0 / 844.0)
        guard let recorte = cg.cropping(to: CGRect(x: 0, y: 0, width: ancho, height: alto)) else {
            return LecturaBarraEstado(fondo: 0, tinta: 0)
        }
        let luminancias = LecturaBarraEstado.luminancias(recorte, ancho: ancho, alto: alto)
        return LecturaBarraEstado.leer(luminancias)
    }

    private static func luminancias(_ imagen: CGImage, ancho: Int, alto: Int) -> [Double] {
        var bytes = [UInt8](repeating: 0, count: ancho * alto * 4)
        let espacio = CGColorSpaceCreateDeviceRGB()
        let info: UInt32 = CGImageAlphaInfo.premultipliedLast.rawValue
        bytes.withUnsafeMutableBytes { puntero in
            let contexto = CGContext(data: puntero.baseAddress, width: ancho, height: alto, bitsPerComponent: 8,
                                     bytesPerRow: ancho * 4, space: espacio, bitmapInfo: info)
            contexto?.draw(imagen, in: CGRect(x: 0, y: 0, width: ancho, height: alto))
        }
        var salida: [Double] = []
        salida.reserveCapacity(ancho * alto)
        var i = 0
        while i + 2 < bytes.count {
            let rojo: Double = Double(bytes[i]) / 255
            let verde: Double = Double(bytes[i + 1]) / 255
            let azul: Double = Double(bytes[i + 2]) / 255
            let y: Double = 0.2126 * rojo + 0.7152 * verde + 0.0722 * azul
            salida.append(y)
            i += 4
        }
        return salida
    }

    private static func leer(_ luminancias: [Double]) -> LecturaBarraEstado {
        guard !luminancias.isEmpty else { return LecturaBarraEstado(fondo: 0, tinta: 0) }
        let ordenadas = luminancias.sorted()
        let fondo: Double = ordenadas[ordenadas.count / 2]
        let apartadas: Int = luminancias.filter { abs($0 - fondo) > 0.3 }.count
        return LecturaBarraEstado(fondo: fondo, tinta: Double(apartadas) / Double(luminancias.count))
    }
}
