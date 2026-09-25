import SwiftUI
import UIKit

/* El armazón de la app (b-arquitectura §2.4.6, M4). PROVISIONAL de I0 (fase 0.3b): SOLO la pestaña
   actual (sin mantener vivas las visitadas), la capa de encima (teatro o sistema) y una barra de
   pestañas provisional (texto sobre `Palco.surface`) para que la app navegue con las pantallas en stub.
   M4 escribe las capas de verdad (CapaPestanas con las visitadas vivas, CapaPartido, VeloInferior,
   BarraPestanas con glassEffect, CapaMini, CapaVuelo, CapaAvisos, CapaInmersiva) y mide la Maquetacion.
   Ojo, M4: con las pestañas vivas, `.opacity(0)` + `.accessibilityHidden(true)` NO bastó para que
   XCUITest dejara de ver la pestaña oculta (CI 36175911002: «Se ve agenda estando en biblioteca»).

   AÑADIDO PROVISIONAL de M6 (hasta que llegue el de M4, que sustituye este fichero entero): el mini
   (z 41), los toasts (z 60), la capa inmersiva (z 100), la `Maquetacion` medida con la ventana clave y,
   en Debug, `-AceNeoEscena <vista>` para abrir el teatro directamente en los UITests. */

struct AppShell: View {
    @Environment(Navegador.self) private var navegador
    @Environment(CentroHojas.self) private var hojas
    @Environment(PresentacionReproductor.self) private var presentacion
    @Environment(EstadoVentana.self) private var estadoVentana
    @Environment(Avisos.self) private var avisos
    @State private var maquetacion = Maquetacion.referencia

    private var inmersivo: Bool {
        maquetacion.inmersivo(teatroVisible: navegador.teatroVisible, forzado: presentacion.pantallaCompletaForzada)
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            Palco.bg.ignoresSafeArea()
            if navegador.capa == nil { VistaPestana(pestana: navegador.pestana) }
            if let capa = navegador.capa { capaEncima(capa) }
            if navegador.capa == nil { BarraPestanasProvisional() }
            CapasProvisionalesM6(inmersivo: inmersivo)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.armazon)
        .environment(\.maquetacion, maquetacion)
        .onGeometryChange(for: CGSize.self) { $0.size } action: { _ in medir() }
        .onChange(of: inmersivo, initial: true) { _, valor in
            estadoVentana.inmersivo = valor
            avisos.inmersivo = valor
        }
        .onChange(of: navegador.teatroVisible, initial: true) { _, valor in avisos.viendoTeatro = valor }
        .modifier(EscenaProvisional())
        .hojasDeLaApp(hojas)
    }

    @ViewBuilder private func capaEncima(_ capa: Destino) -> some View {
        if capa.esTeatro {
            TeatroView(destino: capa)
        } else {
            SistemaView()
        }
    }

    /// Tamaño y zonas seguras de la ventana clave (la web: `innerWidth`, `env(safe-area-inset-*)`).
    private func medir() {
        let escenas = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let ventana = escenas.first(where: { $0.activationState == .foregroundActive })?.keyWindow
            ?? escenas.first?.keyWindow
        else { return }
        let s: UIEdgeInsets = ventana.safeAreaInsets
        let seguras = Margenes(
            arriba: Double(s.top), izquierda: Double(s.left), abajo: Double(s.bottom), derecha: Double(s.right))
        maquetacion = Maquetacion(
            ancho: Double(ventana.bounds.width), alto: Double(ventana.bounds.height), seguras: seguras)
    }
}

/// Mini, toasts e inmersivo (provisional de M6 hasta CapaMini, CapaAvisos y CapaInmersiva de M4).
private struct CapasProvisionalesM6: View {
    let inmersivo: Bool
    @Environment(Navegador.self) private var navegador
    @Environment(PresentacionReproductor.self) private var presentacion

    private var mini: Bool {
        presentacion.miniVisible(teatroVisible: navegador.teatroVisible, inmersivo: inmersivo)
    }
    private var sobreBarra: CGFloat { navegador.capa == nil ? 64 : 0 }

    var body: some View {
        ZStack(alignment: .bottom) {
            if mini {
                MiniReproductor()
                    .padding(.horizontal, 12)
                    .padding(.bottom, sobreBarra + 8)
                    .transition(.opacity.combined(with: .offset(y: 12)))
                    .zIndex(Capa.mini)
            }
            if !inmersivo {
                ToastsProvisionales()
                    .padding(.bottom, sobreBarra + (mini ? 72 + 8 + 12 : 12))
                    .zIndex(Capa.avisos)
            }
            if inmersivo {
                EscenarioVideo(inmersivo: true)
                    .ignoresSafeArea()
                    .zIndex(Capa.inmersivo)
            }
        }
        .animation(.spring(duration: 0.4, bounce: 0.15), value: mini)
    }
}

/// Los toasts de `Avisos` (provisional: CapaAvisos es de M4).
private struct ToastsProvisionales: View {
    @Environment(Avisos.self) private var avisos

    var body: some View {
        VStack(spacing: 8) {
            ForEach(avisos.cola.toasts) { toast in
                ToastVista(toast, alAccion: { avisos.ejecutarAccion(toast.id) }, alCerrar: { avisos.cerrar(toast.id) })
                    .opacity(toast.saliendo ? 0 : 1)
            }
        }
        .padding(.horizontal, 12)
        .animation(.easeOut(duration: 0.32), value: avisos.cola.toasts)
    }
}

/// `-AceNeoEscena <vista>` (Debug): abre esa vista al montar el armazón (provisional hasta EscenasCaptura de I2).
private struct EscenaProvisional: ViewModifier {
    @Environment(Navegador.self) private var navegador

    func body(content: Content) -> some View {
        #if DEBUG
            content.task {
                guard let vista = ModoEjecucion.escena, let destino = Destino(vista: vista) else { return }
                navegador.ir(destino)
            }
        #else
            content
        #endif
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
