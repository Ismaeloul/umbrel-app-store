import SwiftUI

/* El armazón de la app (b-arquitectura §2.4.6, M4). PROVISIONAL de I0 (fase 0.3b): las pestañas
   visitadas vivas en un ZStack (solo la actual visible), la capa de encima (teatro o sistema) y una
   barra de pestañas provisional (texto sobre `Palco.surface`) para que la app navegue con las pantallas
   en stub. M4 escribe las capas de verdad (CapaPestanas, CapaPartido, VeloInferior, BarraPestanas con
   glassEffect, CapaMini, CapaVuelo, CapaAvisos, CapaInmersiva) y mide la Maquetacion. */

struct AppShell: View {
    @Environment(Navegador.self) private var navegador
    @Environment(CentroHojas.self) private var hojas

    var body: some View {
        ZStack(alignment: .bottom) {
            Palco.bg.ignoresSafeArea()
            ForEach(Pestana.allCases) { pestana in
                if navegador.visitadas.contains(pestana) { capaPestana(pestana) }
            }
            if let capa = navegador.capa { capaEncima(capa) }
            if navegador.capa == nil { BarraPestanasProvisional() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.armazon)
        .hojasDeLaApp(hojas)
    }

    private func capaPestana(_ pestana: Pestana) -> some View {
        let visible = navegador.capa == nil && navegador.pestana == pestana
        return VistaPestana(pestana: pestana)
            .opacity(visible ? 1 : 0)
            .allowsHitTesting(visible)
            .accessibilityHidden(!visible)
            .environment(\.vistaActiva, visible)
    }

    @ViewBuilder private func capaEncima(_ capa: Destino) -> some View {
        if capa.esTeatro {
            TeatroView(destino: capa)
        } else {
            SistemaView()
        }
    }
}

/// La pantalla de cada pestaña.
private struct VistaPestana: View {
    let pestana: Pestana
    var body: some View {
        switch pestana {
        case .agenda: AgendaView()
        case .canales: CanalesView()
        case .buscar: BuscarView()
        case .ajustes: AjustesView()
        }
    }
}

/// Barra de pestañas PROVISIONAL (la de la web con glassEffect es de M4): cuatro botones de texto.
private struct BarraPestanasProvisional: View {
    @Environment(Navegador.self) private var navegador

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Pestana.allCases) { pestana in boton(pestana) }
        }
        .frame(height: 64)
        .background(Palco.surface)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.barraPestanas)
    }

    private func boton(_ pestana: Pestana) -> some View {
        let activa = navegador.pestana == pestana
        return Button(pestana.titulo) { navegador.tocarPestana(pestana) }
            .foregroundStyle(activa ? Palco.accentInk : Palco.text2)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityAddTraits(activa ? .isSelected : [])
            .accessibilityIdentifier(IDUI.pestana(pestana.rawValue))
    }
}
