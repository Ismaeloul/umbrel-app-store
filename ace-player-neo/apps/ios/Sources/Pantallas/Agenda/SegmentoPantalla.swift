import SwiftUI

/* `Segmented` / `Tabs` de la web (ui/Segmented.css) para las pantallas de M5, con lo que el `Segmentado` de
   Palco no trae: una opción deshabilitada (a opacidad 0,5: «Para ti» sin gustos) y el identificador de cada
   opción para las pruebas. Pista `--line-soft` con relleno 4, columnas iguales, gota `--surface` que se desliza
   con el muelle estándar; el color del texto cambia al instante. La háptica la pone quien cambia. */

struct OpcionPantalla<Valor: Hashable>: Identifiable {
    var valor: Valor
    var titulo: String
    var contador: Int?
    var icono: NombreIcono?
    var identificador: String
    var habilitada = true
    var id: Valor { valor }
}

struct SegmentoPantalla<Valor: Hashable>: View {
    let opciones: [OpcionPantalla<Valor>]
    let seleccion: Valor
    let bloque: Bool
    let etiqueta: String
    let cambiar: (Valor) -> Void
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.movimientoReducido) private var reducido
    @State private var ancho: CGFloat = 0

    private var indice: Int { opciones.firstIndex { $0.valor == seleccion } ?? 0 }
    private var celda: CGFloat { opciones.isEmpty ? 0 : ancho / CGFloat(opciones.count) }

    /// Relleno lateral `clamp(8, 3vw, 16)`; ≤ 380: 6.
    private var relleno: CGFloat {
        if maquetacion.estrecho380 { return 6 }
        return CGFloat(min(16, max(8, 0.03 * maquetacion.ancho)))
    }

    var body: some View {
        ZStack(alignment: .leading) {
            GotaPantalla()
                .frame(width: celda, height: 36)
                .offset(x: celda * CGFloat(indice))
                .animation(Movimiento.estandar(reducido), value: indice)
            FilaIgual(bloque: bloque) {
                ForEach(opciones) { opcion in boton(opcion) }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { ancho = $0 }
        }
        .padding(4)
        .background(Palco.lineSoft, in: Capsule())
        .accessibilityElement(children: .contain)
        .accessibilityLabel(etiqueta)
    }

    private func boton(_ opcion: OpcionPantalla<Valor>) -> some View {
        let activa = opcion.valor == seleccion
        return Button {
            if opcion.valor != seleccion { cambiar(opcion.valor) }
        } label: {
            HStack(spacing: maquetacion.estrecho380 ? 4 : 6) {
                if let icono = opcion.icono { IconoPalco(icono, tamano: 18) }
                Text(opcion.titulo).estilo(.segmento).lineLimit(1)
                if let contador = opcion.contador {
                    Num("\(contador)", tamano: 13).foregroundStyle(Palco.text3)
                }
            }
            .padding(.horizontal, relleno)
            .frame(maxWidth: .infinity)
            .frame(height: 36)
            .contentShape(Rectangle().inset(by: -4))
        }
        .buttonStyle(EstiloPulsar())
        .foregroundStyle(activa ? Palco.text : Palco.text2)
        .disabled(!opcion.habilitada)
        .opacity(opcion.habilitada ? 1 : 0.5)
        .accessibilityAddTraits(activa ? [.isSelected] : [])
        .accessibilityIdentifier(opcion.identificador)
    }
}

/// La gota: `--surface`, brillo arriba, `0 4 14 −6` negra al 35 % y filo `--line-soft`.
private struct GotaPantalla: View {
    var body: some View {
        Capsule()
            .fill(Palco.surface)
            .brilloSuperior(forma: Capsule())
            .background(Capsule().stroke(Palco.lineSoft, lineWidth: 2))
            .sombra([CapaSombra(y: 4, desenfoque: 14, expansion: -6, color: Color.black.opacity(0.35))], forma: Capsule())
    }
}
