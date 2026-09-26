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
    /// Titular de 30 también en tableta (la agenda en pantalla baja: agenda.css `max-height: 540px`).
    var titularBajo = false
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

    /// El titular de 30 en tableta (la agenda en pantalla baja, a3 §12).
    func conTitularBajo(_ bajo: Bool) -> CabeceraVista {
        var copia = self
        copia.titularBajo = bajo
        return copia
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
                .estilo(ancha && !titularBajo ? .titularVistaAncha : .titularVista)
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
        } else if !ocultarMotor, !ancha, let estadoMotor {  // ≥ 768 el motor va en la barra superior (view-header.css)
            IndicadorMotor(estadoMotor, soloIcono: maquetacion.estrecho380) { abrirSaludMotor?.ejecutar() }
        }
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
