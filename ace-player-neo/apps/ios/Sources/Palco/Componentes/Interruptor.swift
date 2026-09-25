import SwiftUI

/// `<Switch>` de la web (a1 §10.22; ui/Field.css): 52×32 en cápsula, zona de 44. Apagado `--surface-2` con
/// borde `--line-strong` y pulgar `--surface` de 26 en (3, 3); encendido oro con borde `--accent-edge` y el
/// pulgar blanco 20 más a la derecha. El pulgar se mueve con el muelle estándar; los colores, al instante.
struct EstiloInterruptor: ToggleStyle {
    @Environment(\.movimientoReducido) private var reducido
    @Environment(\.isEnabled) private var habilitado

    func makeBody(configuration: Configuration) -> some View {
        let encendido = configuration.isOn
        return Button {
            configuration.isOn.toggle()
        } label: {
            ZStack(alignment: .leading) {
                Capsule().fill(encendido ? Palco.accent : Palco.surface2)
                    .bordeInterior(encendido ? Palco.accentEdge : Palco.lineStrong, forma: Capsule())
                PulgarInterruptor(encendido: encendido)
                    .offset(x: encendido ? 23 : 3)
                    .animation(Movimiento.estandar(reducido), value: encendido)
            }
            .frame(width: 52, height: 32)
        }
        .buttonStyle(EstiloPulsar())
        .foregroundStyle(Palco.text)
        .opacity(habilitado ? 1 : 0.5)
        .contentShape(Rectangle().inset(by: -6))
        .accessibilityAddTraits(.isToggle)
        .accessibilityValue(encendido ? "1" : "0")
    }
}

private struct PulgarInterruptor: View {
    let encendido: Bool

    var body: some View {
        Circle()
            .fill(encendido ? Color.white : Palco.surface)
            .frame(width: 26, height: 26)
            .bordeInterior(Palco.lineSoft, forma: Circle())
            .sombra([CapaSombra(y: 1, desenfoque: 3, color: PalcoFijo.sombraVideo.opacity(0.35))], forma: Circle())
    }
}

/// Fila «texto a la izquierda, interruptor a la derecha» (alto mínimo 56, separación 16): título 15/560 y
/// descripción 13 en `--text-2` (lh 18,85), separadas 2.
struct FilaInterruptor: View {
    let titulo: String
    let descripcion: String?
    @Binding var activo: Bool
    let deshabilitado: Bool

    init(_ titulo: String, descripcion: String? = nil, activo: Binding<Bool>, deshabilitado: Bool = false) {
        self.titulo = titulo
        self.descripcion = descripcion
        self._activo = activo
        self.deshabilitado = deshabilitado
    }

    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(titulo).estilo(EstiloTexto(tamano: 15, peso: 560, altoLinea: 1.45)).foregroundStyle(Palco.text)
                if let descripcion {
                    Text(descripcion).estilo(EstiloTexto(tamano: 13, peso: 450, altoLinea: 1.45)).foregroundStyle(Palco.text2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Toggle(isOn: $activo) { Text(titulo) }
                .toggleStyle(EstiloInterruptor())
                .labelsHidden()
                .disabled(deshabilitado)
        }
        .frame(minHeight: 56)
        .accessibilityElement(children: .combine)
    }
}
