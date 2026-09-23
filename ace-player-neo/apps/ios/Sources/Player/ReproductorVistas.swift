import AVKit
import SwiftUI

// MARK: - Controles sobre el vídeo

/// Dónde están los controles: cambia qué botones salen y qué hace «pantalla completa».
enum ContextoControles: Equatable {
    /// Dentro del centro de partido o de canal.
    case integrado
    /// Reproductor grande en vertical.
    case grande
    /// Reproductor grande en horizontal (pantalla completa).
    case completa
}

/// Controles propios sobre el vídeo, con cristal (Liquid Glass en iOS 26):
/// reproducir/pausa, −30 s, «Directo» con el retraso real, PiP, AirPlay y
/// pantalla completa. Se esconden a los 3,2 s si suena de verdad.
struct ControlesVideo: View {
    @Environment(AppModel.self) private var app
    let contexto: ContextoControles
    var alMinimizar: (() -> Void)?
    @State private var visibles = true
    @State private var toques = 0
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver

    private var reproductor: Reproductor { app.reproductor }
    private var completa: Bool { contexto == .completa }

    var body: some View {
        ZStack {
            // Zona para mostrar/ocultar con un toque (y doble toque para pantalla completa).
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture(count: 2) { alternarPantallaCompleta() }
                .onTapGesture {
                    withAnimation(Muelle.rapido) { visibles.toggle() }
                    toques += 1
                }
                .accessibilityHidden(true)

            if visibles || voiceOver || reproductor.fase != .reproduciendo {
                capa
                    .transition(.opacity)
            }
        }
        .environment(\.colorScheme, .dark)
        .task(id: toques) { await esconderLuego() }
        .onChange(of: reproductor.fase) { _, fase in
            if fase != .reproduciendo { withAnimation(Muelle.rapido) { visibles = true } }
            toques += 1
        }
    }

    private var capa: some View {
        ZStack {
            LinearGradient(
                colors: [.black.opacity(0.55), .clear, .clear, .black.opacity(0.6)], startPoint: .top,
                endPoint: .bottom
            )
            .allowsHitTesting(false)

            centro

            VStack {
                if completa { barraSuperior }
                Spacer()
                barraInferior
            }
            .padding(completa ? 20 : 10)
        }
    }

    private var barraSuperior: some View {
        HStack(spacing: 12) {
            Button {
                alMinimizar?()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.headline)
            }
            .botonCristal()
            .accessibilityLabel("Minimizar el reproductor")
            .accessibilityIdentifier("boton-cerrar-completa")
            VStack(alignment: .leading, spacing: 2) {
                Text(reproductor.canal?.partido?.titulo ?? reproductor.canal?.titulo ?? "")
                    .font(.headline)
                    .lineLimit(1)
                if reproductor.canal?.partido != nil, let titulo = reproductor.canal?.titulo {
                    Text(titulo)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.75))
                        .lineLimit(1)
                }
            }
            .foregroundStyle(.white)
            Spacer()
        }
    }

    @ViewBuilder private var centro: some View {
        switch reproductor.fase {
        case .cargando, .buffer, .reconectando:
            VStack(spacing: 10) {
                ProgressView()
                    .controlSize(.large)
                    .tint(.white)
                if let intento = reproductor.intento {
                    Text("Reconectando \(intento.n)/\(intento.max)")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(reproductor.mensaje ?? reproductor.fase.etiqueta)
        case .error, .idle:
            Button {
                reproductor.reanudar()
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.title2.weight(.semibold))
            }
            .botonCristal(diametro: 64)
            .accessibilityLabel("Volver a intentar")
        default:
            HStack(spacing: completa ? 48 : 32) {
                Button {
                    Task { await reproductor.retroceder() }
                } label: {
                    Image(systemName: "gobackward.30")
                        .font(.title3.weight(.semibold))
                }
                .botonCristal(diametro: 52)
                .accessibilityLabel("Retroceder 30 segundos")
                .accessibilityIdentifier("boton-retroceder")

                Button {
                    reproductor.alternar()
                    toques += 1
                } label: {
                    Image(systemName: reproductor.quiereReproducir ? "pause.fill" : "play.fill")
                        .font(.title.weight(.bold))
                        .contentTransition(.symbolEffect(.replace))
                }
                .botonCristal(diametro: 72)
                .sensoryFeedback(.impact(weight: .light), trigger: reproductor.quiereReproducir)
                .accessibilityLabel(reproductor.quiereReproducir ? "Pausa" : "Reproducir")
                .accessibilityIdentifier("boton-reproducir")

                // Hueco del mismo ancho que −30 para que la pausa quede centrada.
                Color.clear
                    .frame(width: 52, height: 52)
                    .accessibilityHidden(true)
            }
        }
    }

    private var barraInferior: some View {
        HStack(spacing: 10) {
            botonDirecto()
            if let estadisticas = reproductor.estadisticas, contexto != .integrado {
                Label("\(estadisticas.peers)", systemImage: "person.2.fill")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.white.opacity(0.85))
                    .accessibilityLabel("\(estadisticas.peers) pares conectados")
            }
            Spacer()
            if app.pip.soportado {
                Button {
                    app.pip.alternar()
                } label: {
                    Image(systemName: app.pip.activo ? "pip.exit" : "pip.enter")
                        .font(.body.weight(.semibold))
                }
                .botonCristal()
                .accessibilityLabel(app.pip.activo ? "Salir de imagen en imagen" : "Imagen en imagen")
                .accessibilityIdentifier("boton-pip")
            }
            BotonAirPlay()
                .frame(width: 30, height: 30)
                .fondoCristalCircular()
                .accessibilityLabel("AirPlay")
            Button {
                alternarPantallaCompleta()
            } label: {
                Image(systemName: completa ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
                    .font(.body.weight(.semibold))
            }
            .botonCristal()
            .accessibilityLabel(completa ? "Salir de pantalla completa" : "Pantalla completa")
            .accessibilityIdentifier("boton-pantalla-completa")
        }
    }

    @ViewBuilder
    private func botonDirecto() -> some View {
        let directo = reproductor.directo
        if directo.disponible {
            Button {
                Task { await reproductor.irAlDirecto() }
            } label: {
                HStack(spacing: 6) {
                    Circle()
                        .fill(directo.enDirecto ? Color.red : Color.white.opacity(0.6))
                        .frame(width: 8, height: 8)
                    Text(directo.textoBoton)
                        .font(.caption.weight(.bold).monospacedDigit())
                        .contentTransition(.numericText())
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(minHeight: Medida.toque)
                .cristal(en: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(directo.enDirecto)
            .accessibilityLabel(directo.etiquetaAccesible)
            .accessibilityIdentifier("boton-directo")
        }
    }

    /// Integrado → reproductor grande en horizontal; grande → horizontal; completa → vertical.
    private func alternarPantallaCompleta() {
        switch contexto {
        case .integrado:
            withAnimation(Muelle.heroe) { reproductor.expandir() }
            Orientacion.pedir(.landscape)
        case .grande:
            Orientacion.pedir(.landscape)
        case .completa:
            Orientacion.pedir(.portrait)
        }
    }

    private func esconderLuego() async {
        try? await Task.sleep(for: .seconds(3.2))
        guard !Task.isCancelled, reproductor.fase == .reproduciendo, !voiceOver else { return }
        withAnimation(Muelle.estandar) { visibles = false }
    }
}

// MARK: - El vídeo (hueco de la única capa)

/// El hueco del vídeo con su fondo negro y, mientras suena en la ventanita
/// del PiP, un marcador en su sitio (nunca otra imagen: la capa es una).
struct VideoApp: View {
    @Environment(AppModel.self) private var app
    let prioridad: PrioridadHueco
    var gravedad: AVLayerVideoGravity = .resizeAspect
    var compacto = false

    var body: some View {
        ZStack {
            Color.black
            VistaVideo(superficie: app.pip.superficie, prioridad: prioridad, gravedad: gravedad)
            if app.pip.activo {
                MarcadorPiP(compacto: compacto)
                    .transition(.opacity)
            }
        }
        .animation(Muelle.rapido, value: app.pip.activo)
    }
}

/// Lo que ocupa el vídeo mientras se ve en la ventanita del PiP.
struct MarcadorPiP: View {
    @Environment(AppModel.self) private var app
    var compacto = false

    var body: some View {
        ZStack {
            Color.black
            if compacto {
                Image(systemName: "pip")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.85))
            } else {
                VStack(spacing: 10) {
                    Image(systemName: "pip")
                        .font(.largeTitle)
                    Text("Se está viendo en imagen en imagen")
                        .font(.subheadline.weight(.semibold))
                        .multilineTextAlignment(.center)
                    Button {
                        app.pip.cerrar()
                    } label: {
                        Text("Volver aquí")
                            .font(.subheadline.weight(.bold))
                            .padding(.horizontal, 16)
                            .frame(minHeight: Medida.toque)
                            .cristal(en: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("boton-volver-del-pip")
                }
                .foregroundStyle(.white)
                .environment(\.colorScheme, .dark)
                .padding()
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Se está viendo en imagen en imagen")
        .accessibilityIdentifier("marcador-pip")
    }
}

// MARK: - Reproductor dentro de una pantalla

/// El vídeo con sus controles en 16:9 (centro de partido y de canal) y la
/// línea de estado debajo. Mientras está en pantalla, el mini se esconde.
struct ReproductorIntegrado: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let reproductor = app.reproductor
        VStack(alignment: .leading, spacing: 8) {
            ZStack {
                VideoApp(prioridad: .integrado)
                if !app.pip.activo {
                    ControlesVideo(contexto: .integrado)
                }
            }
            .aspectRatio(16 / 9, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: Medida.radioL, style: .continuous))
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Reproductor: \(reproductor.fase.etiqueta)")
            .accessibilityIdentifier("reproductor-integrado")

            LineaEstado()
        }
        .onAppear { reproductor.superficieGrande(visible: true) }
        .onDisappear { reproductor.superficieGrande(visible: false) }
    }
}

/// Lo que está pasando, en una línea (aria-live de la web).
struct LineaEstado: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let reproductor = app.reproductor
        if let mensaje = reproductor.mensaje {
            HStack(spacing: 6) {
                Image(systemName: icono(reproductor))
                    .symbolEffect(.pulse, isActive: reproductor.fase == .reconectando)
                Text(mensaje)
                    .lineLimit(2)
            }
            .font(.footnote.weight(.medium))
            .foregroundStyle(color(reproductor))
            .transition(.opacity)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
            .accessibilityIdentifier("linea-estado")
        }
    }

    private func icono(_ reproductor: Reproductor) -> String {
        switch reproductor.fase {
        case .error: "exclamationmark.triangle.fill"
        case .reconectando: "arrow.triangle.2.circlepath"
        default: reproductor.motivoParada == .traspaso ? "iphone.and.arrow.forward" : "info.circle"
        }
    }

    private func color(_ reproductor: Reproductor) -> Color {
        switch reproductor.fase {
        case .error: Tinta.falloTinta
        case .reconectando: Tinta.flojaTinta
        default: Tinta.texto2
        }
    }
}

// MARK: - Capa del reproductor (mini y grande)

/// Medidas del armazón que el reproductor necesita saber: el alto de la
/// barra de pestañas (para poner el mini justo encima) y el margen del sistema.
@MainActor
@Observable
final class Maqueta {
    /// Del borde inferior de la pantalla al borde superior de la barra de pestañas.
    private(set) var alturaBarra: CGFloat = 0
    /// Zona segura inferior de la ventana (la del indicador de inicio).
    private(set) var margenSistema: CGFloat = 0

    /// Alto del mini-reproductor.
    static let altoMini: CGFloat = 60

    func medirBarra(_ valor: CGFloat) {
        guard valor > 0, abs(valor - alturaBarra) > 0.5 else { return }
        alturaBarra = valor
    }

    func medirSistema(_ valor: CGFloat) {
        guard abs(valor - margenSistema) > 0.5 else { return }
        margenSistema = valor
    }

    /// Dónde va el mini (desde el borde de la pantalla), con un valor seguro si aún no se ha medido.
    var baseMini: CGFloat { max(alturaBarra, 49 + margenSistema) + 6 }
}

/// El mini-reproductor y el reproductor grande, por encima de las pestañas.
/// Comparten el espacio de `matchedGeometryEffect`: el vídeo y el fondo del
/// mini crecen hasta el reproductor grande y vuelven.
struct CapaReproductor: View {
    @Environment(AppModel.self) private var app
    @Environment(Maqueta.self) private var maqueta
    @Environment(\.verticalSizeClass) private var claseVertical
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento
    @Namespace private var espacio
    @State private var arrastre: CGFloat = 0

    private var muelle: Animation { sinMovimiento ? .easeInOut(duration: 0.15) : Muelle.heroe }

    var body: some View {
        let vista = app.reproductor.vista
        ZStack {
            if vista == .grande {
                ReproductorGrande(espacio: espacio, arrastre: $arrastre, alMinimizar: { minimizar() })
                    .transition(.opacity)
                    .zIndex(2)
            }
            if vista == .mini {
                VStack(spacing: 0) {
                    Spacer(minLength: 0)
                    MiniReproductor(espacio: espacio, alAbrir: { abrir() })
                        .padding(.horizontal, Medida.margen)
                        .padding(.bottom, maqueta.baseMini)
                }
                .ignoresSafeArea(.container, edges: .bottom)
                .ignoresSafeArea(.keyboard)
                .transition(.opacity)
                .zIndex(1)
            }
        }
        .animation(muelle, value: vista)
        .sensoryFeedback(.impact(weight: .light), trigger: vista == .grande)
        .onChange(of: app.reproductor.canal == nil) { _, sinCanal in
            if sinCanal { arrastre = 0 }
        }
    }

    private func abrir() {
        arrastre = 0
        withAnimation(muelle) { app.reproductor.expandir() }
    }

    /// Se va desde donde lo haya dejado el dedo (el desplazamiento se pone a
    /// cero al volver a abrirlo, no ahora: si no, subiría antes de encogerse).
    private func minimizar() {
        if claseVertical == .compact { Orientacion.pedir(.portrait) }
        withAnimation(muelle) { app.reproductor.minimizar() }
    }
}

extension View {
    /// Aparta el contenido de una pestaña para que el mini-reproductor no
    /// tape la última fila, y mide la barra de pestañas para colocarlo.
    func reservaMini() -> some View {
        modifier(ReservaMini())
    }
}

private struct ReservaMini: ViewModifier {
    @Environment(AppModel.self) private var app

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if app.reproductor.visibleEnMini {
                    Color.clear
                        .frame(height: Maqueta.altoMini + 12)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .background { LectorBarra() }
    }
}

/// Lee la zona segura inferior de la pestaña (la barra de pestañas y el indicador de inicio).
private struct LectorBarra: View {
    @Environment(Maqueta.self) private var maqueta

    var body: some View {
        GeometryReader { geo in
            Color.clear
                .onAppear { maqueta.medirBarra(geo.safeAreaInsets.bottom) }
                .onChange(of: geo.safeAreaInsets.bottom) { _, nuevo in maqueta.medirBarra(nuevo) }
        }
        .ignoresSafeArea(.keyboard)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Mini-reproductor

/// Mini-reproductor flotante sobre la barra de pestañas: vídeo pequeño,
/// estado, título, pausa y cerrar. Tocarlo o deslizarlo hacia arriba abre el
/// reproductor grande; deslizarlo hacia un lado (o la X) lo detiene.
struct MiniReproductor: View {
    @Environment(AppModel.self) private var app
    let espacio: Namespace.ID
    let alAbrir: () -> Void
    @State private var arrastre: CGSize = .zero
    @State private var deteniendo = false

    private let forma = RoundedRectangle(cornerRadius: 24, style: .continuous)

    var body: some View {
        let reproductor = app.reproductor
        let desplazamiento = GestosReproductor.desplazamientoMini(arrastre)
        HStack(spacing: 12) {
            VideoApp(prioridad: .mini, gravedad: .resizeAspectFill, compacto: true)
                .frame(width: 76, height: 44)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .matchedGeometryEffect(id: "video", in: espacio)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 5) {
                    if reproductor.fase == .reproduciendo {
                        Image(systemName: "waveform")
                            .symbolEffect(.variableColor.iterative, options: .repeating)
                            .accessibilityHidden(true)
                    }
                    Text(estado(reproductor))
                        .lineLimit(1)
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(reproductor.fase == .error ? Tinta.falloTinta : Tinta.acentoTinta)
                Text(titulo(reproductor))
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Tinta.texto)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                reproductor.alternar()
            } label: {
                Image(systemName: reproductor.quiereReproducir && reproductor.conexion.enMarcha ? "pause.fill" : "play.fill")
                    .font(.title3)
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: Medida.toque, height: Medida.toque)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Tinta.texto)
            .accessibilityLabel(reproductor.quiereReproducir ? "Pausa" : "Reproducir")
            .accessibilityIdentifier("mini-reproducir")

            Button {
                detener(lado: 0)
            } label: {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .frame(width: Medida.toque, height: Medida.toque)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Tinta.texto2)
            .accessibilityLabel("Detener")
            .accessibilityIdentifier("mini-detener")
        }
        .padding(.leading, 8)
        .padding(.trailing, 4)
        .padding(.vertical, 8)
        .frame(height: Maqueta.altoMini)
        .background {
            forma
                .fill(Color.clear)
                .cristal(en: forma)
                .matchedGeometryEffect(id: "fondo", in: espacio)
        }
        .shadow(color: .black.opacity(0.14), radius: 16, y: 6)
        .contentShape(forma)
        .offset(desplazamiento)
        .opacity(1 - min(0.7, abs(desplazamiento.width) / 320))
        .onTapGesture { alAbrir() }
        .gesture(
            DragGesture(minimumDistance: 8)
                .onChanged { valor in
                    guard !deteniendo else { return }
                    arrastre = valor.translation
                }
                .onEnded { valor in soltar(valor) }
        )
        .sensoryFeedback(.impact(weight: .medium), trigger: deteniendo) { _, nuevo in nuevo }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("Mini-reproductor: \(titulo(reproductor)), \(estado(reproductor))")
        .accessibilityHint("Toca o desliza hacia arriba para abrir el reproductor")
        .accessibilityAction(named: "Abrir el reproductor") { alAbrir() }
        .accessibilityAction(named: "Detener") { detener(lado: 0) }
        .accessibilityIdentifier("mini-reproductor")
    }

    private func soltar(_ valor: DragGesture.Value) {
        switch GestosReproductor.alSoltarMini(traslacion: valor.translation, prevista: valor.predictedEndTranslation) {
        case .abrir:
            arrastre = .zero
            alAbrir()
        case .detener:
            detener(lado: valor.translation.width < 0 ? -1 : 1)
        case .nada:
            withAnimation(Muelle.estandar) { arrastre = .zero }
        }
    }

    /// Detiene; si viene de deslizar, antes sale por ese lado.
    private func detener(lado: CGFloat) {
        guard !deteniendo else { return }
        deteniendo = true
        if lado != 0 {
            withAnimation(Muelle.rapido) { arrastre = CGSize(width: lado * 480, height: 0) }
        }
        Task { @MainActor in
            if lado != 0 { try? await Task.sleep(for: .milliseconds(160)) }
            withAnimation(Muelle.estandar) { app.reproductor.detener() }
            arrastre = .zero
            deteniendo = false
        }
    }

    private func titulo(_ reproductor: Reproductor) -> String {
        reproductor.canal?.partido?.titulo ?? reproductor.canal?.titulo ?? ""
    }

    private func estado(_ reproductor: Reproductor) -> String {
        if let mensaje = reproductor.mensaje, reproductor.fase != .reproduciendo { return mensaje }
        if app.pip.activo { return "En imagen en imagen" }
        switch reproductor.fase {
        case .reproduciendo:
            if let canal = reproductor.canal, canal.partido != nil, !canal.titulo.isEmpty {
                return "Sonando · \(ReglasFuentes.parteCanal(canal.titulo))"
            }
            return "Sonando"
        case .pausado:
            return "En pausa"
        default:
            return reproductor.fase.etiqueta
        }
    }
}

// MARK: - Reproductor grande

/// El reproductor a toda pantalla: el vídeo arriba con sus controles y,
/// debajo, qué suena, el estado, las acciones y las fuentes del partido (u
/// otros canales). Se minimiza deslizando hacia abajo (el gesto sigue al
/// dedo y suelta con muelle) o con la flecha. En horizontal, solo el vídeo.
struct ReproductorGrande: View {
    @Environment(AppModel.self) private var app
    @Environment(\.verticalSizeClass) private var claseVertical
    let espacio: Namespace.ID
    @Binding var arrastre: CGFloat
    let alMinimizar: () -> Void
    @State private var pegando = false

    private var horizontal: Bool { claseVertical == .compact }

    var body: some View {
        GeometryReader { geo in
            let alto = geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom
            let bajada = GestosReproductor.desplazamientoGrande(arrastre)
            let progreso = GestosReproductor.progreso(bajada, alto: alto)
            ZStack(alignment: .top) {
                fondo(radio: min(38, bajada / 3))
                if horizontal {
                    pantallaCompleta(alto: alto)
                } else {
                    vertical(alto: alto)
                }
            }
            .scaleEffect(1 - progreso * 0.08, anchor: .top)
            .offset(y: bajada)
        }
        .statusBarHidden(horizontal)
        .persistentSystemOverlays(horizontal ? .hidden : .automatic)
        // Ya fuera de pantalla: la próxima vez se abre en su sitio.
        .onDisappear { arrastre = 0 }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityAction(.escape) { alMinimizar() }
        .accessibilityIdentifier("reproductor-grande")
        .sheet(isPresented: $pegando) {
            if let centro = app.centroSonando {
                PegarContentID(modelo: centro)
                    .presentationDetents([.medium])
            }
        }
    }

    // MARK: Fondo y gesto

    private func fondo(radio: CGFloat) -> some View {
        UnevenRoundedRectangle(
            topLeadingRadius: radio, bottomLeadingRadius: 0, bottomTrailingRadius: 0, topTrailingRadius: radio,
            style: .continuous
        )
        .fill(horizontal ? Color.black : Tinta.fondo)
        .ignoresSafeArea()
        .matchedGeometryEffect(id: "fondo", in: espacio)
        .shadow(color: .black.opacity(arrastre > 0 ? 0.25 : 0), radius: 24)
    }

    private func gesto(alto: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 14, coordinateSpace: .global)
            .onChanged { valor in
                // Solo hacia abajo y si el dedo baja más que se va de lado.
                guard abs(valor.translation.height) >= abs(valor.translation.width) || arrastre != 0 else { return }
                arrastre = valor.translation.height
            }
            .onEnded { valor in
                let minimizar = GestosReproductor.alSoltarGrande(
                    traslacion: valor.translation.height, prevista: valor.predictedEndTranslation.height, alto: alto)
                if minimizar {
                    alMinimizar()
                } else {
                    withAnimation(Muelle.estandar) { arrastre = 0 }
                }
            }
    }

    // MARK: Horizontal

    private func pantallaCompleta(alto: CGFloat) -> some View {
        ZStack {
            VideoApp(prioridad: .grande)
                .ignoresSafeArea()
                .matchedGeometryEffect(id: "video", in: espacio)
                .accessibilityHidden(true)
            if !app.pip.activo {
                ControlesVideo(contexto: .completa, alMinimizar: alMinimizar)
            }
            VStack {
                Spacer()
                LineaEstado()
                    .padding(.bottom, 70)
                    .environment(\.colorScheme, .dark)
            }
        }
        .simultaneousGesture(gesto(alto: alto))
        .accessibilityIdentifier("video-grande")
    }

    // MARK: Vertical

    private func vertical(alto: CGFloat) -> some View {
        VStack(spacing: 0) {
            VStack(spacing: 6) {
                Capsule()
                    .fill(Tinta.lineaFuerte)
                    .frame(width: 38, height: 5)
                    .padding(.top, 6)
                    .accessibilityHidden(true)
                cabecera
                video
                    .padding(.horizontal, Medida.margen)
                    .padding(.top, 4)
            }
            .padding(.bottom, 12)
            .contentShape(Rectangle())
            .simultaneousGesture(gesto(alto: alto))

            ScrollView {
                DetalleReproduccion(pegando: $pegando)
                    .padding(.horizontal, Medida.margen)
                    .padding(.bottom, 40)
            }
            .scrollIndicators(.hidden)
        }
    }

    private var cabecera: some View {
        HStack(spacing: 4) {
            Button {
                alMinimizar()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.title3.weight(.semibold))
                    .frame(width: Medida.toque, height: Medida.toque)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Tinta.texto)
            .accessibilityLabel("Minimizar el reproductor")
            .accessibilityIdentifier("boton-minimizar")

            Spacer(minLength: 4)
            VStack(spacing: 1) {
                Text("Reproduciendo")
                    .font(.caption2.weight(.bold))
                    .textCase(.uppercase)
                    .foregroundStyle(Tinta.texto3)
                Text(origen)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Tinta.texto)
                    .lineLimit(1)
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 4)

            BotonAirPlayTinta()
                .frame(width: Medida.toque, height: Medida.toque)
                .accessibilityLabel("AirPlay")
        }
        .padding(.horizontal, 8)
    }

    private var origen: String {
        guard let canal = app.reproductor.canal else { return "" }
        if let partido = canal.partido { return partido.competicion.isEmpty ? "Partido" : partido.competicion }
        switch canal.origen {
        case "favorites": return "Favoritos"
        case "history": return "Recientes"
        case "m3u": return "Tu lista"
        case "acestream": return "Búsqueda"
        default: return "Canal"
        }
    }

    private var video: some View {
        ZStack {
            VideoApp(prioridad: .grande)
            if !app.pip.activo {
                ControlesVideo(contexto: .grande, alMinimizar: alMinimizar)
            }
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: Medida.radioL, style: .continuous))
        .matchedGeometryEffect(id: "video", in: espacio)
        .shadow(color: .black.opacity(0.18), radius: 18, y: 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Reproductor: \(app.reproductor.fase.etiqueta)")
        .accessibilityIdentifier("video-grande")
    }
}

/// AirPlay con el color del texto (sobre el fondo de la app, no sobre el vídeo).
private struct BotonAirPlayTinta: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let vista = AVRoutePickerView()
        vista.prioritizesVideoDevices = true
        vista.tintColor = UIColor(named: "Text") ?? .label
        vista.activeTintColor = UIColor(named: "AccentInk") ?? .systemBlue
        vista.accessibilityLabel = "AirPlay"
        return vista
    }

    func updateUIView(_ vista: AVRoutePickerView, context: Context) {}
}

/// Debajo del vídeo grande: qué suena, el estado, acciones y fuentes u otros canales.
struct DetalleReproduccion: View {
    @Environment(AppModel.self) private var app
    @Binding var pegando: Bool

    var body: some View {
        let reproductor = app.reproductor
        VStack(alignment: .leading, spacing: 18) {
            if let canal = reproductor.canal {
                VStack(alignment: .leading, spacing: 6) {
                    Text(canal.partido?.titulo ?? canal.titulo)
                        .font(.titular(.title2))
                        .foregroundStyle(Tinta.texto)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    if canal.partido != nil {
                        Text(canal.titulo)
                            .font(.subheadline)
                            .foregroundStyle(Tinta.texto2)
                            .lineLimit(2)
                    }
                    LineaEstado()
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                acciones(canal)

                if let centro = app.centroSonando {
                    CabeceraPartido(partido: centro.partido, marcador: app.marcadores[centro.partido.id])
                    SelectorFuentes(modelo: centro)
                } else {
                    OtrosCanales()
                }

                Button(role: .destructive) {
                    withAnimation(Muelle.estandar) { reproductor.detener() }
                } label: {
                    Label("Detener", systemImage: "stop.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: Medida.toque)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("boton-detener-grande")
            }
        }
    }

    private func acciones(_ canal: CanalReproducible) -> some View {
        let favorito = app.esFavorito(canal.id)
        return HStack(spacing: 10) {
            Button {
                Task { await app.alternarFavorito(id: canal.id, titulo: canal.titulo, ih: canal.ih) }
            } label: {
                Label(favorito ? "En favoritos" : "Favorito", systemImage: favorito ? "star.fill" : "star")
                    .symbolEffect(.bounce, value: favorito)
            }
            .sensoryFeedback(.success, trigger: favorito)
            .accessibilityIdentifier("boton-favorito-grande")

            if app.pip.soportado {
                Button {
                    app.pip.alternar()
                } label: {
                    Label(app.pip.activo ? "Volver" : "PiP", systemImage: app.pip.activo ? "pip.exit" : "pip.enter")
                }
            }

            Menu {
                if app.centroSonando != nil {
                    Button {
                        pegando = true
                    } label: {
                        Label("Pegar un Content ID", systemImage: "doc.on.clipboard")
                    }
                }
                Button {
                    UIPasteboard.general.string = canal.id
                    app.avisos.mostrar("Content ID copiado", tono: .ok)
                } label: {
                    Label("Copiar Content ID", systemImage: "doc.on.doc")
                }
                Menu {
                    ForEach(ReglasFuentes.motivosReporte) { opcion in
                        Button(opcion.texto) { Task { await reportar(canal, opcion.motivo) } }
                    }
                } label: {
                    Label("Reportar", systemImage: "flag")
                }
                Picker(
                    "Modo",
                    selection: Binding(
                        get: { app.reproductor.modo },
                        set: { app.reproductor.cambiarModo($0) })
                ) {
                    ForEach(PlaybackMode.allCases, id: \.self) { modo in
                        Text(modo.etiqueta).tag(modo)
                    }
                }
            } label: {
                Label("Más", systemImage: "ellipsis")
            }
            .accessibilityLabel("Más acciones")
        }
        .labelStyle(.titleAndIcon)
        .font(.subheadline.weight(.semibold))
        .buttonStyle(.bordered)
        .controlSize(.regular)
    }

    private func reportar(_ canal: CanalReproducible, _ motivo: SourceReportReason) async {
        if let centro = app.centroSonando, let entrada = centro.entradas.first(where: { $0.id == canal.id }) {
            await centro.reportar(entrada, motivo: motivo)
            return
        }
        let cuerpo = ReportBody(id: canal.id, reason: motivo, title: canal.titulo, source: canal.origen, ih: canal.ih)
        do {
            _ = try await app.entorno.api.enviar(API.reportarFuente(cuerpo))
            app.avisos.mostrar("Canal reportado: se vuelve a comprobar", tono: .ok)
        } catch {
            app.avisos.mostrar(APIError.desde(error).mensaje, tono: .error)
        }
    }
}

/// Otros canales de la misma lista (favoritos, búsqueda o lista M3U) para cambiar sin salir.
struct OtrosCanales: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let reproductor = app.reproductor
        let otros = Array(reproductor.lista.filter { $0.id != reproductor.canal?.id }.prefix(30))
        if !otros.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("Otros canales")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(Tinta.texto)
                        .accessibilityAddTraits(.isHeader)
                    Text("\(otros.count)")
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundStyle(Tinta.texto3)
                }
                VStack(spacing: 0) {
                    ForEach(Array(otros.enumerated()), id: \.element.id) { indice, canal in
                        if indice > 0 { Divider().padding(.leading, 62) }
                        Button {
                            withAnimation(Muelle.estandar) { reproductor.reproducir(canal, origen: .usuario) }
                        } label: {
                            HStack(spacing: 12) {
                                LogoCanal(titulo: canal.titulo, tamano: 38)
                                Text(canal.titulo)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Tinta.texto)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                                Spacer(minLength: 4)
                                Image(systemName: "play.fill")
                                    .font(.caption)
                                    .foregroundStyle(Tinta.acentoTinta)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .frame(minHeight: Medida.toque)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(EstiloFilaPulsada())
                        .accessibilityLabel("Ver \(canal.titulo)")
                    }
                }
                .background(Tinta.superficie, in: RoundedRectangle(cornerRadius: Medida.radioL, style: .continuous))
            }
        }
    }
}
