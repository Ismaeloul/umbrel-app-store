import AVKit
import SwiftUI

/* Las vistas del reproductor que no son el escenario: los controles sobre el
   vídeo, el hueco de la única capa, la línea de estado, el mini-reproductor
   (72 pt) y la capa que enseña el escenario por encima de las pestañas. */

// MARK: - Controles sobre el vídeo

/// Dónde están los controles: cambia qué botones salen y qué hace «pantalla completa».
enum ContextoControles: Equatable {
    /// Escenario en vertical.
    case grande
    /// Escenario en horizontal (pantalla completa).
    case completa
}

/// Controles propios sobre el vídeo, con cristal claro (Liquid Glass en iOS
/// 26): reproducir/pausa, −30 s, «Directo» con el retraso real, PiP, AirPlay
/// y pantalla completa, más el rótulo de la esquina («Fuente 2 · Verificada»).
/// Quién los enseña o esconde es el escenario (un toque, sin retardo); aquí
/// solo se esconden solos a los 3 s si suena de verdad.
struct ControlesVideo: View {
    @Environment(AppModel.self) private var app
    let contexto: ContextoControles
    @Binding var visibles: Bool
    /// «Fuente 2 · Verificada», «Sin señal», «Reconectando · fuente 2»…
    var rotulo: String?
    var rotuloEsError = false
    /// Si esta fuente se cae, se pasa sola a la siguiente.
    var automatico = false
    var titulo = ""
    var alMinimizar: () -> Void = {}
    var alPantallaCompleta: () -> Void = {}
    @State private var toques = 0
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver

    private var reproductor: Reproductor { app.reproductor }
    private var completa: Bool { contexto == .completa }

    var body: some View {
        ZStack {
            if visibles || voiceOver || reproductor.fase != .reproduciendo {
                capa
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.16), value: visibles)
        .environment(\.colorScheme, .dark)
        .task(id: toques) { await esconderLuego() }
        .onChange(of: visibles) { _, ahora in
            if ahora { toques += 1 }
        }
        .onChange(of: reproductor.fase) { _, fase in
            if fase != .reproduciendo { visibles = true }
            toques += 1
        }
    }

    private var capa: some View {
        ZStack {
            LinearGradient(
                colors: [.black.opacity(0.5), .clear, .clear, .black.opacity(0.7)], startPoint: .top,
                endPoint: .bottom
            )
            .allowsHitTesting(false)

            centro

            VStack {
                barraSuperior
                Spacer()
                barraInferior
            }
            .padding(completa ? 18 : 10)
        }
    }

    private var barraSuperior: some View {
        HStack(alignment: .center, spacing: 8) {
            if let rotulo {
                CapsulaPalco(texto: rotulo, tono: rotuloEsError ? .fallo : .neutro, sobreImagen: true, compacta: !completa)
                    .foregroundStyle(rotuloEsError ? Color(red: 1, green: 0.48, blue: 0.44) : .white)
            }
            if automatico {
                CapsulaPalco(texto: "Auto", tono: .neutro, icono: "arrow.triangle.2.circlepath", sobreImagen: true, compacta: true)
                    .accessibilityLabel("Cambio automático: si esta fuente se cae, se pasa a la siguiente verificada")
            }
            if completa, !titulo.isEmpty {
                Text(titulo)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .padding(.leading, 4)
            }
            Spacer(minLength: 8)
            if completa {
                Button {
                    alMinimizar()
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.headline)
                }
                .botonCristal()
                .accessibilityLabel("Minimizar")
                .accessibilityIdentifier("boton-cerrar-completa")
            }
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
                } else if reproductor.fase == .cargando {
                    Text(reproductor.conexion == .precarga ? "Cargando los primeros segundos…" : "Conectando…")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.85))
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(reproductor.mensaje ?? reproductor.fase.etiqueta)
        case .error, .idle:
            VStack(spacing: 8) {
                if reproductor.motivoParada == .traspaso {
                    Image(systemName: "iphone.and.arrow.forward")
                        .font(.title2)
                    Text("En otro dispositivo")
                        .font(.subheadline.weight(.bold))
                    Button {
                        reproductor.reanudar()
                    } label: {
                        Label("Reproducir aquí", systemImage: "play.fill")
                            .font(.subheadline.weight(.bold))
                            .padding(.horizontal, 14)
                            .frame(minHeight: Medida.toque)
                    }
                    .botonOro()
                } else {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.title2)
                        .foregroundStyle(Tinta.floja)
                    Text("Sin señal")
                        .font(.subheadline.weight(.bold))
                    Button {
                        reproductor.reanudar()
                    } label: {
                        Label("Reintentar", systemImage: "arrow.clockwise")
                            .font(.subheadline.weight(.bold))
                            .padding(.horizontal, 14)
                            .frame(minHeight: Medida.toque)
                            .cristalSobreVideo()
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Volver a intentar")
                }
            }
            .foregroundStyle(.white)
            .padding(12)
            .background(.black.opacity(0.35), in: RoundedRectangle(cornerRadius: Medida.radioM, style: .continuous))
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
                alPantallaCompleta()
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
                        .fill(directo.enDirecto ? Tinta.directo : Color.white.opacity(0.6))
                        .frame(width: 8, height: 8)
                    Text(directo.enDirecto ? "Directo" : "Ir al directo · \(directo.textoBoton)")
                        .font(.caption.weight(.bold).monospacedDigit())
                        .contentTransition(.numericText())
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(minHeight: Medida.toque)
                .cristalSobreVideo()
            }
            .buttonStyle(.plain)
            .disabled(directo.enDirecto)
            .accessibilityLabel(directo.etiquetaAccesible)
            .accessibilityIdentifier("boton-directo")
        }
    }

    private func esconderLuego() async {
        try? await Task.sleep(for: .seconds(3))
        guard !Task.isCancelled, reproductor.fase == .reproduciendo, !voiceOver else { return }
        visibles = false
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
                            .cristalSobreVideo()
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

// MARK: - Línea de estado

/// Lo que está pasando, en una línea (aria-live de la web). Sale solo cuando hay algo que decir.
struct LineaEstado: View {
    @Environment(AppModel.self) private var app
    /// Sobre el vídeo (pantalla completa): blanco sobre velo.
    var sobreVideo = false

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
            .foregroundStyle(sobreVideo ? .white : color(reproductor))
            .padding(.horizontal, sobreVideo ? 12 : 0)
            .padding(.vertical, sobreVideo ? 8 : 0)
            .background {
                if sobreVideo { Capsule().fill(.black.opacity(0.55)) }
            }
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

// MARK: - Capa del escenario

/// El escenario por encima de las pestañas: entra y sale con un fundido
/// cruzado (420 ms; con «Reducir movimiento», 120 ms). Cambiar de partido o
/// de canal con el escenario abierto también funde de uno a otro.
struct CapaEscenario: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento

    var body: some View {
        let objetivo = app.escenarioVisible
        ZStack {
            if let objetivo {
                EscenarioView(objetivo: objetivo)
                    .id(objetivo.id)
                    .transition(sinMovimiento ? .opacity : .opacity.combined(with: .scale(scale: 0.97)))
                    .zIndex(2)
            }
        }
        .animation(sinMovimiento ? Muelle.reducido : Muelle.fundido, value: objetivo?.id)
        .onChange(of: app.reproductor.canal?.id) { _, _ in
            // Al cambiar de canal se vuelve a tapar el marcador y el escenario sigue a lo que suena.
            app.taparMarcadores()
            app.seguirLoQueSuena()
            if app.escenario != nil { app.reproductor.expandir() }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: objetivo == nil)
    }
}

// MARK: - Mini-reproductor

/// El mini (72 pt): la imagen viva (96×54), título, minuto · estado, play
/// y ×. Tocarlo o deslizarlo hacia arriba abre el escenario; hacia abajo (o
/// la ×) detiene con «Deshacer». Ya no se detiene deslizando de lado.
struct MiniReproductor: View {
    @Environment(AppModel.self) private var app
    /// Versión de una línea (la barra de pestañas plegada en iOS 26).
    var enLinea = false
    /// Con su propio cristal (iOS 17-25; en iOS 26 lo pone la barra).
    var conFondo = true
    @State private var arrastre: CGSize = .zero
    @State private var armado: GestosReproductor.SoltarMini = .nada
    @State private var deteniendo = false
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento

    private let forma = RoundedRectangle(cornerRadius: 20, style: .continuous)

    var body: some View {
        let reproductor = app.reproductor
        let desplazamiento = GestosReproductor.desplazamientoMini(arrastre)
        // Fuera de la cadena de modificadores: la cuenta con CGFloat, Double y
        // literales dentro de un ternario es lo que más le cuesta al type-checker.
        let opacidad: Double =
            deteniendo ? 0.4 : 1 - min(0.5, max(0, Double(desplazamiento.height)) / 140)
        HStack(spacing: enLinea ? 10 : 12) {
            VideoApp(prioridad: .mini, gravedad: .resizeAspectFill, compacto: true)
                .frame(width: enLinea ? 44 : 96, height: enLinea ? 26 : 54)
                .clipShape(RoundedRectangle(cornerRadius: enLinea ? 6 : 10, style: .continuous))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(titulo(reproductor))
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Tinta.texto)
                    .lineLimit(1)
                if !enLinea {
                    HStack(spacing: 5) {
                        if reproductor.fase == .reproduciendo {
                            PuntoDirecto(tamano: 6)
                        }
                        Text(estado(reproductor))
                            .lineLimit(1)
                    }
                    .font(.caption.weight(.medium))
                    .foregroundStyle(reproductor.fase == .error ? Tinta.falloTinta : Tinta.texto3)
                }
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
            .sensoryFeedback(.impact(weight: .light), trigger: reproductor.quiereReproducir)
            .accessibilityLabel(reproductor.quiereReproducir ? "Pausa" : "Reproducir")
            .accessibilityIdentifier("mini-reproducir")

            if !enLinea {
                Button {
                    detener()
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
        }
        .padding(.leading, 8)
        .padding(.trailing, enLinea ? 8 : 4)
        .padding(.vertical, enLinea ? 4 : 9)
        .frame(height: enLinea ? 44 : Medida.altoMini)
        .background {
            if conFondo {
                forma
                    .fill(Color.clear)
                    .cristal(en: forma)
            }
        }
        .shadow(color: .black.opacity(conFondo ? 0.18 : 0), radius: 16, y: 6)
        .contentShape(forma)
        .offset(desplazamiento)
        .scaleEffect(deteniendo && !sinMovimiento ? 0.96 : 1)
        .opacity(opacidad)
        .onTapGesture { abrir() }
        .gesture(
            DragGesture(minimumDistance: 8)
                .onChanged { valor in
                    guard !deteniendo else { return }
                    arrastre = valor.translation
                    armado = GestosReproductor.armadoMini(valor.translation)
                }
                .onEnded { valor in soltar(valor) }
        )
        .sensoryFeedback(trigger: armado) { _, nuevo -> SensoryFeedback? in
            switch nuevo {
            case .abrir: SensoryFeedback.impact(weight: .light)
            case .detener: SensoryFeedback.impact(weight: .medium)
            case .nada: nil
            }
        }
        .sensoryFeedback(.impact(flexibility: .rigid), trigger: deteniendo) { _, nuevo in nuevo }
        .animation(sinMovimiento ? Muelle.reducido : Muelle.estandar, value: deteniendo)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("Mini-reproductor: \(titulo(reproductor)), \(estado(reproductor))")
        .accessibilityHint("Toca o desliza hacia arriba para abrir; desliza hacia abajo para detener")
        .accessibilityAction(named: "Abrir el reproductor") { abrir() }
        .accessibilityAction(named: "Detener") { detener() }
        .accessibilityIdentifier("mini-reproductor")
    }

    private func abrir() {
        arrastre = .zero
        armado = .nada
        app.abrirLoQueSuena()
    }

    private func soltar(_ valor: DragGesture.Value) {
        armado = .nada
        switch GestosReproductor.alSoltarMini(traslacion: valor.translation, prevista: valor.predictedEndTranslation) {
        case .abrir:
            abrir()
        case .detener:
            detener()
        case .nada:
            withAnimation(sinMovimiento ? Muelle.reducido : Muelle.estandar) { arrastre = .zero }
        }
    }

    /// Detiene con «Deshacer» (6 s).
    private func detener() {
        guard !deteniendo else { return }
        deteniendo = true
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(sinMovimiento ? 40 : 140))
            withAnimation(sinMovimiento ? Muelle.reducido : Muelle.estandar) { app.detenerConDeshacer() }
            arrastre = .zero
            deteniendo = false
        }
    }

    private func titulo(_ reproductor: Reproductor) -> String {
        reproductor.canal?.partido?.titulo ?? reproductor.canal?.titulo ?? ""
    }

    /// «54' · Sonando · M+ LaLiga», «En pausa», «Reconectando (1/3)…».
    private func estado(_ reproductor: Reproductor) -> String {
        if let mensaje = reproductor.mensaje, reproductor.fase != .reproduciendo { return mensaje }
        if app.pip.activo { return "En imagen en imagen" }
        var partes: [String] = []
        if let id = reproductor.canal?.partido?.id, let marcador = app.marcadores[id], marcador.state == "in" {
            partes.append(Marcador.reloj(marcador))
        }
        switch reproductor.fase {
        case .reproduciendo:
            partes.append("Sonando")
            if let canal = reproductor.canal, canal.partido != nil, !canal.titulo.isEmpty {
                partes.append(ReglasFuentes.parteCanal(canal.titulo))
            }
        case .pausado:
            partes.append("En pausa")
        default:
            partes.append(reproductor.fase.etiqueta)
        }
        return partes.joined(separator: " · ")
    }
}

#if compiler(>=6.2)
    /// El mini como accesorio de la barra de pestañas de iOS 26: el sistema
    /// lo coloca sobre la barra (y lo pliega a una línea al bajar por una lista).
    @available(iOS 26.0, *)
    struct MiniAccesorio: View {
        @Environment(AppModel.self) private var app
        @Environment(\.tabViewBottomAccessoryPlacement) private var colocacion

        var body: some View {
            if app.reproductor.visibleEnMini {
                MiniReproductor(enLinea: colocacion == .inline, conFondo: false)
                    .padding(.horizontal, 4)
            }
        }
    }
#endif

extension View {
    /// En iOS 17-25, el mini va sobre la barra de pestañas como inset inferior
    /// de cada pestaña (así la última fila nunca queda debajo). En iOS 26 no
    /// hace falta: es el accesorio de la barra y el sistema reserva su hueco.
    func reservaMini() -> some View {
        modifier(ReservaMini())
    }
}

private struct ReservaMini: ViewModifier {
    @Environment(AppModel.self) private var app

    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .bottom, spacing: 0) {
            miniInferior
        }
    }

    @ViewBuilder private var miniInferior: some View {
        #if compiler(>=6.2)
            if #available(iOS 26.0, *) {
                EmptyView()
            } else {
                miniClasico
            }
        #else
            miniClasico
        #endif
    }

    @ViewBuilder private var miniClasico: some View {
        if app.reproductor.visibleEnMini {
            MiniReproductor()
                .padding(.horizontal, 12)
                .padding(.bottom, 6)
                .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}
