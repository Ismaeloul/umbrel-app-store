import SwiftUI

/* El armazón de la app (b-arquitectura §2.4.6, M4; a2 §3). Un ZStack a toda la ventana (ignora las zonas seguras;
   cada capa se coloca con `Maquetacion`, que las suma) con las capas en el orden de la web:

     CapaPestanas z 0 · CapaPartido z 20 · VeloInferior z 39 · BarraPestanas / BarraSuperior z 40 · CapaMini z 41 ·
     CapaVuelo z 45 · CapaAvisos z 60 · CapaInmersiva z 100 · y la única puerta a las hojas.

   Aquí se decide el inmersivo (`immersive = pantalla completa pedida || (teatro && phoneLandscape)`, a2 §2.3) y se
   publica en `EstadoVentana` (barra de estado, indicador de inicio, bordes) y en `Avisos`. */

struct AppShell: View {
    @Environment(Navegador.self) private var navegador
    @Environment(CentroHojas.self) private var hojas
    @Environment(PresentacionReproductor.self) private var presentacion
    @Environment(\.maquetacion) private var maquetacion

    var body: some View {
        let inmersivo: Bool = maquetacion.inmersivo(
            teatroVisible: navegador.teatroVisible, forzado: presentacion.pantallaCompletaForzada)
        ZStack(alignment: .topLeading) {
            Palco.bg
            CapaPestanas().zIndex(Capa.pestanas)
            CapaPartido(inmersivo: inmersivo).zIndex(Capa.partido)
            BarrasDelArmazon(inmersivo: inmersivo).zIndex(Capa.velo)
            CapaMini(inmersivo: inmersivo).zIndex(Capa.mini)
            CapaVuelo().zIndex(Capa.vuelo)
            CapaAvisos(inmersivo: inmersivo).zIndex(Capa.avisos)
            CapaInmersiva(inmersivo: inmersivo).zIndex(Capa.inmersivo)
            #if DEBUG
                if ArgumentosArmazon.medirTirones { SondaTirones().frame(width: 1, height: 1).allowsHitTesting(false) }
            #endif
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.armazon)
        .modifier(PublicarInmersivo(inmersivo: inmersivo))
        .modifier(ControlOrientacion())
        .modifier(EstadosGlobales())
        .hojasDeLaApp(hojas)
    }
}

/// Velo, barra inferior (móvil) y barra superior (tableta), con sus reglas de visibilidad (a2 §4.4, §5, §16.1).
private struct BarrasDelArmazon: View {
    let inmersivo: Bool
    @Environment(Navegador.self) private var navegador
    @Environment(PresentacionReproductor.self) private var presentacion
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.movimientoReducido) private var reducido
    @Environment(\.cristalOpaco) private var opaco

    var body: some View {
        let teatro: Bool = navegador.teatroVisible
        let inferior: Bool = maquetacion.barraInferior(teatroVisible: teatro, inmersivo: inmersivo, emparejando: false)
        let superior: Bool = maquetacion.barraSuperior(inmersivo: inmersivo, emparejando: false)
        let mini: Bool = presentacion.miniVisible(teatroVisible: teatro, inmersivo: inmersivo)
        ZStack(alignment: .topLeading) {
            if inferior {
                // Con Liquid Glass de verdad no hay velo (Isma: aquí manda el cristal sobre el calco de la web): el
                // velo opaco de `--bg` dejaba el vidrio sobre un color liso y la barra se veía blanca, sin nada que
                // transparentar ni refractar. Con la transparencia reducida la barra es sólida y el velo vuelve.
                if opaco { VeloInferior(mini: mini).zIndex(Capa.velo).transition(.opacity) }
                BarraPestanas().zIndex(Capa.barra).transition(.opacity)
            }
            if superior && !teatro {
                BarraSuperior().zIndex(Capa.barra).transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // La barra aparece y desaparece con el fundido de raíz de la web (340 ms, a2 §4.4 y §21.4).
        .animation(Movimiento.vista(reducido), value: inferior)
        .animation(Movimiento.vista(reducido), value: superior && !teatro)
    }
}

/// El inmersivo va a la ventana (barra de estado oculta, indicador de inicio, bordes diferidos) y a los avisos
/// (los toasts se apagan sobre el vídeo); ver el teatro manda los avisos de señal a la línea de estado (a2 §8).
private struct PublicarInmersivo: ViewModifier {
    let inmersivo: Bool
    @Environment(EstadoVentana.self) private var ventana
    @Environment(Avisos.self) private var avisos
    @Environment(Navegador.self) private var navegador

    func body(content: Content) -> some View {
        content
            .onChange(of: inmersivo, initial: true) { _, valor in
                ventana.inmersivo = valor
                avisos.inmersivo = valor
            }
            .onChange(of: navegador.teatroVisible, initial: true) { _, valor in
                avisos.viendoTeatro = valor
                if !valor { avisos.vaciarLinea() }  // a2 §8.4: la línea de estado se vacía al salir del partido
            }
    }
}
