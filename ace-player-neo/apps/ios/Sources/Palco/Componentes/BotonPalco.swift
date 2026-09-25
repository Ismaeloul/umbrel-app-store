import SwiftUI

/// `<Button>` de la web (a1 §10.2; ui/Button.css). Cápsula de 44 (sm 36 con zona de 44), icono delante 20
/// (sm 18) y detrás 18, texto 15/650 (sm 13) en una línea con elipsis. `pulsado` = interruptor
/// (`aria-pressed`); `ocupado` = deshabilitado a opacidad 0,75.
struct BotonPalco: View {
    enum Variante: Sendable { case primario, quieto, fantasma, cristal, video, peligro }
    enum Tamano: Sendable { case md, sm }

    let titulo: String
    let icono: NombreIcono?
    let iconoFinal: NombreIcono?
    let variante: Variante
    let tamano: Tamano
    let bloque: Bool
    let pulsado: Bool?
    let ocupado: Bool
    let accion: () -> Void
    @Environment(\.isEnabled) private var habilitado

    init(_ titulo: String, icono: NombreIcono? = nil, iconoFinal: NombreIcono? = nil, variante: Variante = .primario,
         tamano: Tamano = .md, bloque: Bool = false, pulsado: Bool? = nil, ocupado: Bool = false,
         accion: @escaping () -> Void) {
        self.titulo = titulo
        self.icono = icono
        self.iconoFinal = iconoFinal
        self.variante = variante
        self.tamano = tamano
        self.bloque = bloque
        self.pulsado = pulsado
        self.ocupado = ocupado
        self.accion = accion
    }

    private var sm: Bool { tamano == .sm }
    private var activo: Bool { pulsado == true }

    var body: some View {
        Button(action: accion) { etiqueta }
            .buttonStyle(EstiloPulsar())
            .foregroundStyle(tinta)
            .disabled(ocupado)
            .opacity(opacidad)
            .contentShape(Rectangle().inset(by: sm ? -4 : 0))  // sm: zona táctil de 44 (Button.css `.btn--sm::before`)
            .accessibilityAddTraits(activo ? .isSelected : [])
            .accessibilityValue(ocupado ? "Trabajando" : "")
    }

    private var etiqueta: some View {
        HStack(spacing: S.s2) {
            if let icono { IconoPalco(icono, tamano: sm ? 18 : 20) }
            Text(titulo)
                .estilo(sm ? .botonSm : .boton)
                .lineLimit(1)
                .truncationMode(.tail)
            if let iconoFinal { IconoPalco(iconoFinal, tamano: 18) }
        }
        .padding(.horizontal, sm ? 14 : 18)
        .frame(maxWidth: bloque ? .infinity : nil)
        .frame(minHeight: sm ? Alturas.botonSm : Alturas.control)
        .background(FondoBoton(variante: activo ? nil : variante))
        .environment(\.colorScheme, variante == .video ? .dark : colorScheme)
    }

    @Environment(\.colorScheme) private var colorScheme

    private var tinta: Color {
        if activo { return Palco.accentInk }
        switch variante {
        case .primario: return Palco.onAccent
        case .quieto, .fantasma, .cristal: return Palco.text
        case .video: return Palco.onVideo
        case .peligro: return Palco.failInk
        }
    }

    private var opacidad: Double {
        if ocupado { return 0.75 }
        return habilitado ? 1 : 0.55
    }
}

/// El fondo de cada variante (Button.css). `nil` = pulsado (`aria-pressed='true'`).
private struct FondoBoton: View {
    let variante: BotonPalco.Variante?

    var body: some View {
        switch variante {
        case nil:
            Capsule().fill(Palco.accentWash).bordeInterior(Palco.accentEdge.opacity(0.55), forma: Capsule())
        case .primario?:
            Capsule().fill(Palco.accent)
                .brilloSuperior(Color.white.opacity(0.35), forma: Capsule())
                .sombra([CapaSombra(y: 2, desenfoque: 8, color: Color.black.opacity(0.18))], forma: Capsule())
        case .quieto?:
            Capsule().fill(Palco.lineSoft)
        case .fantasma?:
            Color.clear
        case .cristal?:
            Color.clear.cristal(.regular, en: Capsule())
        case .video?:
            Color.clear.cristal(.videoBoton, en: Capsule())
                .bordeInterior(Color.white.opacity(0.12), forma: Capsule())
        case .peligro?:
            Capsule().fill(Palco.surface2).bordeInterior(Palco.fail.opacity(0.45), forma: Capsule())
        }
    }
}
