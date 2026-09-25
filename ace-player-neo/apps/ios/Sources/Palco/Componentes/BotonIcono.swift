import SwiftUI

/// `<IconButton>` de la web (a1 §10.3; ui/Button.css `.icon-btn`). Círculo de 44 (grande 56) con el icono de
/// 24 (grande 28) centrado; `etiqueta` es el nombre accesible (obligatorio). `pulsado` pinta el icono en oro
/// (y cambia a `iconoPulsado` si lo hay); `relleno` es la variante «relleno + trazo» del reproductor.
struct BotonIcono: View {
    let icono: NombreIcono
    let etiqueta: String
    let variante: BotonPalco.Variante
    let grande: Bool
    let pulsado: Bool?
    let iconoPulsado: NombreIcono?
    let relleno: Bool
    let ocupado: Bool
    let accion: () -> Void
    @Environment(\.isEnabled) private var habilitado

    init(_ icono: NombreIcono, etiqueta: String, variante: BotonPalco.Variante = .fantasma, grande: Bool = false,
         pulsado: Bool? = nil, iconoPulsado: NombreIcono? = nil, relleno: Bool = false, ocupado: Bool = false,
         accion: @escaping () -> Void) {
        self.icono = icono
        self.etiqueta = etiqueta
        self.variante = variante
        self.grande = grande
        self.pulsado = pulsado
        self.iconoPulsado = iconoPulsado
        self.relleno = relleno
        self.ocupado = ocupado
        self.accion = accion
    }

    private var activo: Bool { pulsado == true }
    private var lado: CGFloat { grande ? 56 : S.tap }

    var body: some View {
        Button(action: accion) { dibujo }
            .buttonStyle(EstiloPulsar(forma: AnyShape(Circle())))
            .foregroundStyle(tinta)
            .disabled(ocupado)
            .opacity(opacidad)
            .accessibilityLabel(etiqueta)
            .accessibilityAddTraits(activo ? .isSelected : [])
    }

    private var dibujo: some View {
        IconoPalco(activo ? (iconoPulsado ?? icono) : icono, tamano: grande ? 28 : 24, relleno: relleno)
            .frame(width: lado, height: lado)
            .background(FondoBotonIcono(variante: variante))
            .environment(\.colorScheme, variante == .video ? .dark : colorScheme)
    }

    @Environment(\.colorScheme) private var colorScheme

    private var tinta: Color {
        if activo { return variante == .video ? Palco.accent : Palco.accentInk }
        switch variante {
        case .fantasma: return Palco.text2
        case .quieto, .cristal: return Palco.text
        case .video: return Palco.onVideo
        case .primario: return Palco.onAccent
        case .peligro: return Palco.failInk
        }
    }

    private var opacidad: Double {
        if ocupado { return 0.75 }
        return habilitado ? 1 : 0.45
    }
}

private struct FondoBotonIcono: View {
    let variante: BotonPalco.Variante

    var body: some View {
        switch variante {
        case .quieto: Circle().fill(Palco.lineSoft)
        case .primario: Circle().fill(Palco.accent)
        case .cristal:
            Color.clear.cristal(.regular, en: Circle())
        case .fantasma, .video, .peligro: Color.clear
        }
    }
}
