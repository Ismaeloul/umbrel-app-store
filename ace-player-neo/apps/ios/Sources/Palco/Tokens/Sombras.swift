import SwiftUI

// Sombras de la web (b-arquitectura §2.2.6; a1 §5, §13.6; a2 §21.5). Formato CSS:
// `desplX desplY desenfoque [extensión] color`. SwiftUI no tiene extensión (spread): cada capa se pinta en
// un Canvas con la forma agrandada o encogida |extensión| por cada lado y SOLO la sombra (`.shadowOnly`),
// y luego se borra lo que queda debajo de la caja (una `box-shadow` exterior nunca se ve a través del
// elemento: importa en el cristal translúcido). Desenfoque CSS `B` = radio `B / 2` (a1 §5).

/// Una capa de `box-shadow` exterior.
struct CapaSombra: Hashable, Sendable {
    var x: CGFloat = 0
    var y: CGFloat
    var desenfoque: CGFloat
    var expansion: CGFloat = 0
    var color: Color
}

/// Las sombras con nombre de la web.
enum SombraPalco: Sendable {
    /// `--shadow-1` (tarjetas), `--shadow-2` (cristal, diálogos, barra, mini), `--shadow-poster` (carteles),
    /// cristal de vídeo, barra de pestañas y mini (las dos últimas = `--shadow-2`, shell.css y player.css).
    case s1, s2, s3, video, barra, mini

    var capas: [CapaSombra] {
        switch self {
        case .s1: // tokens.css:315/350: 0 1 2 α.06/.35 + 0 8 24 −16 α.20/.45
            [
                CapaSombra(y: 1, desenfoque: 2, color: Color(claro: 0x14151F, oscuro: 0x000000, alfaClaro: 0.06, alfaOscuro: 0.35)),
                CapaSombra(y: 8, desenfoque: 24, expansion: -16, color: Color(claro: 0x14151F, oscuro: 0x000000, alfaClaro: 0.2, alfaOscuro: 0.45)),
            ]
        case .s2, .barra, .mini: // tokens.css:316/351: 0 20 60 −20 α.22/.60
            [CapaSombra(y: 20, desenfoque: 60, expansion: -20, color: Color(claro: 0x14151F, oscuro: 0x000000, alfaClaro: 0.22, alfaOscuro: 0.6))]
        case .s3: // tokens.css:317/352: 0 8 24 α.12/.45
            [CapaSombra(y: 8, desenfoque: 24, color: Color(claro: 0x14151F, oscuro: 0x000000, alfaClaro: 0.12, alfaOscuro: 0.45))]
        case .video: // base.css .glass--video: 0 6 18 −8 rgb(2 8 18 / .55)
            [CapaSombra(y: 6, desenfoque: 18, expansion: -8, color: Color(hex: 0x020812, alfa: 0.55))]
        }
    }
}

extension View {
    /// Sombra exterior de la web detrás de la vista, con la forma de la vista.
    func sombra(_ s: SombraPalco, forma: some Shape = RoundedRectangle(cornerRadius: R.l)) -> some View {
        background(PintorSombra(capas: s.capas, forma: forma))
    }

    /// Sombras sueltas (`box-shadow` de un componente que no es un token).
    func sombra(_ capas: [CapaSombra], forma: some Shape) -> some View {
        background(PintorSombra(capas: capas, forma: forma))
    }

    /// `inset 0 0 0 <ancho> color`: borde por dentro de la forma.
    func bordeInterior(_ color: Color, ancho: CGFloat = 1, forma: some Shape) -> some View {
        overlay(BordeInterior(forma: forma, color: color, ancho: ancho))
    }

    /// `inset 0 1px 0 var(--glass-hi)`: filo de luz de 1 pt arriba.
    func brilloSuperior(forma: some Shape) -> some View {
        brilloSuperior(Palco.glassHi, forma: forma)
    }

    /// `inset 0 <alto> 0 color` (el brillo del botón primario, del cristal de vídeo…).
    func brilloSuperior(_ color: Color, alto: CGFloat = 1, forma: some Shape) -> some View {
        overlay(BrilloSuperior(forma: forma, color: color, alto: alto))
    }

    /// `inset <ancho> 0 0 color`: franja por dentro a la izquierda (línea de estado).
    func franjaIzquierda(_ color: Color, ancho: CGFloat, forma: some Shape) -> some View {
        overlay(FranjaIzquierda(forma: forma, color: color, ancho: ancho))
    }
}

/// Pinta las capas de una `box-shadow` exterior (sin tocar lo que queda debajo de la caja).
struct PintorSombra<Forma: Shape>: View {
    let capas: [CapaSombra]
    let forma: Forma

    private var margen: CGFloat {
        var mayor: CGFloat = 0
        for capa in capas {
            let desplazamiento: CGFloat = max(abs(capa.x), abs(capa.y))
            let crece: CGFloat = max(0, capa.expansion)
            mayor = max(mayor, capa.desenfoque + desplazamiento + crece)
        }
        return mayor
    }

    var body: some View {
        let margen = self.margen
        let capas = self.capas
        let forma = self.forma
        Canvas { contexto, tamano in
            Self.pintar(&contexto, tamano: tamano, margen: margen, capas: capas, forma: forma)
        }
        .padding(-margen)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private static func pintar(
        _ contexto: inout GraphicsContext, tamano: CGSize, margen: CGFloat, capas: [CapaSombra], forma: Forma
    ) {
        let ancho = tamano.width - 2 * margen
        let alto = tamano.height - 2 * margen
        guard ancho > 0, alto > 0 else { return }
        let caja = CGRect(x: margen, y: margen, width: ancho, height: alto)
        for capa in capas {
            var capaContexto = contexto
            capaContexto.addFilter(
                .shadow(color: capa.color, radius: capa.desenfoque / 2, x: capa.x, y: capa.y, options: .shadowOnly))
            let rect = caja.insetBy(dx: -capa.expansion, dy: -capa.expansion)
            capaContexto.fill(forma.path(in: rect), with: .color(.black))
        }
        contexto.blendMode = .destinationOut
        contexto.fill(forma.path(in: caja), with: .color(.black))
    }
}

private struct BordeInterior<Forma: Shape>: View {
    let forma: Forma
    let color: Color
    let ancho: CGFloat

    var body: some View {
        forma.stroke(color, lineWidth: ancho * 2)
            .clipShape(forma)
            .allowsHitTesting(false)
    }
}

private struct BrilloSuperior<Forma: Shape>: View {
    let forma: Forma
    let color: Color
    let alto: CGFloat

    var body: some View {
        forma.subtracting(forma.offset(y: alto))
            .fill(color)
            .allowsHitTesting(false)
    }
}

private struct FranjaIzquierda<Forma: Shape>: View {
    let forma: Forma
    let color: Color
    let ancho: CGFloat

    var body: some View {
        forma.subtracting(forma.offset(x: ancho))
            .fill(color)
            .allowsHitTesting(false)
    }
}
