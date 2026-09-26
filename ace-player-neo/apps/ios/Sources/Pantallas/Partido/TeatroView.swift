import SwiftUI

/* El teatro (match-center/index.tsx y ChannelCenter.tsx; a4 §4, §16): la franja negra de la zona segura, el
   escenario fijo arriba (16:9 a todo el ancho) y, debajo, lo que se desplaza: la cabecera (partido o canal) y
   las pestañas pegadas bajo el vídeo con sus paneles montados. Arrastrar el vídeo hacia abajo lo lleva al mini
   como YouTube (decisión 3; Isma 26-sep): el vídeo baja con el dedo y se encoge hacia el mini mientras la página
   se funde, con háptica al cruzar el umbral; al soltar pasado el umbral vuela al mini con el muelle y, si no,
   vuelve a su sitio (TransicionTeatro.alMini, VueloAlMini). Mientras se ve: barra de estado clara sobre la franja negra, estado base del
   reproductor en la cápsula de estado y la sesión de fuentes de este partido o canal. */

struct TeatroView: View {
    let destino: Destino
    let video = EntornoVideo()
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.movimientoReducido) private var reducido
    @Environment(EstadoVentana.self) private var estadoVentana
    @Environment(TransicionTeatro.self) private var transicion
    @State private var umbral = UmbralAlMini()

    var body: some View {
        let ancho: CGFloat = CGFloat(maquetacion.ancho - maquetacion.seguras.izquierda - maquetacion.seguras.derecha)
        VStack(spacing: 0) {
            Color.black.frame(height: CGFloat(maquetacion.seguras.arriba)).fundidoAlMini()
            EscenarioVideo(inmersivo: false) { gesto in arrastrar(gesto, ancho: ancho) }
                .frame(width: ancho, height: ancho * 9 / 16)
                .escenarioAlMini()
                .piezaVuelo(.escenario, partido: claveVuelo)
                .zIndex(1)
            contenido.fundidoAlMini()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .fondoAlMini(Palco.bg)
        .ignoresSafeArea(edges: .vertical)
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

    /// Arrastrar el vídeo hacia abajo: sigue al dedo y se encoge hacia el mini; al cruzar el umbral (56, el de
    /// `classifySwipe`), háptica rígida (una vez por cruce, como el umbral de lado); al soltar, vuela al mini y
    /// minimiza (`ligera`) o vuelve a su sitio con el muelle.
    private func arrastrar(_ gesto: ArrastreVideo, ancho: CGFloat) {
        switch gesto {
        case .mover(let dy):
            let pasado: Bool = Double(dy) >= GeometriaVuelo.umbralAlMini
            if pasado != umbral.pasado {
                umbral.pasado = pasado
                if pasado { video.haptica.disparar(.rigida) }
            }
            transicion.arrastrarAlMini(Double(max(0, dy)), escenario: marcoEscenario(ancho: ancho))
        case .soltar(let minimiza):
            umbral.pasado = false
            if minimiza {
                transicion.soltarAlMini(reducido: reducido)
                video.minimizar()
            } else {
                transicion.devolverAlTeatro(reducido: reducido)
            }
        }
    }

    /// El marco del escenario en la ventana: bajo la franja de la zona segura, centrado, 16:9.
    private func marcoEscenario(ancho: CGFloat) -> CGRect {
        let x: CGFloat = (CGFloat(maquetacion.ancho) - ancho) / 2
        return CGRect(x: x, y: CGFloat(maquetacion.seguras.arriba), width: ancho, height: ancho * 9 / 16)
    }
}

/// Si el arrastre ya ha cruzado el umbral (para la háptica de una vez por cruce). No se observa: no repinta.
private final class UmbralAlMini {
    var pasado = false
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

/// Paneles montados (`hidden` de TheaterTabs.tsx): el elegido se ve; los demás siguen vivos (estado,
/// desplazamientos) sin ocupar sitio. Como `.mc-tabs__panel`: el que llega se funde (`ace-funde`, 340 ms con
/// `--ease-out`; reducido 120) y el que se va desaparece al momento.
struct PanelMontado<Contenido: View>: View {
    let visible: Bool
    @ViewBuilder let contenido: () -> Contenido
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        let funde: Animation? = visible ? .timingCurve(0.2, 0.7, 0.3, 1, duration: reducido ? 0.12 : 0.34) : nil
        contenido()
            .frame(maxHeight: visible ? nil : 0, alignment: .top)
            .clipped()
            .animation(funde) { $0.opacity(visible ? 1 : 0) }
            .allowsHitTesting(visible)
            // Oculto de verdad para VoiceOver (y para XCUITest): con solo `accessibilityHidden` los hijos del panel
            // escondido seguían en el árbol con su marco sin recortar.
            .accessibilityElement(children: visible ? .contain : .ignore)
            .accessibilityHidden(!visible)
    }
}
