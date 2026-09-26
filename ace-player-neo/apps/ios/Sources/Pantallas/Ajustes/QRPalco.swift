import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI

/* El QR para emparejar otro aparato, dibujado en el iPhone (a6 §8.10.5): desde el `pairUri` de la respuesta tal
   cual (byte a byte; el `qrSvg` se ignora), con CoreImage y corrección «M» (la del servidor). CoreImage devuelve 1
   px por módulo con su propio margen: se lee la matriz, se recorta y se vuelve a poner el margen de 2 módulos de
   `qrcode` (`N + 4` módulos). Se pinta como UNA sola `Path` negra (sin costuras entre módulos contiguos) escalada
   a su caja; nada de `Image` con `.interpolation(.none)` a un tamaño no entero (módulos de 4 y 5 px). */

struct QRPalco: Shape {
    /// Módulos oscuros, con el margen de 2 ya puesto (`N + 4` por lado).
    let matriz: [[Bool]]

    init(enlace: String) {
        matriz = QRPalco.matriz(enlace)
    }

    var lado: Int { matriz.count }

    func path(in rect: CGRect) -> Path {
        var camino = Path()
        let n = matriz.count
        guard n > 0 else { return camino }
        let modulo: CGFloat = min(rect.width, rect.height) / CGFloat(n)
        for (y, fila) in matriz.enumerated() {
            for (x, oscuro) in fila.enumerated() where oscuro {
                let origenX: CGFloat = rect.minX + CGFloat(x) * modulo
                let origenY: CGFloat = rect.minY + CGFloat(y) * modulo
                camino.addRect(CGRect(x: origenX, y: origenY, width: modulo, height: modulo))
            }
        }
        return camino
    }

    /// La matriz del QR de `texto` (nivel M), recortada y con 2 módulos de margen por lado.
    static func matriz(_ texto: String) -> [[Bool]] {
        let filtro = CIFilter.qrCodeGenerator()
        filtro.message = Data(texto.utf8)
        filtro.correctionLevel = "M"
        guard let imagen = filtro.outputImage,
            let cg = CIContext(options: [.useSoftwareRenderer: true]).createCGImage(imagen, from: imagen.extent)
        else { return [] }
        let bruta = leer(cg)
        return conMargen(recortar(bruta), margen: 2)
    }

    /// Píxel a píxel: oscuro si el rojo < 128.
    private static func leer(_ cg: CGImage) -> [[Bool]] {
        let ancho = cg.width
        let alto = cg.height
        var bytes = [UInt8](repeating: 255, count: ancho * alto * 4)
        let dibujado = bytes.withUnsafeMutableBytes { puntero -> Bool in
            guard let contexto = CGContext(
                data: puntero.baseAddress, width: ancho, height: alto, bitsPerComponent: 8, bytesPerRow: ancho * 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            else { return false }
            contexto.interpolationQuality = .none
            contexto.draw(cg, in: CGRect(x: 0, y: 0, width: ancho, height: alto))
            return true
        }
        guard dibujado else { return [] }
        return (0..<alto).map { (y: Int) -> [Bool] in
            (0..<ancho).map { (x: Int) -> Bool in bytes[(y * ancho + x) * 4] < 128 }
        }
    }

    /// Quita el borde blanco de CoreImage: de la primera a la última fila y columna con algún módulo oscuro.
    static func recortar(_ m: [[Bool]]) -> [[Bool]] {
        let filas = m.indices.filter { (i: Int) -> Bool in m[i].contains(true) }
        guard let primera = filas.first, let ultima = filas.last, let ancho = m.first?.count, ancho > 0 else { return [] }
        let columnas = (0..<ancho).filter { (x: Int) -> Bool in m.contains { (fila: [Bool]) -> Bool in fila[x] } }
        guard let izquierda = columnas.first, let derecha = columnas.last else { return [] }
        return (primera...ultima).map { (y: Int) -> [Bool] in Array(m[y][izquierda...derecha]) }
    }

    /// Añade `margen` módulos blancos por cada lado.
    static func conMargen(_ m: [[Bool]], margen: Int) -> [[Bool]] {
        guard let n = m.first?.count else { return [] }
        let blanca = [Bool](repeating: false, count: n + 2 * margen)
        let lateral = [Bool](repeating: false, count: margen)
        let medio = m.map { (fila: [Bool]) -> [Bool] in lateral + fila + lateral }
        return Array(repeating: blanca, count: margen) + medio + Array(repeating: blanca, count: margen)
    }
}

/// La tarjeta del QR (a6 §8.3): 208 × 208 (o el 62 % del ancho), relleno 12, blanca también en oscuro, radio 14,
/// sombra `0 0 0 1 rgba(0,0,0,.06)` + `--shadow-1`, con el texto alternativo de la app.
struct TarjetaQR: View {
    let qr: QRPalco
    let lado: CGFloat
    let direcciones: Int

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: R.m, style: .circular)
        qr.fill(Color.black)
            .frame(width: lado - 24, height: lado - 24)
            .padding(12)
            .background(Color.white, in: forma)
            .sombra([CapaSombra(y: 0, desenfoque: 0, expansion: 1, color: Color.black.opacity(0.06))] + SombraPalco.s1.capas,
                    forma: forma)
            .accessibilityElement()
            .accessibilityAddTraits(.isImage)
            .accessibilityLabel(direcciones > 1
                ? "Código QR para emparejar: lleva las direcciones de tu Umbrel y el código"
                : "Código QR para emparejar: lleva la dirección de tu Umbrel y el código")
    }
}
