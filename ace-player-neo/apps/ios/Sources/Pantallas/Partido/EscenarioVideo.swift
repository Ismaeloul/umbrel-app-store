import SwiftUI

/* El escenario (a4 §5): el marco negro con el ÚNICO `VistaVideo` del teatro (vertical: hueco `.teatro`;
   inmersivo: `.inmersivo`) y sus capas en el orden de la web: vídeo · corte a negro · capa de toques · panel
   de mensaje / spinner / rótulo de la demo · controles · cápsula de estado. «Datos técnicos» nunca va sobre la
   imagen: es una pestaña de la página (PanelDatosTecnicos). Todo lo que va sobre el vídeo es isla oscura. La pulsación larga abre «Opciones del reproductor»
   (menú del sistema, sin háptica propia) con la vista previa de la tesela. */

enum ArrastreVideo: Sendable { case mover(CGFloat), soltar(minimiza: Bool) }

/// Lo que se desplaza siguiendo al dedo. Va en un objeto aparte para que solo lo lea quien se mueve: si el
/// escenario entero se volviera a pintar a cada paso, la capa de toques se recrearía y el gesto se cancelaría.
@MainActor @Observable final class DesplazamientoGesto {
    var valor: CGFloat = 0
}

/// Aplica el desplazamiento del gesto en un eje.
struct SigueAlDedo: ViewModifier {
    enum Eje { case horizontal, vertical }
    let gesto: DesplazamientoGesto
    let eje: Eje

    func body(content: Content) -> some View {
        content.offset(x: eje == .horizontal ? gesto.valor : 0, y: eje == .vertical ? gesto.valor : 0)
    }
}

/// Salir del partido o del canal con la pantalla completa puesta la quita (a4 §5.5). Se mira la ruta
/// (`teatroVisible`), no si el escenario desaparece: el armazón puede ocultar el teatro mientras está el inmersivo.
/// Va en los dos escenarios (vertical e inmersivo) para que lo haga el que siga montado.
private struct QuitaPantallaCompletaAlSalir: ViewModifier {
    let video = EntornoVideo()

    func body(content: Content) -> some View {
        content.onChange(of: video.navegador.teatroVisible) { _, visible in
            if !visible && video.presentacion.pantallaCompletaForzada { video.presentacion.alternarPantallaCompleta() }
        }
    }
}

/// Solo en Debug: la fase del reproductor (y «imagen» si ya hubo fotograma con esta fuente) como valor de
/// accesibilidad del escenario, para que ServidorRealUITests sepa si AVPlayer llega a reproducir contra el backend
/// de verdad. Es el `data-phase` del escenario de la web (player/index.tsx), que usa su batería E2E. En la IPA no está.
private struct FaseParaPruebas: ViewModifier {
    let fase: FaseReproductor
    let arranco: Bool

    func body(content: Content) -> some View {
        #if DEBUG
            content.accessibilityValue(arranco ? "\(fase.rawValue) imagen" : fase.rawValue)
        #else
            content
        #endif
    }
}

struct EscenarioVideo: View {
    let inmersivo: Bool
    private let alArrastrar: ((ArrastreVideo) -> Void)?
    let video = EntornoVideo()
    @Environment(\.maquetacion) private var maquetacion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(\.movimientoReducido) private var reducido
    @Environment(RelojCompartido.self) private var reloj
    @State private var corte = 0
    @State private var desplazamiento = DesplazamientoGesto()

    init(inmersivo: Bool) {
        self.init(inmersivo: inmersivo, alArrastrar: nil)
    }

    /// El teatro en vertical sigue al dedo al arrastrar el vídeo hacia abajo (minimizar, decisión 3).
    init(inmersivo: Bool, alArrastrar: ((ArrastreVideo) -> Void)?) {
        self.inmersivo = inmersivo
        self.alArrastrar = alArrastrar
    }

    private var variante: VarianteEscenario {
        VarianteEscenario(anchoVideo: maquetacion.ancho, anchoVentana: maquetacion.ancho, inmersivo: inmersivo)
    }
    private var seguras: Margenes { inmersivo ? maquetacion.seguras : Margenes() }
    private var partido: FootballMatch? {
        guard case .partido(let id) = video.navegador.capa else { return nil }
        return BuscarPartido.en(video.datos.agenda.datos, id: id)
    }

    var body: some View {
        let foto = video.foto
        let relleno = variante.rellenoControles(seguras)
        ZStack {
            Color.black
            VistaVideo(superficie: video.pip.superficie, prioridad: inmersivo ? .inmersivo : .teatro)
                .modifier(SigueAlDedo(gesto: desplazamiento, eje: .horizontal))
            CorteNegro(disparo: corte + video.presentacion.cortes)
            capaToques(foto)
            capasMensaje(foto)
            ControlesVideo(variante: variante, relleno: relleno, partido: partido, marcador: marcador, ahora: reloj.ahora)
                .fundidoAlMini(rapido: true)
        }
        .overlay(alignment: .bottomLeading) { estado(foto, relleno: relleno).fundidoAlMini(rapido: true) }
        .clipped()
        .islaOscura()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(foto.titulo.map { "Reproductor: \($0)" } ?? "Reproductor")
        .accessibilityIdentifier(IDUI.videoTeatro)
        .modifier(FaseParaPruebas(fase: foto.fase, arranco: foto.arranco))
        .onChange(of: foto.hash) { viejo, nuevo in
            if viejo != nil, nuevo != nil, viejo != nuevo { corte += 1 }
        }
        .onChange(of: voiceOver, initial: true) { _, activo in video.presentacion.voiceOverActivo = activo }
        .modifier(QuitaPantallaCompletaAlSalir())
    }

    private var marcador: LiveScore? {
        guard let partido else { return nil }
        return video.datos.marcadores.datos?.scores[partido.id]
    }

    // MARK: Capas

    /// Siempre la MISMA vista (sin `if`): si el menú apareciera al llegar el título, la capa de toques se
    /// recrearía y un arrastre en marcha se cancelaría (sin título no hay acciones y el menú no sale).
    private func capaToques(_ foto: FotoEscenario) -> some View {
        let toques = CapaToquesVideo(
            abajoMinimiza: variante.deslizarAbajoMinimiza && alArrastrar != nil,
            ladosCambian: video.idsFuentesVisibles.count > 1,
            alTocar: { video.presentacion.tocarVideo() },
            alDobleToque: { video.alternarPantallaCompleta() },
            alMover: { dx, dy in mover(dx: dx, dy: dy) },
            alSoltar: { direccion in soltar(direccion) })
        let acciones: [AccionMenu] = foto.titulo == nil ? [] : video.accionesMenu()
        let titulo: String = foto.titulo ?? ""
        return toques.menuContextual(acciones) { VistaPreviaVideo(titulo: titulo, fase: foto.fase) }
    }

    @ViewBuilder private func capasMensaje(_ foto: FotoEscenario) -> some View {
        if let mensaje = EstadoEscenario.mensaje(foto) {
            PanelMensajeVideo(
                mensaje: mensaje, grande: variante.mensajeGrande, boton: EstadoEscenario.botonMensaje(foto),
                datosReposo: EstadoEscenario.conDatosDeReposo(foto)
            ) { video.reintentar() }
            .transition(.opacity)
        } else if foto.fase == .buffer || foto.fase == .buscando {
            GiroCarga()
        } else if foto.demo && foto.arranco, let titulo = foto.titulo {
            #if DEBUG
                // El campo de `DemoPicture` con su rótulo: la imagen de la demo es de M2 (Debug/ImagenDemo).
                ImagenDemo(titulo: titulo, estrecho: !variante.mensajeGrande).allowsHitTesting(false)
            #else
                RotuloDemo(titulo: titulo, grande: variante.mensajeGrande)
            #endif
        }
    }

    private func estado(_ foto: FotoEscenario, relleno: Margenes) -> some View {
        let abajo = foto.hayCanal && foto.fase != .error && (video.presentacion.controlesVisibles || voiceOver)
        return CapsulaEstadoVideo(
            variante: variante, relleno: relleno, hayPanel: EstadoEscenario.mensaje(foto) != nil, controlesAbajo: abajo)
    }

    // MARK: Gestos

    private func mover(dx: CGFloat, dy: CGFloat) {
        if dx != 0 {
            desplazamiento.valor = CGFloat(BarraEmitiendo.arrastreTexto(Double(dx)))
        } else {
            alArrastrar?(.mover(dy))
        }
    }

    private func soltar(_ direccion: ResultadoDeslizar) {
        withAnimation(Movimiento.rapido(reducido)) { desplazamiento.valor = 0 }
        switch direccion {
        case .izquierda: video.pasoFuente(1)
        case .derecha: video.pasoFuente(-1)
        case .abajo: alArrastrar?(.soltar(minimiza: true))
        default: alArrastrar?(.soltar(minimiza: false))
        }
    }
}

/// Buscar un partido de la agenda por su id (find.ts).
enum BuscarPartido {
    static func en(_ agenda: FootballSchedule?, id: String) -> FootballMatch? {
        guard let agenda else { return nil }
        for dia in agenda.days {
            if let partido = dia.matches.first(where: { $0.id == id }) { return partido }
        }
        return nil
    }
}

/// Spinner de `buffer` y `buscando` (`.player-spinner`): 40×40, borde 3 blanco al 22 % con el tramo de arriba
/// blanco, gira en 0,9 s. Con movimiento reducido: quieto, discontinuo, blanco al 50 %.
private struct GiroCarga: View {
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        ZStack {
            if reducido {
                Circle().strokeBorder(Color.white.opacity(0.5), style: StrokeStyle(lineWidth: 3, dash: [4, 4]))
            } else {
                TimelineView(.animation) { contexto in
                    let vuelta: Double = contexto.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 0.9) / 0.9
                    ZStack {
                        Circle().strokeBorder(Color.white.opacity(0.22), lineWidth: 3)
                        Circle().inset(by: 1.5).trim(from: 0, to: 0.25).stroke(Color.white, lineWidth: 3)
                            .rotationEffect(.degrees(vuelta * 360 - 135))
                    }
                }
            }
        }
        .frame(width: 40, height: 40)
        .accessibilityHidden(true)
    }
}

/// Rótulo de la demo (`.player-demo`): «{CANAL}» 17 (15 en vertical) 800/125 +0,04 em y «reproducción simulada —
/// en el Umbrel verías el stream real» 12 al 90 %, con sombra de texto.
private struct RotuloDemo: View {
    let titulo: String
    let grande: Bool

    var body: some View {
        VStack(spacing: 2) {
            Text(titulo.uppercased())
                .estilo(EstiloTexto(tamano: grande ? 17 : 15, peso: 800, anchura: 125, trackingEm: 0.04, altoLinea: 1.1))
            Text("reproducción simulada — en el Umbrel verías el stream real")
                .estilo(EstiloTexto(tamano: 12, peso: 450, altoLinea: 1.25))
                .opacity(0.9)
        }
        .multilineTextAlignment(.center)
        .foregroundStyle(Palco.onVideo)
        .shadow(color: .black.opacity(0.6), radius: 6, x: 0, y: 1)
        .padding(.horizontal, 16)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
