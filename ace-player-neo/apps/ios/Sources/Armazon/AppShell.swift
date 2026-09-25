import SwiftUI

/* El armazón de la app (b-arquitectura §2.4.6, M4). PROVISIONAL de I0 (fase 0.3b): SOLO la pestaña
   actual (sin mantener vivas las visitadas), la capa de encima (teatro o sistema) y una barra de
   pestañas provisional (texto sobre `Palco.surface`) para que la app navegue con las pantallas en stub.
   M4 escribe las capas de verdad (CapaPestanas con las visitadas vivas, CapaPartido, VeloInferior,
   BarraPestanas con glassEffect, CapaMini, CapaVuelo, CapaAvisos, CapaInmersiva) y mide la Maquetacion.
   Ojo, M4: con las pestañas vivas, `.opacity(0)` + `.accessibilityHidden(true)` NO bastó para que
   XCUITest dejara de ver la pestaña oculta (CI 36175911002: «Se ve agenda estando en biblioteca»). */

struct AppShell: View {
    @Environment(Navegador.self) private var navegador
    @Environment(CentroHojas.self) private var hojas

    var body: some View {
        ZStack(alignment: .bottom) {
            Palco.bg.ignoresSafeArea()
            if navegador.capa == nil { VistaPestana(pestana: navegador.pestana) }
            if let capa = navegador.capa { capaEncima(capa) }
            if navegador.capa == nil { BarraPestanasProvisional() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.armazon)
        .hojasDeLaApp(hojas)
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
