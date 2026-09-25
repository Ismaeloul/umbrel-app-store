import SwiftUI

/* Componentes de «Luz de focos» en SwiftUI (docs/diseno/sistema.md §3 y §5):
   el medidor de señal (SignalBadge), el anillo del minuto (LiveRing), la
   marca del equipo (TeamMark), los avisos (toasts) y el cristal de los
   controles flotantes. */

// MARK: - Estado de la señal

/// Estado de una fuente: medidor de tres barras SIEMPRE con su palabra.
/// Nunca solo color: cada estado tiene su forma.
public enum EstadoSenal: String, Sendable, Hashable {
    case ok
    case floja
    case sinSenal
    case comprobando
    case pendiente

    public var palabra: String {
        switch self {
        case .ok: "Verificada"
        case .floja: "Floja"
        case .sinSenal: "Sin señal"
        case .comprobando: "Comprobando"
        case .pendiente: "Pendiente"
        }
    }

    /// Color con el mismo significado que en la web (los de estado no se usan para nada más).
    public var tinta: Color {
        switch self {
        case .ok: Tinta.okTinta
        case .floja: Tinta.flojaTinta
        case .sinSenal: Tinta.falloTinta
        case .comprobando: Tinta.acentoTinta
        case .pendiente: Tinta.texto3
        }
    }

    /// Barras encendidas (0…1) del símbolo `cellularbars`.
    var barras: Double {
        switch self {
        case .ok: 1
        case .floja: 0.66
        case .comprobando: 0.33
        case .sinSenal, .pendiente: 0
        }
    }

    /// Estado del comprobador o veredicto → medidor.
    public static func desde(_ estado: ScanCandidateState?) -> EstadoSenal {
        switch estado {
        case .working: .ok
        case .weak: .floja
        case .failed: .sinSenal
        case .checking: .comprobando
        default: .pendiente
        }
    }
}

/// Medidor + palabra (SignalBadge).
public struct MedidorSenal: View {
    let estado: EstadoSenal
    var palabra: String?
    var compacto = false
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento

    public init(_ estado: EstadoSenal, palabra: String? = nil, compacto: Bool = false) {
        self.estado = estado
        self.palabra = palabra
        self.compacto = compacto
    }

    public var body: some View {
        HStack(spacing: 5) {
            icono
                .font(.caption.weight(.bold))
                .frame(minWidth: 16)
            if !compacto {
                Text(palabra ?? estado.palabra)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
            }
        }
        .foregroundStyle(estado.tinta)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Señal: \(palabra ?? estado.palabra)")
    }

    @ViewBuilder private var icono: some View {
        switch estado {
        case .sinSenal:
            Image(systemName: "xmark.circle")
        case .pendiente:
            Image(systemName: "circle.dotted")
        case .comprobando:
            Image(systemName: "cellularbars", variableValue: sinMovimiento ? 0.33 : 1)
                .symbolEffect(.variableColor.iterative, options: .repeating, isActive: !sinMovimiento)
        default:
            Image(systemName: "cellularbars", variableValue: estado.barras)
        }
    }
}

// MARK: - Anillo del minuto

/// Anillo del partido en directo: el minuto dentro y el arco de lo jugado.
/// Late cada 2 s salvo con «Reducir movimiento».
public struct AnilloDirecto: View {
    let minuto: Int?
    var tamano: CGFloat = 44
    @Environment(\.accessibilityReduceMotion) private var sinMovimiento
    @State private var latido = false

    public init(minuto: Int?, tamano: CGFloat = 44) {
        self.minuto = minuto
        self.tamano = tamano
    }

    private var progreso: Double {
        guard let minuto else { return 0.02 }
        return min(1, max(0.02, Double(minuto) / 90))
    }

    public var body: some View {
        ZStack {
            Circle()
                .stroke(Tinta.directo.opacity(0.18), lineWidth: 3)
            Circle()
                .trim(from: 0, to: progreso)
                .stroke(Tinta.directo, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if !sinMovimiento {
                // La onda vive dentro de su caja (no se sale al latir).
                Circle()
                    .stroke(Tinta.directo.opacity(latido ? 0 : 0.45), lineWidth: 2)
                    .scaleEffect(latido ? 1.14 : 0.9)
            }
            Text(minuto.map { "\($0)'" } ?? "EN")
                .font(.numeros(.caption, peso: .bold))
                .foregroundStyle(Tinta.directo)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .padding(4)
        }
        .frame(width: tamano, height: tamano)
        .clipShape(Rectangle().inset(by: -tamano * 0.08))
        .onAppear {
            guard !sinMovimiento else { return }
            withAnimation(.easeOut(duration: 2).repeatForever(autoreverses: false)) { latido = true }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(minuto.map { "En directo, minuto \($0)" } ?? "En directo")
    }
}

// MARK: - Marca del equipo

/// Escudo sencillo: iniciales sobre el color del equipo (derivado del nombre,
/// evitando el violeta y los tonos de «verificada» y «sin señal»).
public struct MarcaEquipo: View {
    let nombre: String
    var tamano: CGFloat = 36
    @Environment(\.colorScheme) private var esquema

    public init(_ nombre: String, tamano: CGFloat = 36) {
        self.nombre = nombre
        self.tamano = tamano
    }

    public var body: some View {
        Text(ColorEquipo.iniciales(nombre))
            .font(.system(size: tamano * 0.36, weight: .heavy).width(.compressed))
            .foregroundStyle(.white)
            .frame(width: tamano, height: tamano)
            .background(ColorEquipo.color(nombre, oscuro: esquema == .dark).gradient, in: Circle())
            .overlay(Circle().strokeBorder(.white.opacity(0.25), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

/// Tono de un nombre (el `hueFromName` de la web).
public enum ColorEquipo {
    public static func tono(_ nombre: String) -> Double {
        var h: UInt32 = 2_166_136_261
        for byte in nombre.lowercased().utf8 {
            h ^= UInt32(byte)
            h = h &* 16_777_619
        }
        var grados = Double(h % 360)
        // Fuera el violeta (280-320), el verde de «verificada» (140-160) y el rojo de «sin señal» (15-40).
        for (desde, hasta) in [(280.0, 320.0), (140.0, 160.0), (15.0, 40.0)] where grados >= desde && grados <= hasta {
            grados = (hasta + 12).truncatingRemainder(dividingBy: 360)
        }
        return grados / 360
    }

    public static func color(_ nombre: String, oscuro: Bool) -> Color {
        Color(hue: tono(nombre), saturation: oscuro ? 0.55 : 0.62, brightness: oscuro ? 0.72 : 0.62)
    }

    public static func iniciales(_ nombre: String) -> String {
        let palabras = nombre.split(whereSeparator: { $0 == " " || $0 == "-" || $0 == "." })
            .filter { $0.count > 2 || $0.uppercased() == $0 }
        if palabras.count == 1, let unica = palabras.first { return String(unica.prefix(2)).uppercased() }
        let letras = palabras.prefix(2).compactMap(\.first).map(String.init).joined()
        return letras.isEmpty ? String(nombre.prefix(2)).uppercased() : letras.uppercased()
    }
}

// MARK: - Dorsal del canal

/// El «dorsal» del canal (el `ChannelMark` de la web): su número o su
/// inicial, grande y recortado por la esquina, sobre un tono sacado del nombre.
public struct LogoCanal: View {
    let titulo: String
    var tamano: CGFloat = 52
    @Environment(\.colorScheme) private var esquema

    public init(titulo: String, tamano: CGFloat = 52) {
        self.titulo = titulo
        self.tamano = tamano
    }

    /// «DAZN 1» → «1», «M+ Liga de Campeones 2» → «2», «Eurosport» → «E»
    /// (sin lo que va tras la flecha: el proveedor no es el canal).
    public static func dorsal(_ titulo: String) -> String {
        let nombre = ReglasFuentes.parteCanal(titulo)
        var numeros: [String] = []
        var actual = ""
        for caracter in nombre {
            if caracter.isASCII, caracter.isNumber {
                actual.append(caracter)
            } else if !actual.isEmpty {
                numeros.append(actual)
                actual = ""
            }
        }
        if !actual.isEmpty { numeros.append(actual) }
        if let ultimo = numeros.last { return String(ultimo.prefix(3)) }
        let letra = ParaTi.sinMarcas(nombre).first { $0.isASCII && $0.isLetter }
        return letra.map { String($0).uppercased() } ?? "·"
    }

    public var body: some View {
        let dorsal = Self.dorsal(titulo)
        let esLetra = !(dorsal.first?.isNumber ?? false)
        let tono = ColorEquipo.tono(titulo)
        let base = Color(hue: tono, saturation: esquema == .dark ? 0.5 : 0.55, brightness: esquema == .dark ? 0.62 : 0.58)
        let claro = Color(hue: tono, saturation: 0.45, brightness: esquema == .dark ? 0.8 : 0.78)
        RoundedRectangle(cornerRadius: tamano * 0.26, style: .continuous)
            .fill(LinearGradient(colors: [claro, base], startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay(alignment: esLetra ? .trailing : .bottomTrailing) {
                Text(dorsal)
                    .font(.system(size: tamano * (dorsal.count > 1 ? 0.62 : 0.86), weight: .black).width(.compressed))
                    .foregroundStyle(.white.opacity(0.95))
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .offset(x: esLetra ? tamano * 0.1 : tamano * 0.04, y: esLetra ? 0 : tamano * 0.14)
            }
            .clipShape(RoundedRectangle(cornerRadius: tamano * 0.26, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: tamano * 0.26, style: .continuous)
                    .strokeBorder(.white.opacity(0.18), lineWidth: 1)
            )
            .frame(width: tamano, height: tamano)
            .accessibilityHidden(true)
    }
}

// MARK: - Filas y chips

/// Fila que se ilumina al pulsarla (listas hechas a mano dentro de tarjetas).
public struct EstiloFilaPulsada: ButtonStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Tinta.superficie2 : Color.clear)
            .animation(Muelle.rapido, value: configuration.isPressed)
    }
}

/// Coloca los hijos en filas, saltando de línea cuando no caben (los chips de las preferencias).
public struct DisposicionFlujo: Layout {
    var espacio: CGFloat = 8
    var interlineado: CGFloat = 8

    public init(espacio: CGFloat = 8, interlineado: CGFloat = 8) {
        self.espacio = espacio
        self.interlineado = interlineado
    }

    public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let ancho = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var altoFila: CGFloat = 0
        var anchoMaximo: CGFloat = 0
        for vista in subviews {
            let medida = vista.sizeThatFits(ProposedViewSize(width: ancho, height: nil))
            if x > 0 && x + medida.width > ancho {
                y += altoFila + interlineado
                x = 0
                altoFila = 0
            }
            x += medida.width + espacio
            altoFila = max(altoFila, medida.height)
            anchoMaximo = max(anchoMaximo, x - espacio)
        }
        return CGSize(width: ancho.isFinite ? ancho : anchoMaximo, height: y + altoFila)
    }

    public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var altoFila: CGFloat = 0
        for vista in subviews {
            let medida = vista.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX && x + medida.width > bounds.maxX {
                y += altoFila + interlineado
                x = bounds.minX
                altoFila = 0
            }
            vista.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(medida))
            x += medida.width + espacio
            altoFila = max(altoFila, medida.height)
        }
    }
}

/// Chip que se marca y desmarca (ligas, equipos y nacionalidades).
public struct ChipSeleccionable: View {
    let texto: String
    let marcado: Bool
    let accion: () -> Void

    public init(_ texto: String, marcado: Bool, accion: @escaping () -> Void) {
        self.texto = texto
        self.marcado = marcado
        self.accion = accion
    }

    public var body: some View {
        Button(action: accion) {
            HStack(spacing: 5) {
                if marcado {
                    Image(systemName: "checkmark")
                        .font(.caption.weight(.bold))
                        .transition(.scale.combined(with: .opacity))
                }
                Text(texto)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(marcado ? Tinta.sobreAcento : Tinta.texto)
            .padding(.horizontal, 14)
            .frame(minHeight: 38)
            .background(marcado ? Tinta.acento : Tinta.superficie2, in: Capsule())
            .overlay(Capsule().strokeBorder(marcado ? Tinta.acentoBorde : Tinta.linea, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .animation(Muelle.rapido, value: marcado)
        .sensoryFeedback(.selection, trigger: marcado)
        .accessibilityLabel(texto)
        .accessibilityAddTraits(marcado ? [.isSelected] : [])
    }
}

// MARK: - Avisos

/// Un aviso breve (toast), con acción opcional («Deshacer»).
public struct Aviso: Identifiable, Equatable, Sendable {
    public enum Tono: Equatable, Sendable { case normal, ok, error }

    public let id = UUID()
    public var texto: String
    public var tono: Tono = .normal
    public var accion: String?
    public var duracion: TimeInterval = 3.2

    public init(_ texto: String, tono: Tono = .normal, accion: String? = nil, duracion: TimeInterval = 3.2) {
        self.texto = texto
        self.tono = tono
        self.accion = accion
        self.duracion = duracion
    }

    public static func == (a: Aviso, b: Aviso) -> Bool { a.id == b.id }
}

/// Avisos de la app (uno a la vez, arriba, fuera del vídeo).
@MainActor
@Observable
public final class Avisos {
    public private(set) var actual: Aviso?
    @ObservationIgnored private var alPulsar: (() -> Void)?
    @ObservationIgnored private var tarea: Task<Void, Never>?

    public init() {}

    public func mostrar(_ aviso: Aviso, alPulsar: (() -> Void)? = nil) {
        tarea?.cancel()
        self.alPulsar = alPulsar
        actual = aviso
        let id = aviso.id
        let duracion = aviso.duracion
        tarea = Task { [weak self] in
            try? await Task.sleep(for: .seconds(duracion))
            guard !Task.isCancelled, let self, self.actual?.id == id else { return }
            self.actual = nil
            self.alPulsar = nil
        }
    }

    public func mostrar(_ texto: String, tono: Aviso.Tono = .normal) {
        mostrar(Aviso(texto, tono: tono))
    }

    public func pulsarAccion() {
        let accion = alPulsar
        cerrar()
        accion?()
    }

    public func cerrar() {
        tarea?.cancel()
        actual = nil
        alPulsar = nil
    }
}

/// La píldora de cristal del aviso.
struct VistaAviso: View {
    let aviso: Aviso
    let alPulsar: () -> Void
    let alCerrar: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icono)
                .foregroundStyle(color)
                .accessibilityHidden(true)
            Text(aviso.texto)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Tinta.texto)
                .fixedSize(horizontal: false, vertical: true)
            if let accion = aviso.accion {
                Button(accion, action: alPulsar)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Tinta.acentoTinta)
                    .frame(minHeight: Medida.toque)
                    .accessibilityIdentifier("aviso-accion")
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 8)
        .frame(minHeight: Medida.toque)
        .cristal(en: Capsule())
        .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
        .padding(.horizontal, Medida.margen)
        .onTapGesture { if aviso.accion == nil { alCerrar() } }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isStaticText)
        .accessibilityIdentifier("aviso")
    }

    private var icono: String {
        switch aviso.tono {
        case .normal: "info.circle"
        case .ok: "checkmark.circle"
        case .error: "exclamationmark.triangle"
        }
    }

    private var color: Color {
        switch aviso.tono {
        case .normal: Tinta.acentoTinta
        case .ok: Tinta.okTinta
        case .error: Tinta.falloTinta
        }
    }
}

extension View {
    /// Pinta el aviso actual ARRIBA (como los toasts del prototipo de Palco:
    /// nunca sobre el vídeo ni sobre la barra de pestañas), con su transición y su háptica.
    func avisos(_ avisos: Avisos, margenSuperior: CGFloat = 8) -> some View {
        overlay(alignment: .top) {
            if let aviso = avisos.actual {
                VistaAviso(aviso: aviso, alPulsar: { avisos.pulsarAccion() }, alCerrar: { avisos.cerrar() })
                    .padding(.top, margenSuperior)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .id(aviso.id)
            }
        }
        .animation(Muelle.estandar, value: avisos.actual)
        .sensoryFeedback(trigger: avisos.actual) { _, nuevo -> SensoryFeedback? in
            nuevo?.tono == Aviso.Tono.error ? SensoryFeedback.error : nil
        }
    }
}

// MARK: - Cristal para botones sobre el vídeo

/// Fondo redondo de cristal: Liquid Glass del sistema en iOS 26 y material
/// en 17-25; opaco con «Reducir transparencia».
struct FondoCristalCircular: ViewModifier {
    var diametro: CGFloat = Medida.toque
    @Environment(\.accessibilityReduceTransparency) private var sinTransparencia

    func body(content: Content) -> some View {
        #if compiler(>=6.2)
            if #available(iOS 26.0, *), !sinTransparencia {
                content
                    .frame(width: diametro, height: diametro)
                    .glassEffect(.regular.interactive(), in: Circle())
            } else {
                respaldo(content)
            }
        #else
            respaldo(content)
        #endif
    }

    private func respaldo(_ content: Content) -> some View {
        content
            .frame(width: diametro, height: diametro)
            .background(
                sinTransparencia ? AnyShapeStyle(Color.black.opacity(0.7)) : AnyShapeStyle(Material.ultraThinMaterial),
                in: Circle())
    }
}

/// Botón redondo de cristal para los controles sobre el vídeo (44 pt como mínimo).
struct EstiloBotonCristal: ButtonStyle {
    var diametro: CGFloat = Medida.toque

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.white)
            .frame(width: diametro, height: diametro)
            .contentShape(Circle())
            .modifier(FondoCristalCircular(diametro: diametro))
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .animation(Muelle.rapido, value: configuration.isPressed)
    }
}

extension View {
    func botonCristal(diametro: CGFloat = Medida.toque) -> some View {
        buttonStyle(EstiloBotonCristal(diametro: diametro))
    }

    func fondoCristalCircular(diametro: CGFloat = Medida.toque) -> some View {
        modifier(FondoCristalCircular(diametro: diametro))
    }

    /// Transición de «zoom» de una tarjeta a su pantalla (iOS 18+; en 17 sin ella).
    @ViewBuilder
    func origenZoom(_ id: String, en espacio: Namespace.ID) -> some View {
        if #available(iOS 18.0, *) {
            matchedTransitionSource(id: id, in: espacio)
        } else {
            self
        }
    }

    @ViewBuilder
    func destinoZoom(_ id: String, en espacio: Namespace.ID) -> some View {
        if #available(iOS 18.0, *) {
            navigationTransition(.zoom(sourceID: id, in: espacio))
        } else {
            self
        }
    }
}
