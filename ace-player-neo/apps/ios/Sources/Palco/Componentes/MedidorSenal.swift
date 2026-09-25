import SwiftUI

/// `<SignalBadge>` de la web: medidor de tres barras + palabra (a1 §10.7; ui/SignalBadge.css). Nunca solo
/// color: forma + palabra + color. `compacto` = glifo (● ▲ ✕ ◌ ○) + palabra; `apilado` = columna a la derecha.
struct MedidorSenal: View {
    enum Tamano: Sendable { case sm, md, lg }

    let estado: EstadoSenal
    let tamano: Tamano
    let palabra: String?
    let ocultarPalabra: Bool
    let apilado: Bool
    let compacto: Bool

    init(_ estado: EstadoSenal, tamano: Tamano = .md, palabra: String? = nil, ocultarPalabra: Bool = false,
         apilado: Bool = false, compacto: Bool = false) {
        self.estado = estado
        self.tamano = tamano
        self.palabra = palabra
        self.ocultarPalabra = ocultarPalabra
        self.apilado = apilado
        self.compacto = compacto
    }

    /// Alto del medidor: sm 12 · md 14 · lg 20 · md apilado 18.
    private var alto: CGFloat {
        switch tamano {
        case .sm: 12
        case .md: apilado ? 18 : 14
        case .lg: 20
        }
    }

    private var texto: String { palabra ?? estado.palabra }
    private var estilo: EstiloTexto { tamano == .lg ? .senalLg : .senal }

    var body: some View {
        Group {
            if apilado {
                VStack(alignment: .trailing, spacing: 5) { partes }
            } else {
                HStack(spacing: tamano == .lg ? 9 : 7) { partes }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(texto)
    }

    @ViewBuilder private var partes: some View {
        if compacto {
            GlifoSenal(estado: estado, estilo: estilo)
        } else {
            BarrasSenal(estado: estado, alto: alto)
        }
        if !ocultarPalabra {
            Text(texto).estilo(estilo).foregroundStyle(ColoresSenal.tinta(estado)).lineLimit(1)
        }
    }
}

/// Colores del medidor (`--sig`) y de la palabra (`--sig-ink`) por estado.
enum ColoresSenal {
    static func medidor(_ estado: EstadoSenal) -> Color {
        switch estado {
        case .ok: Palco.ok
        case .weak: Palco.weak
        case .fail: Palco.fail
        case .checking: Palco.text2
        case .pending: Palco.text3
        }
    }

    static func tinta(_ estado: EstadoSenal) -> Color {
        switch estado {
        case .ok: Palco.okInk
        case .weak: Palco.weakInk
        case .fail: Palco.failInk
        case .checking: Palco.text2
        case .pending: Palco.text3
        }
    }
}

/// Las tres barras: ancho 0,3·alto, alturas 42/71/100 %, separación 2, radio 1,5, contorno interior 1,5.
private struct BarrasSenal: View {
    let estado: EstadoSenal
    let alto: CGFloat

    var body: some View {
        HStack(alignment: .bottom, spacing: 2) {
            BarraSenal(estado: estado, indice: 0, ancho: alto * 0.3, alto: alto * 0.42)
            BarraSenal(estado: estado, indice: 1, ancho: alto * 0.3, alto: alto * 0.71)
            BarraSenal(estado: estado, indice: 2, ancho: alto * 0.3, alto: alto)
        }
        .frame(height: alto, alignment: .bottom)
        .overlay {
            if estado == .fail { AspaSenal(color: ColoresSenal.medidor(.fail)).padding(.horizontal, -2).padding(.vertical, -1) }
        }
    }
}

private struct BarraSenal: View {
    let estado: EstadoSenal
    let indice: Int
    let ancho: CGFloat
    let alto: CGFloat
    @Environment(\.movimientoReducido) private var reducido

    private var forma: RoundedRectangle { RoundedRectangle(cornerRadius: 1.5, style: .circular) }
    private var color: Color { ColoresSenal.medidor(estado) }

    var body: some View {
        base
            .frame(width: ancho, height: alto)
            .clipShape(forma)
    }

    @ViewBuilder private var base: some View {
        switch estado {
        case .ok:
            forma.fill(color)
        case .weak:
            if indice < 2 { forma.fill(color) } else { forma.strokeBorder(color, lineWidth: 1.5) }
        case .fail:
            forma.strokeBorder(color.opacity(0.55), lineWidth: 1.5)
        case .pending:
            FranjasPendiente(color: color).opacity(0.9)
        case .checking:
            if reducido {
                forma.strokeBorder(color, style: StrokeStyle(lineWidth: 1.5, dash: [3, 2]))
            } else {
                ZStack {
                    forma.strokeBorder(color, lineWidth: 1.5)
                    RellenoComprobando(color: color, retraso: Double(indice) * 0.2)
                }
            }
        }
    }
}

/// `repeating-linear-gradient(0deg, sig 0 2px, transparent 2px 4px)`: franjas de 2 desde abajo.
private struct FranjasPendiente: View {
    let color: Color

    var body: some View {
        Canvas { contexto, tamano in
            var y = tamano.height - 2
            while y > -2 {
                contexto.fill(Path(CGRect(x: 0, y: y, width: tamano.width, height: 2)), with: .color(color))
                y -= 4
            }
        }
    }
}

/// `sig-comprobando`: opacidad 0 → 0,85 (40 %) → 0 en 1,4 s con `--ease-out`, retrasos 0 / 0,2 / 0,4 s.
private struct RellenoComprobando: View {
    let color: Color
    let retraso: Double
    @Environment(\.vistaActiva) private var vistaActiva

    var body: some View {
        TimelineView(.animation(minimumInterval: nil, paused: !vistaActiva)) { contexto in
            color.opacity(RellenoComprobando.opacidad(contexto.date.timeIntervalSinceReferenceDate - retraso))
        }
    }

    static func opacidad(_ t: Double) -> Double {
        let ciclo = Movimiento.comprobando
        let fase = (t.truncatingRemainder(dividingBy: ciclo) + ciclo).truncatingRemainder(dividingBy: ciclo) / ciclo
        if fase < 0.4 { return 0.85 * Movimiento.curvaSalida(fase / 0.4) }
        return 0.85 * (1 - Movimiento.curvaSalida((fase - 0.4) / 0.6))
    }
}

/// Aspa de «Sin señal»: dos diagonales de 2 a ±45° por el centro de la caja ampliada (1 arriba y abajo, 2 a los lados).
private struct AspaSenal: View {
    let color: Color

    var body: some View {
        Canvas { contexto, tamano in
            let centro = CGPoint(x: tamano.width / 2, y: tamano.height / 2)
            let largo = tamano.width + tamano.height
            var aspa = Path()
            aspa.move(to: CGPoint(x: centro.x - largo, y: centro.y - largo))
            aspa.addLine(to: CGPoint(x: centro.x + largo, y: centro.y + largo))
            aspa.move(to: CGPoint(x: centro.x - largo, y: centro.y + largo))
            aspa.addLine(to: CGPoint(x: centro.x + largo, y: centro.y - largo))
            contexto.clip(to: Path(CGRect(origin: .zero, size: tamano)))
            contexto.stroke(aspa, with: .color(color), lineWidth: 2)
        }
        .allowsHitTesting(false)
    }
}

/// Glifo del medidor compacto (`--glyph-*`, 0,95 em); «comprobando» parpadea a 0,35 (1,4 s).
private struct GlifoSenal: View {
    let estado: EstadoSenal
    let estilo: EstiloTexto
    @Environment(\.movimientoReducido) private var reducido
    @Environment(\.vistaActiva) private var vistaActiva

    private var glifo: String {
        switch estado {
        case .ok: "●"
        case .weak: "▲"
        case .fail: "✕"
        case .checking: "◌"
        case .pending: "○"
        }
    }

    var body: some View {
        if estado == .checking && !reducido {
            TimelineView(.animation(minimumInterval: nil, paused: !vistaActiva)) { contexto in
                texto.opacity(GlifoSenal.opacidad(contexto.date.timeIntervalSinceReferenceDate))
            }
        } else {
            texto
        }
    }

    private var texto: some View {
        Text(glifo).estilo(estilo.con(tamano: estilo.tamano * 0.95)).foregroundStyle(ColoresSenal.medidor(estado))
    }

    /// `sig-glifo`: 50 % → opacidad 0,35.
    static func opacidad(_ t: Double) -> Double {
        let fase = t.truncatingRemainder(dividingBy: Movimiento.comprobando) / Movimiento.comprobando
        let tramo = fase < 0.5 ? fase / 0.5 : (1 - fase) / 0.5
        return 1 - 0.65 * Movimiento.curvaSalida(tramo)
    }
}
