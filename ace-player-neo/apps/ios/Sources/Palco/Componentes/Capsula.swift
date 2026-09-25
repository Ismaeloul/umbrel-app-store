import SwiftUI

/// `<Capsule>` de la web, la píldora de Palco (a1 §10.6; ui/Capsule.css). Alto 28 (sm 24), texto 13/640/88
/// (sm 11 con +0,02 em), punto de 7 que late en directo y ok, icono 18 (sm 16). En `cristal` es isla oscura
/// sobre vídeo; directo y oro NO son cristal: llevan su color siempre, también con transparencia reducida
/// (b-arquitectura §0.4, a1 §0.7). Con `accion` es un interruptor (`pulsado`).
struct Capsula: View {
    enum Tono: Sendable { case neutral, directo, ok, weak, fail, oro }
    enum Tamano: Sendable { case md, sm }

    let texto: String
    let tono: Tono
    let tamano: Tamano
    let punto: Bool
    let icono: NombreIcono?
    let cristal: TipoCristal?
    let pulsado: Bool?
    let accion: (() -> Void)?
    @Environment(\.isEnabled) private var habilitado
    @Environment(\.colorScheme) private var esquema

    init(_ texto: String, tono: Tono = .neutral, tamano: Tamano = .md, punto: Bool = false, icono: NombreIcono? = nil,
         cristal: TipoCristal? = nil, pulsado: Bool? = nil, accion: (() -> Void)? = nil) {
        self.texto = texto
        self.tono = tono
        self.tamano = tamano
        self.punto = punto
        self.icono = icono
        self.cristal = cristal
        self.pulsado = pulsado
        self.accion = accion
    }

    private var sm: Bool { tamano == .sm }
    private var activo: Bool { pulsado == true }
    @Environment(\.trackingCapsulaEm) private var trackingPropio
    @Environment(\.llenarAncho) private var llenarAncho

    private var estiloTexto: EstiloTexto {
        var estilo = sm ? EstiloTexto.capsulaSm : EstiloTexto.capsula
        if let trackingPropio { estilo.trackingEm = trackingPropio }
        return estilo
    }

    var body: some View {
        Group {
            if let accion {
                Button(action: accion) { pildora }
                    .buttonStyle(EstiloPulsar())
                    .opacity(habilitado ? 1 : 0.55)
                    .contentShape(Rectangle().inset(by: -8))  // Capsule.css `.capsule--button::before` (−8 −2)
                    .accessibilityAddTraits(activo ? .isSelected : [])
            } else {
                pildora
            }
        }
        .foregroundStyle(tinta)
        .environment(\.colorScheme, cristal == nil ? esquema : .dark)
    }

    private var pildora: some View {
        HStack(spacing: sm ? 5 : 6) {
            if punto { PuntoCapsula(late: tono == .directo || tono == .ok, color: tinta) }
            if let icono { IconoPalco(icono, tamano: sm ? 16 : 18).padding(.leading, -2) }
            Text(texto).estilo(estiloTexto).lineLimit(1)
        }
        .padding(.horizontal, sm ? 8 : 10)
        .frame(maxWidth: llenarAncho ? .infinity : nil, alignment: .leading)
        .frame(height: sm ? 24 : 28)
        .background(FondoCapsula(tono: tono, cristal: activo ? nil : cristal, pulsado: activo))
    }

    private var tinta: Color {
        if activo { return Palco.accentInk }
        switch tono {
        case .neutral: return cristal == nil ? Palco.text : Palco.onVideo
        case .directo: return Palco.onVideo
        case .ok: return Palco.okInk
        case .weak: return Palco.weakInk
        case .fail: return Palco.failInk
        case .oro: return Palco.onAccent
        }
    }
}

extension EnvironmentValues {
    /// Tracking propio del texto de las cápsulas de dentro (el «cuándo» del versus: +0,06 em).
    @Entry var trackingCapsulaEm: Double? = nil
    /// Cápsulas y pastillas a todo el ancho de su celda (en una rejilla de la web se estiran: la galería).
    @Entry var llenarAncho: Bool = false
}

/// El fondo de la cápsula según tono, cristal y pulsado (Capsule.css).
private struct FondoCapsula: View {
    let tono: Capsula.Tono
    let cristal: TipoCristal?
    let pulsado: Bool

    var body: some View {
        if pulsado {
            Capsule().fill(Palco.accentWash).bordeInterior(Palco.accentEdge.opacity(0.55), forma: Capsule())
        } else if tono == .directo {
            Capsule().fill(PalcoMezcla.liveCapsula)
        } else if tono == .oro {
            Capsule().fill(Palco.accent)
        } else if let cristal {
            Color.clear.cristal(cristal, en: Capsule())
                .bordeInterior(Color.white.opacity(0.12), forma: Capsule())
        } else {
            Capsule().fill(fondoTema)
        }
    }

    private var fondoTema: Color {
        switch tono {
        case .ok: Palco.ok.opacity(0.16)
        case .weak: Palco.weak.opacity(0.16)
        case .fail: Palco.fail.opacity(0.16)
        case .neutral, .directo, .oro: Palco.lineSoft
        }
    }
}

/// `.capsule__dot`: círculo de 7 del color de la tinta; en directo y ok una copia crece a 2,4 y se apaga
/// (`ace-onda`, 2 s). Sin latido con movimiento reducido. La onda no se recorta (sale del punto).
private struct PuntoCapsula: View {
    let late: Bool
    let color: Color
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 7, height: 7)
            .overlay {
                if late && !reducido {
                    Onda(color: color, escalaMaxima: 2.4, diametro: 7)
                }
            }
    }
}
