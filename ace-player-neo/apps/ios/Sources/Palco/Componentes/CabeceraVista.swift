import SwiftUI

enum EstadoMotorVista: Sendable { case enLinea, arrancando, apagado, comprobando, sinRespuesta }

extension EnvironmentValues {
    /// Estado del motor que pinta la cabecera de cada vista (lo publica quien tiene los datos; nil = sin indicador).
    @Entry var estadoMotor: EstadoMotorVista? = nil
    /// Qué hace tocar el indicador del motor (Ajustes › Salud).
    @Entry var abrirSaludMotor: AccionPalco? = nil
}

/// Una acción que se puede guardar en el entorno.
struct AccionPalco: Sendable {
    let ejecutar: @MainActor @Sendable () -> Void
}

/// `<ViewHeader>` de la web (a2 §6; app/view-header.css). Relleno 20 arriba (dentro de la zona segura; ≥ 768:
/// 24) y 16 abajo. Título 30/800/125 (≥ 768: 44) en una línea con elipsis; subtítulo 13/560 en `--text-2`;
/// a la derecha «Modo demo» (en demo) o el indicador del motor, y las acciones de la vista. Si no caben al
/// lado del título, las acciones bajan a la línea siguiente alineadas a la derecha.
struct CabeceraVista<Acciones: View>: View {
    let titulo: String
    let subtitulo: String?
    let sobreOscuro: Bool
    let ocultarMotor: Bool
    let acciones: Acciones
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.modoDemo) private var modoDemo
    @Environment(\.estadoMotor) private var estadoMotor
    @Environment(\.abrirSaludMotor) private var abrirSaludMotor

    init(_ titulo: String, subtitulo: String? = nil, sobreOscuro: Bool = false, ocultarMotor: Bool = false,
         @ViewBuilder acciones: () -> Acciones) {
        self.titulo = titulo
        self.subtitulo = subtitulo
        self.sobreOscuro = sobreOscuro
        self.ocultarMotor = ocultarMotor
        self.acciones = acciones()
    }

    private var ancha: Bool { maquetacion.tipo == .tableta }

    var body: some View {
        FilaCabecera {
            titulos
            HStack(spacing: 4) {
                estado
                acciones
            }
        }
        .padding(.top, ancha ? 24 : 20)
        .padding(.bottom, 16)
        .environment(\.colorScheme, sobreOscuro ? .dark : esquema)
    }

    @Environment(\.colorScheme) private var esquema

    private var titulos: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(titulo)
                .estilo(ancha ? .titularVistaAncha : .titularVista)
                .foregroundStyle(Palco.text)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            if let subtitulo {
                Text(subtitulo).estilo(.subtituloVista).foregroundStyle(Palco.text2)
            }
        }
    }

    @ViewBuilder private var estado: some View {
        if modoDemo {
            EtiquetaModoDemo()
        } else if !ocultarMotor, let estadoMotor {
            IndicadorMotor(estadoMotor, soloIcono: maquetacion.estrecho380) { abrirSaludMotor?.ejecutar() }
        }
    }
}

/// «Modo demo» (a2 §6.4): cápsula de 26, relleno 0 10, oro lavado, 11/650/88. No es interactiva.
struct EtiquetaModoDemo: View {
    var body: some View {
        Text("Modo demo")
            .estilo(.modoDemo)
            .foregroundStyle(Palco.accentInk)
            .padding(.horizontal, 10)
            .frame(minHeight: 26)
            .background(Palco.accentWash, in: Capsule())
            .fixedSize()
    }
}

/// `.view-head__row`: títulos a la izquierda y acciones a la derecha; si no caben juntos, las acciones bajan
/// (separación 4 en vertical y 12 en horizontal, como el `flex-wrap` de la web).
private struct FilaCabecera: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let ancho = proposal.width ?? 390
        let partes = medir(subviews, ancho: ancho)
        return CGSize(width: ancho, height: partes.alto)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 2 else { return }
        let partes = medir(subviews, ancho: bounds.width)
        let acciones = subviews[1].sizeThatFits(.unspecified)
        if partes.juntas {
            let anchoTitulos = bounds.width - 12 - acciones.width
            let titulos = subviews[0].sizeThatFits(ProposedViewSize(width: anchoTitulos, height: nil))
            subviews[0].place(at: CGPoint(x: bounds.minX, y: bounds.minY + (partes.alto - titulos.height) / 2),
                              proposal: ProposedViewSize(width: anchoTitulos, height: nil))
            subviews[1].place(at: CGPoint(x: bounds.maxX - acciones.width, y: bounds.minY + (partes.alto - acciones.height) / 2),
                              proposal: .unspecified)
        } else {
            let titulos = subviews[0].sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            subviews[0].place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: nil))
            subviews[1].place(at: CGPoint(x: bounds.maxX - acciones.width, y: bounds.minY + titulos.height + 4),
                              proposal: .unspecified)
        }
    }

    private func medir(_ subviews: Subviews, ancho: CGFloat) -> (juntas: Bool, alto: CGFloat) {
        guard subviews.count == 2 else { return (true, 0) }
        let titulos = subviews[0].sizeThatFits(.unspecified)
        let acciones = subviews[1].sizeThatFits(.unspecified)
        if acciones.width == 0 { return (true, titulos.height) }
        if titulos.width + 12 + acciones.width <= ancho { return (true, max(titulos.height, acciones.height)) }
        let titulosAjustados = subviews[0].sizeThatFits(ProposedViewSize(width: ancho, height: nil))
        return (false, titulosAjustados.height + 4 + acciones.height)
    }
}

/// `<EngineIndicator>` (a2 §6.5): botón de 44 (relleno 0 10, cápsula) con el rayo de 16 y el texto 12/600/88;
/// color según el estado. ≤ 380 de ancho: solo el rayo (el texto queda para VoiceOver).
struct IndicadorMotor: View {
    let estado: EstadoMotorVista
    let soloIcono: Bool
    let accion: () -> Void

    init(_ estado: EstadoMotorVista, soloIcono: Bool = false, accion: @escaping () -> Void) {
        self.estado = estado
        self.soloIcono = soloIcono
        self.accion = accion
    }

    /// Textos de `summarizeEngine` (api/hooks.ts).
    var texto: String {
        switch estado {
        case .enLinea: "Motor en línea"
        case .arrancando: "Motor arrancando…"
        case .apagado: "Motor apagado"
        case .comprobando: "Motor: comprobando…"
        case .sinRespuesta: "Motor sin respuesta"
        }
    }

    private var tinta: Color {
        switch estado {
        case .enLinea, .comprobando: Palco.text2
        case .arrancando: Palco.weakInk
        case .apagado, .sinRespuesta: Palco.failInk
        }
    }

    var body: some View {
        Button(action: accion) {
            HStack(spacing: 6) {
                IconoPalco(.motor, tamano: 16)
                if !soloIcono { Text(texto).estilo(.motor).lineLimit(1) }
            }
            .padding(.horizontal, 10)
            .frame(minWidth: 44, minHeight: 44)
        }
        .buttonStyle(EstiloPulsar())
        .foregroundStyle(tinta)
        .accessibilityLabel(texto)
        .accessibilityHint("Salud del sistema")
    }
}
