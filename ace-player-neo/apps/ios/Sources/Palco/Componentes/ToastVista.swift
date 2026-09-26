import SwiftUI

/// Icono y color de cada tono de aviso (ui/Toast.tsx, ui/StatusLine.tsx).
enum TonoAvisoPalco {
    static func icono(_ tono: TonoAviso) -> NombreIcono {
        switch tono {
        case .ok: .check
        case .info: .info
        case .warn, .err: .aviso
        }
    }

    static func tinta(_ tono: TonoAviso) -> Color {
        switch tono {
        case .ok: Palco.okInk
        case .info: Palco.text2
        case .warn: Palco.weakInk
        case .err: Palco.failInk
        }
    }

    /// Franja izquierda de la línea de estado (a1 §10.21).
    static func franja(_ tono: TonoAviso) -> Color {
        switch tono {
        case .ok: Palco.ok
        case .info: Palco.accentEdge
        case .warn: Palco.weak
        case .err: Palco.fail
        }
    }
}

/// Un toast de la web (a1 §10.20; ui/Toast.css): cristal denso de radio 26, alto mínimo 52, relleno 6 6 6 16,
/// icono 20 del tono, texto 15/560 (lh 1,25, varias líneas) con « ×n» si se repite, y la acción («Deshacer»,
/// cápsula de 44 en oro) con su «Cerrar aviso» (círculo de 44, `x` 18). Solo la vista: la cola es `Avisos`.
struct ToastVista: View {
    let toast: Toast
    let alAccion: () -> Void
    let alCerrar: () -> Void

    init(_ toast: Toast, alAccion: @escaping () -> Void, alCerrar: @escaping () -> Void) {
        self.toast = toast
        self.alAccion = alAccion
        self.alCerrar = alCerrar
    }

    var body: some View {
        let forma = RoundedRectangle(cornerRadius: 26, style: .circular)
        HStack(spacing: 10) {
            IconoPalco(toast.icono ?? TonoAvisoPalco.icono(toast.tono), tamano: 20)
                .foregroundStyle(TonoAvisoPalco.tinta(toast.tono))
            texto.frame(maxWidth: .infinity, alignment: .leading)
            if let titulo = toast.tituloAccion { acciones(titulo) }
        }
        .padding(.leading, 16)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .frame(maxWidth: 420, minHeight: Alturas.toast)
        .cristal(.denso, en: forma)
        .sombra(.s2, forma: forma)
        // Como el `role="status"` de la web: el texto y sus dos botones, cada uno por separado (con `.combine`
        // los botones no llegaban a VoiceOver ni a XCUITest por su nombre).
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.toast)
    }

    private var texto: some View {
        let veces: Text = Text(verbatim: " ×\(toast.repeticiones)")
            .foregroundStyle(Palco.text2)
            .font(Mona.fuente(15, peso: 780, anchura: 75))
        let repetido: Text = toast.repeticiones > 1 ? veces : Text(verbatim: "")
        let principal: Text = Text(verbatim: toast.texto)
        return Text("\(principal)\(repetido)")
            .estilo(.toast)
            .foregroundStyle(Palco.text)
            .padding(.vertical, 8)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func acciones(_ titulo: String) -> some View {
        HStack(spacing: 0) {
            Button(action: alAccion) {
                Text(titulo)
                    .estilo(EstiloTexto(tamano: 15, peso: 650, altoLinea: 1.1))
                    .padding(.horizontal, 14)
                    .frame(minHeight: 44)
            }
            .buttonStyle(EstiloPulsar())
            .foregroundStyle(Palco.accentInk)
            .accessibilityIdentifier(IDUI.toastAccion)
            Button(action: alCerrar) {
                IconoPalco(.x, tamano: 18).frame(width: 44, height: 44)
            }
            .buttonStyle(EstiloPulsar(forma: AnyShape(Circle())))
            .foregroundStyle(Palco.text2)
            .accessibilityLabel("Cerrar aviso")
            .accessibilityIdentifier(IDUI.toastCerrar)
        }
    }
}
