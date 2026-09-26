import SwiftUI

/* Cabecera «Agenda» (M5; a3 §3): `ViewHeader` de la web con «Modo demo» o el motor y el botón de actualizar
   (icono que gira 900 ms mientras carga; con movimiento reducido no gira y baja a 0,6). Sobre el héroe flota
   encima con los tokens en oscuro (la isla oscura) y blanco; sin héroe va en su sitio con los del tema. */

struct CabeceraAgenda: View {
    let sobreHeroe: Bool
    /// `.agenda-head__lede`: la frase del día bajo el titular, solo en ≥ 768 (en el móvil va oculta).
    var entradilla: String?
    let cargando: Bool
    let actualizar: () -> Void

    var body: some View {
        CabeceraVista("Agenda", subtitulo: entradilla, sobreOscuro: sobreHeroe) {
            BotonActualizar(cargando: cargando, accion: actualizar)
        }
        .padding(.bottom, -16)  // agenda.css `.agenda-head.view-head { padding-bottom: 0 }`
        .accessibilityElement(children: .contain)
    }
}

/// `IconButton` «Actualizar agenda de fútbol» (icono `refresh` que gira mientras carga).
private struct BotonActualizar: View {
    let cargando: Bool
    let accion: () -> Void
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        Button(action: accion) {
            IconoGiratorioAgenda(girando: cargando && !reducido)
                .opacity(cargando && reducido ? 0.6 : 1)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(EstiloPulsar(forma: AnyShape(Circle())))
        .foregroundStyle(Palco.text2)
        .disabled(cargando)
        .accessibilityLabel("Actualizar agenda de fútbol")
        .accessibilityIdentifier(IDUI.botonActualizarAgenda)
    }
}

/// `agenda-gira`: 360° en 900 ms, lineal, sin fin.
private struct IconoGiratorioAgenda: View {
    let girando: Bool

    var body: some View {
        if girando {
            TimelineView(.animation) { contexto in
                let t = contexto.date.timeIntervalSinceReferenceDate
                IconoPalco(.refresh, tamano: 24)
                    .rotationEffect(.degrees((t.truncatingRemainder(dividingBy: 0.9)) / 0.9 * 360))
            }
        } else {
            IconoPalco(.refresh, tamano: 24)
        }
    }
}
