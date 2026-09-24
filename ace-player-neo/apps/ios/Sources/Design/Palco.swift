import SwiftUI

/* Piezas de Palco compartidas por varias pantallas: la cápsula de estado,
   el botón de oro (la única acción principal), el segundo toque (en vez de
   un diálogo de confirmación), la cabecera de fila y la entrada escalonada. */

// MARK: - Cápsula

/// Tono de una cápsula: el semáforo de la señal, «en directo» o neutro.
public enum TonoCapsula: Sendable, Hashable {
    case ok, floja, fallo, comprobando, neutro, directo, oro

    var color: Color {
        switch self {
        case .ok: Tinta.okTinta
        case .floja: Tinta.flojaTinta
        case .fallo: Tinta.falloTinta
        case .comprobando: Tinta.texto2
        case .neutro: Tinta.texto
        case .directo: Tinta.directo
        case .oro: Tinta.acentoTinta
        }
    }

    var fondo: Color {
        switch self {
        case .ok: Tinta.ok.opacity(0.16)
        case .floja: Tinta.floja.opacity(0.16)
        case .fallo: Tinta.fallo.opacity(0.16)
        case .comprobando: Tinta.superficie2
        case .neutro: Tinta.superficie2
        case .directo: Tinta.directo.opacity(0.16)
        case .oro: Tinta.oro.opacity(0.18)
        }
    }
}

/// Cápsula de estado o de acción («● Señal», «Dónde se emite», «Más»).
struct CapsulaPalco: View {
    let texto: String
    var tono: TonoCapsula = .neutro
    var punto = false
    var icono: String?
    /// Sobre el vídeo o una imagen: cristal con velo en vez de superficie.
    var sobreImagen = false
    var compacta = false
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento

    var body: some View {
        HStack(spacing: compacta ? 4 : 6) {
            if punto {
                Circle()
                    .fill(tono.color)
                    .frame(width: compacta ? 6 : 7, height: compacta ? 6 : 7)
                    .modifier(Latido(activo: tono == .directo && !sinMovimiento))
            } else if let icono {
                Image(systemName: icono)
                    .font(compacta ? .caption2.weight(.bold) : .caption.weight(.bold))
            }
            Text(texto)
                .font(compacta ? .caption2.weight(.bold) : .footnote.weight(.semibold))
                .lineLimit(1)
        }
        .foregroundStyle(sobreImagen ? .white : tono.color)
        .padding(.horizontal, compacta ? 8 : 12)
        .frame(minHeight: compacta ? 24 : 32)
        .background {
            if sobreImagen {
                Capsule().fill(.black.opacity(0.55))
                    .overlay(Capsule().strokeBorder(.white.opacity(0.14), lineWidth: 0.5))
            } else {
                Capsule().fill(tono.fondo)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(texto)
    }
}

/// Latido suave de un punto rojo («en directo»).
private struct Latido: ViewModifier {
    let activo: Bool
    @State private var encendido = false

    func body(content: Content) -> some View {
        content
            .opacity(activo && encendido ? 0.45 : 1)
            .onAppear {
                guard activo else { return }
                withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) { encendido = true }
            }
    }
}

/// Cápsula que se pulsa (las del escenario).
struct BotonCapsula: View {
    let texto: String
    var tono: TonoCapsula = .neutro
    var punto = false
    var icono: String?
    let accion: () -> Void

    var body: some View {
        Button(action: accion) {
            HStack(spacing: 6) {
                if punto {
                    Circle().fill(tono.color).frame(width: 7, height: 7)
                } else if let icono {
                    Image(systemName: icono).font(.subheadline.weight(.semibold))
                }
                Text(texto)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(tono == .neutro ? Tinta.texto : tono.color)
            .padding(.horizontal, 14)
            .frame(minHeight: 40)
            .background(tono.fondo, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Botón de oro

/// El botón de la acción principal («Ver ahora», «Emparejar»): Liquid Glass
/// prominente teñido de oro en iOS 26 y prominente teñido de oro en 17-25.
struct BotonOro: ViewModifier {
    func body(content: Content) -> some View {
        #if compiler(>=6.2)
            if #available(iOS 26.0, *) {
                content
                    .buttonStyle(.glassProminent)
                    .tint(Tinta.oro)
            } else {
                content
                    .buttonStyle(.borderedProminent)
                    .tint(Tinta.oro)
            }
        #else
            content
                .buttonStyle(.borderedProminent)
                .tint(Tinta.oro)
        #endif
    }
}

extension View {
    /// Botón de oro (acción principal).
    func botonOro() -> some View {
        modifier(BotonOro())
    }
}

// MARK: - Segundo toque

/// Botón que pide un segundo toque en unos segundos («¿Reiniciar? Pulsa otra
/// vez») en vez de abrir un diálogo (inventario §5).
struct BotonSegundoToque: View {
    let titulo: String
    let confirmacion: String
    var plazo: TimeInterval = 5
    var destructivo = true
    var deshabilitado = false
    let accion: () -> Void
    @State private var armado = false
    @State private var tarea: Task<Void, Never>?

    var body: some View {
        Button(role: destructivo ? .destructive : nil) {
            if armado {
                tarea?.cancel()
                armado = false
                accion()
            } else {
                armado = true
                tarea?.cancel()
                tarea = Task {
                    try? await Task.sleep(for: .seconds(plazo))
                    guard !Task.isCancelled else { return }
                    armado = false
                }
            }
        } label: {
            HStack {
                Text(armado ? confirmacion : titulo)
                    .contentTransition(.opacity)
                if armado {
                    Spacer(minLength: 8)
                    Image(systemName: "hand.tap")
                        .font(.footnote)
                        .accessibilityHidden(true)
                }
            }
        }
        .disabled(deshabilitado)
        .animation(Muelle.rapido, value: armado)
        .sensoryFeedback(.warning, trigger: armado) { _, nuevo in nuevo }
        .accessibilityHint(armado ? "Toca otra vez para confirmar" : "Pide un segundo toque para confirmar")
        .onDisappear { tarea?.cancel() }
    }
}

// MARK: - Cabecera de fila

/// Título de un bloque («Fuentes · 4», «También en directo») con acción opcional.
struct CabeceraFila: View {
    let titulo: String
    var cuenta: Int?
    var directo = false
    var subtitulo: String?
    var accion: (titulo: String, icono: String, girando: Bool, hacer: () -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if directo {
                Circle().fill(Tinta.directo).frame(width: 7, height: 7)
                    .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 3 }
                    .accessibilityHidden(true)
            }
            Text(titulo)
                .font(.headline)
                .foregroundStyle(Tinta.texto)
                .accessibilityAddTraits(.isHeader)
            if let cuenta {
                Text("\(cuenta)")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Tinta.texto3)
            }
            if let subtitulo {
                Text(subtitulo)
                    .font(.caption)
                    .foregroundStyle(Tinta.texto3)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if let accion {
                Button(action: accion.hacer) {
                    Label(accion.titulo, systemImage: accion.icono)
                        .font(.subheadline.weight(.semibold))
                        .labelStyle(.titleAndIcon)
                        .symbolEffect(.pulse, isActive: accion.girando)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(Tinta.acentoTinta)
            }
        }
    }
}

// MARK: - Entrada escalonada

/// Los bloques del escenario entran uno tras otro (50 ms entre bloques);
/// con «Reducir movimiento», solo fundido.
struct EntradaEscalonada: ViewModifier {
    let indice: Int
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento
    @State private var visible = false

    func body(content: Content) -> some View {
        content
            .opacity(visible ? 1 : 0)
            .offset(y: visible || sinMovimiento ? 0 : 14)
            .onAppear {
                let retardo = sinMovimiento ? 0 : 0.06 + Double(indice) * 0.05
                withAnimation(.easeOut(duration: sinMovimiento ? 0.12 : 0.36).delay(retardo)) { visible = true }
            }
    }
}

extension View {
    func entradaEscalonada(_ indice: Int) -> some View {
        modifier(EntradaEscalonada(indice: indice))
    }

    /// Háptica de selección que se calla con «Reducir movimiento» (como `haptic()` del prototipo).
    func hapticoSeleccion<T: Equatable>(trigger: T) -> some View {
        modifier(HapticoSeleccion(trigger: trigger))
    }
}

private struct HapticoSeleccion<T: Equatable>: ViewModifier {
    let trigger: T
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento

    func body(content: Content) -> some View {
        content.sensoryFeedback(trigger: trigger) { _, _ -> SensoryFeedback? in
            sinMovimiento ? nil : SensoryFeedback.selection
        }
    }
}

// MARK: - Punto rojo

/// «● EN DIRECTO» en mayúsculas para antetítulos.
struct PuntoDirecto: View {
    var tamano: CGFloat = 7
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento

    var body: some View {
        Circle()
            .fill(Tinta.directo)
            .frame(width: tamano, height: tamano)
            .modifier(Latido(activo: !sinMovimiento))
            .accessibilityHidden(true)
    }
}
