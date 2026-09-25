import SwiftUI

/// `<Chip>` de la web (a1 §10.5; ui/Chip.css). Cápsula de 28 (botón 32, zona de 44), texto 12/650/88,
/// icono 16 y contador `Num` en `--text-3`. Con `accion` es un botón y `pulsado` lo marca en oro.
struct Chip: View {
    enum Tono: Sendable { case suave, mio, directo }
    enum Contorno: Sendable { case solido, discontinuo }

    let titulo: String
    let icono: NombreIcono?
    let contador: Int?
    let tono: Tono
    let contorno: Contorno?
    let pulsado: Bool
    let accion: (() -> Void)?
    @Environment(\.isEnabled) private var habilitado

    init(_ titulo: String, icono: NombreIcono? = nil, contador: Int? = nil, tono: Tono = .suave,
         contorno: Contorno? = nil, pulsado: Bool = false, accion: (() -> Void)? = nil) {
        self.titulo = titulo
        self.icono = icono
        self.contador = contador
        self.tono = tono
        self.contorno = contorno
        self.pulsado = pulsado
        self.accion = accion
    }

    var body: some View {
        if let accion {
            Button(action: accion) { contenido }
                .buttonStyle(EstiloPulsar())
                .foregroundStyle(tinta)
                .opacity(habilitado ? 1 : 0.55)
                .contentShape(Rectangle().inset(by: -6))  // Chip.css `.chip--button::before` (−6 −2)
                .accessibilityAddTraits(pulsado ? .isSelected : [])
        } else {
            contenido.foregroundStyle(tinta)
        }
    }

    private var contenido: some View {
        HStack(spacing: 6) {
            if let icono { IconoPalco(icono, tamano: 16) }
            Text(titulo).estilo(.chip).lineLimit(1)
            if let contador {
                Num(String(contador), tamano: 12)
                    .foregroundStyle(pulsado ? tinta : Palco.text3)
            }
        }
        .padding(.horizontal, relleno)
        .frame(minHeight: accion == nil ? 28 : 32)
        .background(fondo, in: Capsule())
        .overlay(ContornoChip(contorno: pulsado ? nil : contorno, pulsado: pulsado))
    }

    private var relleno: CGFloat {
        if tono == .directo && !pulsado { return 0 }
        return contorno == .discontinuo ? 11 : 10  // el borde discontinuo de 1 px ocupa sitio en la web
    }

    private var tinta: Color {
        if pulsado { return Palco.accentInk }
        switch contorno {
        case .solido?: return Palco.text
        case .discontinuo?: return Palco.text2
        case nil: break
        }
        switch tono {
        case .suave: return Palco.text2
        case .mio: return Palco.accentInk
        case .directo: return Palco.liveInk
        }
    }

    private var fondo: Color {
        if pulsado { return Palco.accentWash }
        switch contorno {
        case .solido?: return Palco.surface
        case .discontinuo?: return Color.clear
        case nil: break
        }
        switch tono {
        case .suave: return Palco.lineSoft
        case .mio: return Palco.accentWash
        case .directo: return Color.clear
        }
    }
}

private struct ContornoChip: View {
    let contorno: Chip.Contorno?
    let pulsado: Bool

    var body: some View {
        if pulsado {
            Capsule().strokeBorder(Palco.accentEdge.opacity(0.55), lineWidth: 1)
        } else {
            switch contorno {
            case .solido?: Capsule().strokeBorder(Palco.lineStrong, lineWidth: 1)
            case .discontinuo?:
                Capsule().strokeBorder(Palco.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            case nil: EmptyView()
            }
        }
    }
}
