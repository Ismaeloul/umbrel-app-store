import SwiftUI

/* El teatro (match-center/index.tsx y ChannelCenter.tsx; a4 §4, §16): la franja negra de la zona segura, el
   escenario fijo arriba (16:9 a todo el ancho) y, debajo, lo que se desplaza: la cabecera (partido o canal) y
   las pestañas pegadas bajo el vídeo con sus paneles montados. Arrastrar el vídeo hacia abajo lo lleva al mini
   siguiendo al dedo (decisión 3). Mientras se ve: barra de estado clara sobre la franja negra, estado base del
   reproductor en la cápsula de estado y la sesión de fuentes de este partido o canal. */

struct TeatroView: View {
    let destino: Destino
    let video = EntornoVideo()
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.movimientoReducido) private var reducido
    @Environment(EstadoVentana.self) private var estadoVentana
    @State private var arrastre = DesplazamientoGesto()

    var body: some View {
        let ancho: CGFloat = CGFloat(maquetacion.ancho - maquetacion.seguras.izquierda - maquetacion.seguras.derecha)
        VStack(spacing: 0) {
            Color.black.frame(height: CGFloat(maquetacion.seguras.arriba))
            EscenarioVideo(inmersivo: false) { gesto in arrastrar(gesto) }
                .frame(width: ancho, height: ancho * 9 / 16)
                .piezaVuelo(.escenario, partido: claveVuelo)
            contenido
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Palco.bg)
        .ignoresSafeArea(edges: .vertical)
        .modifier(SigueAlDedo(gesto: arrastre, eje: .vertical))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.teatro)
        .modifier(EstadoBaseTeatro())
        .onAppear { estadoVentana.fondoOscuroArriba = true }
        .onDisappear {
            estadoVentana.fondoOscuroArriba = false
            // Salir del partido con la pantalla completa puesta la quita (a4 §5.5); si solo se oculta (el armazón
            // tapa el teatro con el inmersivo), la ruta sigue siendo el teatro y la pantalla completa se queda.
            let presentacion = video.presentacion
            if !video.navegador.teatroVisible && presentacion.pantallaCompletaForzada {
                presentacion.alternarPantallaCompleta()
            }
        }
    }

    /// La clave del marco del escenario para el vuelo (zoom de la capa y vídeo→mini): el id del partido; en un
    /// canal suelto, su hash.
    private var claveVuelo: String {
        switch destino {
        case .partido(let id): id
        case .canal(let hash): hash
        default: ""
        }
    }

    @ViewBuilder private var contenido: some View {
        switch destino {
        case .partido(let id): ContenidoPartido(id: id)
        case .canal(let hash): ContenidoCanal(hash: hash)
        default: EmptyView()
        }
    }

    /// Arrastrar el vídeo hacia abajo (1:1): al soltar, minimiza (el vídeo pasa al mini) o vuelve con muelle.
    private func arrastrar(_ gesto: ArrastreVideo) {
        switch gesto {
        case .mover(let dy):
            arrastre.valor = max(0, dy)
        case .soltar(let minimiza):
            if minimiza {
                video.minimizar()
                arrastre.valor = 0
            } else {
                withAnimation(Movimiento.estandar(reducido)) { arrastre.valor = 0 }
            }
        }
    }
}

/// El estado base de la cápsula de estado lo pone el reproductor mientras se ve el teatro (`setStatusBase`); al
/// salir se vacía.
private struct EstadoBaseTeatro: ViewModifier {
    let video = EntornoVideo()

    func body(content: Content) -> some View {
        content
            .onChange(of: EstadoEscenario.base(video.foto), initial: true) { _, base in video.avisos.fijarBase(base) }
            .onDisappear {
                video.avisos.fijarBase(nil)
                video.avisos.vaciarLinea()
            }
    }
}

/// El desplazable bajo el vídeo: cabecera · (16) · pestañas pegadas · (16) · panel (alto mínimo 40 % de la
/// pantalla). Relleno inferior `safeB + 28`.
struct DesplazableTeatro<Cabecera: View, Panel: View>: View {
    let pestanas: PestanasTeatro
    @ViewBuilder let cabecera: () -> Cabecera
    @ViewBuilder let panel: () -> Panel
    @Environment(\.maquetacion) private var maquetacion

    var body: some View {
        let lado: CGFloat = CGFloat(16 + maquetacion.seguras.izquierda)
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                cabecera().padding(.horizontal, lado).padding(.top, 4).padding(.bottom, 16)
                Section {
                    panel()
                        .padding(.horizontal, lado)
                        .padding(.top, 16)
                        .frame(minHeight: CGFloat(maquetacion.alto * 0.4), alignment: .top)
                        .padding(.bottom, CGFloat(maquetacion.seguras.abajo + 28))
                } header: {
                    pestanas
                }
            }
        }
        .scrollIndicators(.hidden)
    }
}

/// Paneles montados: el elegido se ve; los demás siguen vivos (estado, desplazamientos) sin ocupar sitio.
struct PanelMontado<Contenido: View>: View {
    let visible: Bool
    @ViewBuilder let contenido: () -> Contenido
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        contenido()
            .frame(maxHeight: visible ? nil : 0, alignment: .top)
            .clipped()
            .opacity(visible ? 1 : 0)
            .allowsHitTesting(visible)
            .accessibilityHidden(!visible)
            .animation(.timingCurve(0.2, 0.7, 0.3, 1, duration: reducido ? 0.12 : 0.34), value: visible)
    }
}
