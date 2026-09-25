import SwiftUI

// Iconos de ui/icons.ts (b-arquitectura §2.2.4; a1 §10.1, §12, §13.8). `ParteIcono` vive en
// TrazosIcono.generado.swift (lo escribe el generador).

/// Un icono de ui/icons.ts en la rejilla 24, escalado al rectángulo. Trazo 1,8/24 del lado, puntas y uniones redondas.
struct FormaIcono: Shape {
    let nombre: NombreIcono
    var parte: ParteIcono = .trazo
    func path(in rect: CGRect) -> Path { TrazosIcono.camino(nombre, parte: parte, en: rect) }
}

/// `<Icon>` de la web: trazo `currentColor` 1,8 (en unidades del dibujo) y las piezas rellenas. Con
/// `relleno: true`, la variante del reproductor (a1 §10.1): la parte de trazo además rellena (regla no nula).
/// Hereda el color del primer plano (`.foregroundStyle`). Decorativo (sin nombre accesible).
struct IconoPalco: View {
    let nombre: NombreIcono
    let tamano: CGFloat
    let relleno: Bool

    init(_ nombre: NombreIcono, tamano: CGFloat = 20, relleno: Bool = false) {
        self.nombre = nombre
        self.tamano = tamano
        self.relleno = relleno
    }

    var body: some View {
        let estiloTrazo = StrokeStyle(lineWidth: 1.8 * tamano / 24, lineCap: .round, lineJoin: .round)
        ZStack {
            if relleno {
                FormaIcono(nombre: nombre, parte: .trazo).fill()
            }
            FormaIcono(nombre: nombre, parte: .trazo).stroke(style: estiloTrazo)
            FormaIcono(nombre: nombre, parte: .relleno).fill()
        }
        .frame(width: tamano, height: tamano)
        .accessibilityHidden(true)
    }
}
