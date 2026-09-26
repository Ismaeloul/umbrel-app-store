import SwiftUI

/* Ajustes (b-arquitectura §2.8, M7; a6 §2; SettingsView.tsx): cabecera «Ajustes» con el motor (o «Modo demo»),
   el índice en chips y las nueve tarjetas en su orden (sin «Servidor», A-1). Tocar un chip no apila ni anima la
   vista: fija la sección y desplaza su tarjeta a 16 del borde de arriba (la primera vez sin animación; después
   con el muelle estándar, instantáneo con movimiento reducido); si ya era la actual, solo vuelve a desplazar.
   La carga diferida de Salud y Acerca de de la web (`WhenNear`) es técnica de la web (a6 §16): aquí van todas. */

struct AjustesView: View {
    @Environment(Navegador.self) private var navegador
    @Environment(DatosApp.self) private var datos
    @Environment(Haptica.self) private var haptica
    @Environment(PresentacionReproductor.self) private var presentacion
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.movimientoReducido) private var reducido
    @Environment(\.vistaActiva) private var vistaActiva
    @Environment(\.modoDemo) private var modoDemo
    @State private var primeraVez = true
    @State private var ir: SeccionAjustes?

    var body: some View {
        ScrollViewReader { lector in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    CabeceraVista("Ajustes") { EmptyView() }
                        .padding(.bottom, -16)
                        .background(alignment: .top) { Color.clear.frame(height: 1).id("arriba") }
                    IndiceChips(actual: navegador.seccionAjustes, alElegir: elegir)
                    SeccionesAjustes()
                }
                .padding(.leading, maquetacion.rellenoIzquierdo)
                .padding(.trailing, maquetacion.rellenoDerecho)
                .padding(.bottom, maquetacion.rellenoInferiorContenido(mini: conMini, teatro: false))
            }
            // El armazón (M4) ignora las zonas seguras: la de arriba vuelve como margen de la lista, así la cabecera no
            // queda bajo la hora y el ancla de cada tarjeta cae a zona segura + 16 (a6 §2.4). Integración I1.
            .safeAreaPadding(.top, CGFloat(maquetacion.seguras.arriba))
            .scrollDismissesKeyboard(.interactively)
            .subeConLaBarraDeEstado(vistaActiva)
            .onChange(of: navegador.peticionSeccion, initial: true) { _, _ in ir = navegador.seccionAjustes }
            .onChange(of: ir) { _, destino in desplazar(lector, a: destino) }
            .onChange(of: vistaActiva) { _, activa in if activa { ir = navegador.seccionAjustes } }
            .onChange(of: navegador.subirArriba[.ajustes] ?? 0) { _, _ in
                withAnimation(Movimiento.estandar(reducido)) { lector.scrollTo("arriba", anchor: .top) }
            }
        }
        .background(Palco.bg.ignoresSafeArea())
        .environment(\.estadoMotor, estadoMotor)
        .environment(\.abrirSaludMotor, AccionPalco { [navegador] in navegador.ir(.ajustes(.salud)) })
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.pantalla("ajustes"))
    }

    /// Con el mini a la vista el colchón de abajo crece (a6 §2.1).
    private var conMini: Bool { presentacion.miniVisible(teatroVisible: navegador.teatroVisible, inmersivo: false) }

    /// El indicador del motor de la cabecera (`summarizeEngine`); en demo lo sustituye «Modo demo».
    private var estadoMotor: EstadoMotorVista? {
        guard !modoDemo else { return nil }
        if datos.motor.datos == nil && datos.motor.error != nil { return .sinRespuesta }
        switch datos.motor.datos?.status {
        case .online?: return .enLinea
        case .restarting?: return .arrancando
        case .offline?: return .apagado
        default: return .comprobando
        }
    }

    private func elegir(_ seccion: SeccionAjustes) {
        haptica.disparar(.seleccion)
        if navegador.seccionAjustes == seccion {
            ir = seccion
        } else {
            navegador.ir(.ajustes(seccion))
        }
    }

    private func desplazar(_ lector: ScrollViewProxy, a destino: SeccionAjustes?) {
        guard let destino else { return }
        let animar = !primeraVez && !reducido
        primeraVez = false
        if animar {
            withAnimation(Movimiento.estandar(false)) { lector.scrollTo(Self.ancla(destino), anchor: .top) }
        } else {
            lector.scrollTo(Self.ancla(destino), anchor: .top)
        }
        ir = nil
    }

    /// El ancla de cada tarjeta (16 pt por encima de ella).
    static func ancla(_ s: SeccionAjustes) -> String { "ancla-\(s.rawValue)" }
}

/// Las nueve tarjetas, cada una con su ancla 16 pt por encima (a6 §2.4: la tarjeta queda a zona segura + 16).
private struct SeccionesAjustes: View {
    var body: some View {
        Group {
            tarjeta(.listas) {
                TarjetaSeccion(.listas, titulo: "Listas", icono: .list,
                               descripcion: "Los canales de la lista activa salen en la biblioteca, en «Listas».") { SeccionListas() }
            }
            tarjeta(.futbol) { TarjetaSeccion(.futbol, titulo: "Tu fútbol", icono: .agenda) { SeccionTuFutbol() } }
            tarjeta(.reproduccion) {
                TarjetaSeccion(.reproduccion, titulo: "Reproducción", icono: .play) { SeccionReproduccion() }
            }
            tarjeta(.donde) {
                TarjetaSeccion(.donde, titulo: "Dónde se está reproduciendo", icono: .tv,
                               descripcion: "El canal que se está viendo ahora y en qué dispositivos. Se actualiza solo.") { SeccionDonde() }
            }
            tarjeta(.apariencia) { TarjetaSeccion(.apariencia, titulo: "Apariencia", icono: .sol) { SeccionApariencia() } }
            tarjeta(.dispositivos) {
                TarjetaSeccion(.dispositivos, titulo: "Dispositivos", icono: .movil) { SeccionDispositivos() }
            }
            tarjeta(.salud) { TarjetaSeccion(.salud, titulo: "Salud del sistema", icono: .senal) { SeccionSalud() } }
            tarjeta(.motor) { TarjetaSeccion(.motor, titulo: "Motor AceStream", icono: .motor) { SeccionMotor() } }
            tarjeta(.acerca) { TarjetaSeccion(.acerca, titulo: "Acerca de", icono: .info) { SeccionAcercaDe() } }
        }
    }

    private func tarjeta<Contenido: View>(_ s: SeccionAjustes, @ViewBuilder _ contenido: () -> Contenido) -> some View {
        // Un hueco transparente de 16 encima (con relleno negativo: no mueve nada) es el ancla del desplazamiento.
        VStack(spacing: 0) {
            Color.clear.frame(height: 16).id(AjustesView.ancla(s)).accessibilityHidden(true)
            contenido()
        }
        .padding(.top, -16)
    }
}
