import SwiftUI

/* La cápsula del marcador sobre el vídeo (`Scoreboard` de Scoreboard.tsx, `.mc-scap` de match-center.css;
   a4 §6): tapada por defecto («👁 Marcador» + minuto), destapada (cifras que giran como una paleta, con
   escudos 24 desde 480), sin marcador (solo el minuto o «Final») o antes del partido (🕒 21:00 · En 48 min).
   Un gol visto destapado: rebote de las cifras y háptica de éxito. Cristal de vídeo, alto 44. */

struct CapsulaMarcadorVideo: View {
    let partido: FootballMatch
    let marcador: LiveScore?
    let ahora: Date
    let variante: VarianteEscenario
    @Environment(MarcadoresDestapados.self) private var destapados
    @Environment(Haptica.self) private var haptica
    @State private var recienDestapado = false
    @State private var anterior: (local: Int, visitante: Int)?
    @State private var goles = 0

    private var estado: EstadoTeatro? { DatosTeatro.estado(partido, marcador: marcador, ahora: ahora) }
    private var pintable: LiveScore? { DatosTeatro.pintable(marcador) }
    private var tapado: Bool { pintable != nil && !destapados.destapado(partido.id) }

    var body: some View {
        HStack(spacing: 0) {
            contenido
            cuando
            if pintable != nil && !tapado { botonTapar }
        }
        .frame(minHeight: 44)
        .foregroundStyle(Palco.onVideo)
        .cristal(.video, en: Capsule())
        .fixedSize()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(IDUI.capsulaMarcador)
        .onChange(of: marcadorVisto, initial: true) { _, nuevo in celebrar(nuevo) }
    }

    /// El marcador que se VE destapado (tapado no se celebra: al destapar solo gira).
    private var marcadorVisto: [Int]? {
        guard let pintable, !tapado else { return nil }
        return [pintable.home, pintable.away]
    }

    private func celebrar(_ nuevo: [Int]?) {
        guard let nuevo, nuevo.count == 2 else {
            anterior = pintable.map { ($0.home, $0.away) }
            return
        }
        defer { anterior = (nuevo[0], nuevo[1]) }
        guard let antes = anterior, nuevo[0] > antes.local || nuevo[1] > antes.visitante else { return }
        goles += 1
        haptica.disparar(.exito)
    }

    @ViewBuilder private var contenido: some View {
        if tapado {
            BotonMarcadorTapado(ancho: variante.marcadorAncho) {
                haptica.disparar(.ligera)
                recienDestapado = true
                destapados.destapar(partido.id)
            }
        } else if let pintable {
            CifrasMarcador(
                partido: partido, marcador: pintable, conEscudos: variante.marcadorAncho, girar: recienDestapado,
                goles: goles, terminado: estado?.fase == .terminado)
        } else if estado?.fase == .directo || estado?.fase == .terminado {
            EmptyView()
        } else if DatosTeatro.hora(partido.time) != nil {
            HStack(spacing: 6) {
                IconoPalco(.clock, tamano: 16)
                Num(partido.time, tamano: 13, etiqueta: "A las \(partido.time)")
            }
            .padding(.leading, 14)
        } else {
            Text(partido.time.isEmpty ? "Programado" : partido.time).estilo(estiloCapsula).padding(.leading, 14)
        }
    }

    private var estiloCapsula: EstiloTexto { EstiloTexto(tamano: 13, peso: 650, anchura: 88, altoLinea: 1) }

    /// El minuto (tras el botón tapado: margen −4 y se esconde con el vídeo < 370) o «Final» o cuánto falta.
    @ViewBuilder private var cuando: some View {
        let izquierda: CGFloat = tapado ? -4 : (pintable != nil ? 2 : 14)
        if estado?.fase == .directo {
            if !tapado || variante.minutoTrasMarcador {
                MinutoEnVivo(marcador: marcador).padding(.leading, izquierda).padding(.trailing, 14)
            }
        } else if estado?.fase == .terminado {
            Text("Final").estilo(estiloCapsula).padding(.leading, izquierda).padding(.trailing, 14)
        } else if let estado, pintable == nil {
            Text(DatosTeatro.unidadesJuntas(estado.texto)).estilo(estiloCapsula)
                .padding(.leading, 6).padding(.trailing, 14)
        } else if pintable == nil {
            Color.clear.frame(width: 14, height: 1)
        }
    }

    /// Ojo tachado: vuelve a tapar TODOS los destapados (a4 §6.2).
    private var botonTapar: some View {
        BotonIcono(.eyeOff, etiqueta: "Tapar el marcador (tu emisión va por detrás)", variante: .video) {
            recienDestapado = false
            destapados.vaciar()
        }
        .padding(.leading, -6)
    }
}

/// «👁 Marcador» (+ barras de censura desde 480): 44 de alto, separación 8, relleno 12 · 10 (ancho: 14 · 12).
private struct BotonMarcadorTapado: View {
    let ancho: Bool
    let accion: () -> Void

    var body: some View {
        Button(action: accion) {
            HStack(spacing: 8) {
                IconoPalco(.eye, tamano: 18)
                Text("Marcador")
                    .estilo(EstiloTexto(tamano: ancho ? 15 : 13, peso: 800, anchura: 125, trackingEm: -0.02, altoLinea: 1))
                if ancho { BarrasCensura() }
            }
            .padding(.leading, ancho ? 14 : 12)
            .padding(.trailing, ancho ? 12 : 10)
            .frame(height: 44)
            .contentShape(Capsule())
        }
        .buttonStyle(EstiloPulsar())
        .accessibilityLabel("Ver marcador")
    }
}

/// Dos barras de 11×16, radio 4, blancas al 40 %, separadas 4 (`.mc-censor--sm`).
private struct BarrasCensura: View {
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<2, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 4, style: .circular).fill(Color.white.opacity(0.4)).frame(width: 11, height: 16)
            }
        }
        .accessibilityHidden(true)
    }
}

/// El minuto con el punto que late: «● 61'», «● Descanso» o «● En directo» (13/650, separación 6).
struct MinutoEnVivo: View {
    let marcador: LiveScore?
    var tamano: Double = 13

    var body: some View {
        HStack(spacing: 6) {
            PuntoDirecto()
            if let minuto = DatosTeatro.minuto(marcador) {
                if minuto.descanso {
                    Text("Descanso").estilo(EstiloTexto(tamano: tamano, peso: 650, altoLinea: 1))
                } else {
                    Num("\(minuto.minuto)'", tamano: CGFloat(tamano), etiqueta: "Minuto \(minuto.minuto)")
                }
            } else {
                Text("En directo").estilo(EstiloTexto(tamano: tamano, peso: 650, altoLinea: 1))
            }
        }
        .lineLimit(1)
        .fixedSize()
    }
}

/// «[escudo] 1 – 1 [escudo]»: cifras 22/780/75 que giran al destapar y ruedan al cambiar; rebote con un gol.
private struct CifrasMarcador: View {
    let partido: FootballMatch
    let marcador: LiveScore
    let conEscudos: Bool
    let girar: Bool
    let goles: Int
    let terminado: Bool
    @Environment(\.movimientoReducido) private var reducido

    var body: some View {
        HStack(spacing: 8) {
            if conEscudos { MarcaEquipo(DatosEquipo.de(partido, .local), tamano: 24) }
            cifras
            if conEscudos && !partido.away.isEmpty {
                MarcaEquipo(DatosEquipo.de(partido, .visitante), tamano: 24)
            }
        }
        .padding(.leading, conEscudos ? 8 : 14)
    }

    private var cifras: some View {
        let animacion: Num.Animacion = girar ? .paleta : .rueda
        let quieto: Bool = reducido
        return HStack(spacing: 22 * 0.12) {
            Num(String(marcador.home), tamano: 22, animacion: animacion)
            Text("–").estilo(EstiloTexto(tamano: 22, peso: 500, anchura: 75, altoLinea: 1)).foregroundStyle(Palco.onVideo2)
            Num(String(marcador.away), tamano: 22, animacion: animacion)
        }
        .keyframeAnimator(initialValue: 1.0, trigger: goles) { vista, escala in
            vista.scaleEffect(quieto ? 1 : escala, anchor: UnitPoint(x: 0.5, y: 0.55))
        } keyframes: { _ in
            KeyframeTrack {
                SpringKeyframe(1.14, duration: 0.252, spring: .init(duration: 0.55, bounce: 0.3))
                SpringKeyframe(1.0, duration: 0.468, spring: .init(duration: 0.55, bounce: 0.3))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(DatosTeatro.etiquetaMarcador(partido, marcador, terminado: terminado))
    }
}
