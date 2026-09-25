import SwiftUI

/* El índice en chips de Ajustes (a6 §2.4; SettingsView.tsx `SECTIONS`): fila horizontal desplazable, sin barra
   ni imán, a sangre (16 + zona segura de relleno), separación 8. Cada chip mide 44 de alto: relleno 0 14 0 7,
   cápsula `--surface` con borde `--line-soft`, círculo de 30 `--surface-2` con el icono 20, texto 13/650 en
   `--text-2`; el actual, oro lavado con borde `--accent-edge`, texto `--accent-ink` y el círculo en oro. Sin
   «Servidor» (b-arquitectura A-1). No sigue al desplazamiento (la web tampoco). */

struct IndiceChips: View {
    let actual: SeccionAjustes?
    let alElegir: (SeccionAjustes) -> Void
    @Environment(\.maquetacion) private var maquetacion

    /// Título e icono de cada chip, en su orden (a6 §2.4).
    static func chip(_ s: SeccionAjustes) -> (titulo: String, icono: NombreIcono) {
        switch s {
        case .listas: ("Listas", .list)
        case .futbol: ("Tu fútbol", .agenda)
        case .reproduccion: ("Reproducción", .play)
        case .donde: ("Dónde se está reproduciendo", .tv)
        case .apariencia: ("Apariencia", .sol)
        case .dispositivos: ("Dispositivos", .movil)
        case .salud: ("Salud", .senal)
        case .motor: ("Motor AceStream", .motor)
        case .acerca: ("Acerca de", .info)
        }
    }

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(SeccionAjustes.allCases, id: \.self) { (seccion: SeccionAjustes) in
                    ChipIndice(seccion: seccion, actual: seccion == actual) { alElegir(seccion) }
                }
            }
            .padding(.vertical, 2)
            .padding(.leading, maquetacion.rellenoIzquierdo)
            .padding(.trailing, maquetacion.rellenoDerecho)
        }
        .scrollIndicators(.hidden)
        .padding(.leading, -maquetacion.rellenoIzquierdo)
        .padding(.trailing, -maquetacion.rellenoDerecho)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Secciones de Ajustes")
        .accessibilityIdentifier(IDUI.indiceAjustes)
    }
}

/// Un chip del índice (el enlace ES el chip).
private struct ChipIndice: View {
    let seccion: SeccionAjustes
    let actual: Bool
    let accion: () -> Void

    var body: some View {
        let datos = IndiceChips.chip(seccion)
        Button(action: accion) {
            HStack(spacing: 8) {
                IconoPalco(datos.icono, tamano: 20)
                    .foregroundStyle(actual ? Palco.onAccent : Palco.text2)
                    .frame(width: 30, height: 30)
                    .background(actual ? Palco.accent : Palco.surface2, in: Circle())
                Text(datos.titulo)
                    .estilo(EstiloTexto(tamano: 13, peso: 650, altoLinea: 1.45))
                    .foregroundStyle(actual ? Palco.accentInk : Palco.text2)
                    .lineLimit(1)
                    .fixedSize()
            }
            .padding(.leading, 7)
            .padding(.trailing, 14)
            .frame(minHeight: 44)
            .background(actual ? Palco.accentWash : Palco.surface, in: Capsule())
            .bordeInterior(actual ? Palco.accentEdge : Palco.lineSoft, forma: Capsule())
        }
        .buttonStyle(EstiloPulsar())
        .accessibilityLabel(datos.titulo)
        .accessibilityAddTraits(actual ? .isSelected : [])
        .accessibilityIdentifier(IDUI.chip(seccion.rawValue))
    }
}
