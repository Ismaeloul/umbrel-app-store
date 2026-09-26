import SwiftUI

/* Cabeceras dentro de la lista (M5; a5 §3.5.7): la fecha de Recientes («HOY», «AYER»…) y la categoría de
   Listas (botón `--bg-sunk` que pliega y despliega, con el chevrón que gira con el muelle rápido). */

/// `h2.lib-when`: relleno 16 16 6; 13/700 +0,14 em MAYÚSCULAS `--text-3`.
struct CabeceraFecha: View {
    let tramo: String

    var body: some View {
        Text(tramo)
            .estilo(.kicker)
            .foregroundStyle(Palco.text3)
            .padding(.top, 16)
            .padding(.horizontal, 16)
            .padding(.bottom, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

/// `button.lib-cat`: alto 48, relleno 0 16, `--bg-sunk`, chevrón 8 × 8, nombre y contador.
struct CabeceraCategoria: View {
    let categoria: String
    let cuenta: Int
    let abierta: Bool
    let deshabilitada: Bool
    let alternar: () -> Void
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        Button(action: alternar) {
            HStack(spacing: 10) {
                Chevron()
                    .stroke(Palco.text3, style: StrokeStyle(lineWidth: 2))
                    .frame(width: 8, height: 8)
                    .rotationEffect(.degrees(abierta ? 45 : -45))
                    .offset(x: abierta ? -1 : 0, y: abierta ? -2 : 0)
                    .padding(.horizontal, 2)
                    .animation(Movimiento.rapido(reducido), value: abierta)
                Text(categoria).estilo(.kicker).lineLimit(1)
                Num("\(cuenta)", tamano: 13, etiqueta: ReglasBiblioteca.canales(cuenta)).foregroundStyle(Palco.text3)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 48)
            .background(Palco.bgSunk)
            .contentShape(Rectangle())
        }
        .buttonStyle(EstiloPulsar(forma: AnyShape(Rectangle())))  // deshabilitada no se pulsa: sin `.press`
        .foregroundStyle(Palco.text)
        .disabled(deshabilitada)
        .accessibilityIdentifier(IDUI.categoria(categoria))
    }
}

/// Bordes derecho e inferior de una caja de 8 × 8 (el `lib-cat__chev` de la web).
private struct Chevron: Shape {
    func path(in rect: CGRect) -> Path {
        var camino = Path()
        camino.move(to: CGPoint(x: rect.maxX, y: rect.minY))
        camino.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        camino.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        return camino
    }
}
