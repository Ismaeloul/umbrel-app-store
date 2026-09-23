import AVKit
import SwiftUI

// MARK: - Controles sobre el vídeo

/// Controles propios sobre el vídeo, con cristal (Liquid Glass en iOS 26):
/// reproducir/pausa, −30 s, «Directo» con el retraso real, PiP, AirPlay y
/// pantalla completa. Se esconden a los 3,2 s si suena de verdad.
struct ControlesVideo: View {
    @Environment(AppModel.self) private var app
    let completa: Bool
    var alCerrar: (() -> Void)?
    @State private var visibles = true
    @State private var toques = 0
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver

    private var reproductor: Reproductor { app.reproductor }

    var body: some View {
        ZStack {
            // Zona para mostrar/ocultar con un toque (y doble toque para pantalla completa).
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture(count: 2) { alternarPantallaCompleta() }
                .onTapGesture { withAnimation(Muelle.rapido) { visibles.toggle() }; toques += 1 }
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
                alCerrar?()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.headline)
            }
            .botonCristal()
            .accessibilityLabel("Cerrar pantalla completa")
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
            if let estadisticas = reproductor.estadisticas, completa {
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

    private func alternarPantallaCompleta() {
        if completa {
            alCerrar?()
        } else {
            reproductor.pantallaCompleta = true
        }
    }

    private func esconderLuego() async {
        try? await Task.sleep(for: .seconds(3.2))
        guard !Task.isCancelled, reproductor.fase == .reproduciendo, !voiceOver else { return }
        withAnimation(Muelle.estandar) { visibles = false }
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
                Color.black
                if !reproductor.pantallaCompleta {
                    VistaVideo(player: reproductor.motor.avPlayer, pip: app.pip)
                }
                ControlesVideo(completa: false)
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

// MARK: - Pantalla completa

/// Reproductor a pantalla completa: negro, en horizontal y con los controles
/// grandes. Se abre desde el botón, el mini-reproductor o al volver del PiP.
struct ReproductorCompleto: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var cerrar
    @State private var arrastre: CGFloat = 0

    var body: some View {
        let reproductor = app.reproductor
        ZStack {
            Color.black.ignoresSafeArea()
            VistaVideo(player: reproductor.motor.avPlayer, pip: app.pip)
                .ignoresSafeArea()
            ControlesVideo(completa: true) { salir() }
            VStack {
                Spacer()
                LineaEstado()
                    .padding(.bottom, 70)
                    .environment(\.colorScheme, .dark)
            }
        }
        .offset(y: max(0, arrastre))
        .gesture(
            DragGesture(minimumDistance: 30)
                .onChanged { valor in arrastre = valor.translation.height }
                .onEnded { valor in
                    if valor.translation.height > 140 { salir() } else { withAnimation(Muelle.estandar) { arrastre = 0 } }
                }
        )
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .accessibilityIdentifier("reproductor-completo")
        .onAppear { Orientacion.pedir(.landscape) }
        .onDisappear { Orientacion.pedir(.portrait) }
    }

    private func salir() {
        app.reproductor.pantallaCompleta = false
        cerrar()
    }
}

// MARK: - Mini-reproductor

/// Mini-reproductor flotante sobre la barra de pestañas cuando se sale del
/// partido sin detener: vídeo pequeño, título, pausa y cerrar. Al tocarlo se
/// abre a pantalla completa.
struct MiniReproductor: View {
    @Environment(AppModel.self) private var app
    @Environment(\.espacioReproductor) private var espacioCompartido
    let espacio: Namespace.ID

    var body: some View {
        let reproductor = app.reproductor
        HStack(spacing: 12) {
            ZStack {
                Color.black
                VistaVideo(player: reproductor.motor.avPlayer, pip: app.pip, gravedad: .resizeAspectFill)
            }
            .frame(width: 72, height: 42)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(reproductor.canal?.partido?.titulo ?? reproductor.canal?.titulo ?? "")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Tinta.texto)
                    .lineLimit(1)
                Text(subtitulo(reproductor))
                    .font(.caption)
                    .foregroundStyle(reproductor.fase == .error ? Tinta.falloTinta : Tinta.texto2)
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
            }
            .buttonStyle(.plain)
            .foregroundStyle(Tinta.texto)
            .accessibilityLabel(reproductor.quiereReproducir ? "Pausa" : "Reproducir")
            .accessibilityIdentifier("mini-reproducir")

            Button {
                withAnimation(Muelle.estandar) { reproductor.detener() }
            } label: {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .frame(width: Medida.toque, height: Medida.toque)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Tinta.texto2)
            .accessibilityLabel("Detener")
            .accessibilityIdentifier("mini-detener")
        }
        .padding(.leading, 8)
        .padding(.trailing, 4)
        .padding(.vertical, 6)
        .cristal(en: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: .black.opacity(0.15), radius: 16, y: 6)
        .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .onTapGesture { reproductor.pantallaCompleta = true }
        .origenZoom("mini", en: espacioCompartido ?? espacio)
        .padding(.horizontal, Medida.margen)
        .padding(.bottom, 8)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Abre el reproductor a pantalla completa")
        .accessibilityIdentifier("mini-reproductor")
    }

    private func subtitulo(_ reproductor: Reproductor) -> String {
        if let mensaje = reproductor.mensaje, reproductor.fase != .reproduciendo { return mensaje }
        if reproductor.canal?.partido != nil, let titulo = reproductor.canal?.titulo { return titulo }
        return reproductor.fase.etiqueta
    }
}

/// Espacio de nombres del reproductor (el mini hace zoom al reproductor completo).
private struct ClaveEspacioReproductor: EnvironmentKey {
    static var defaultValue: Namespace.ID? { nil }
}

extension EnvironmentValues {
    var espacioReproductor: Namespace.ID? {
        get { self[ClaveEspacioReproductor.self] }
        set { self[ClaveEspacioReproductor.self] = newValue }
    }
}

extension View {
    /// Coloca el mini-reproductor sobre la barra de pestañas (y aparta el contenido).
    func conMiniReproductor(_ app: AppModel, espacio: Namespace.ID) -> some View {
        safeAreaInset(edge: .bottom, spacing: 0) {
            if app.reproductor.visibleEnMini {
                MiniReproductor(espacio: espacio)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(Muelle.estandar, value: app.reproductor.visibleEnMini)
    }
}
